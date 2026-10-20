use bytes::BytesMut;
use napi::bindgen_prelude::*;
use tokio::sync::mpsc::error::TrySendError;
use tokio_stream::{wrappers::ReceiverStream, StreamExt};
use tokio_util::io::{read_buf, StreamReader};

#[napi]
pub fn accept_stream(
  env: &Env,
  stream: ReadableStream<Uint8Array>,
) -> Result<AsyncBlock<BufferSlice<'static>>> {
  let web_readable_stream = stream.read()?;
  let mut input = StreamReader::new(web_readable_stream.map(|chunk| {
    chunk
      .map(|chunk| bytes::Bytes::copy_from_slice(&chunk))
      .map_err(|e| std::io::Error::other(e.reason.clone()))
  }));
  AsyncBlockBuilder::build_with_map(
    env,
    async move {
      let mut bytes_mut = BytesMut::new();
      loop {
        let n = read_buf(&mut input, &mut bytes_mut).await?;
        if n == 0 {
          break;
        }
      }
      Ok(bytes_mut)
    },
    |env, mut value| {
      let value_ptr = value.as_mut_ptr();
      unsafe {
        BufferSlice::from_external(&env, value_ptr, value.len(), value, move |_, bytes| {
          drop(bytes);
        })
      }
    },
  )
}

/// Counts the chunks read from a stream, swallowing (dropping) any read error.
///
/// Regression guard: the read error is dropped here inside the async block, which runs
/// on the Tokio runtime thread rather than the JS thread. A `Reader` rejection that
/// carried a raw JS `napi_ref` would release that reference off the JS thread on drop,
/// aborting the process; the owned-error conversion makes this safe.
#[napi]
pub fn drain_stream_count(
  env: &Env,
  stream: ReadableStream<Uint8Array>,
) -> Result<AsyncBlock<u32>> {
  let mut reader = stream.read()?;
  AsyncBlockBuilder::new(async move {
    let mut count = 0u32;
    while let Some(item) = reader.next().await {
      match item {
        Ok(_) => count += 1,
        // Drop the error on the Tokio thread instead of returning it to JS.
        Err(_err) => break,
      }
    }
    Ok(count)
  })
  .build(env)
}

#[napi]
pub fn create_readable_stream(env: &Env) -> Result<ReadableStream<'_, BufferSlice<'_>>> {
  let (tx, rx) = tokio::sync::mpsc::channel(100);
  std::thread::spawn(move || {
    for _ in 0..100 {
      match tx.try_send(Ok(b"hello".to_vec())) {
        Err(TrySendError::Closed(_)) => {
          panic!("closed");
        }
        Err(TrySendError::Full(_)) => {
          panic!("queue is full");
        }
        Ok(_) => {}
      }
    }
  });
  ReadableStream::create_with_stream_bytes(env, ReceiverStream::new(rx))
}

/// Regression guard for the off-thread `FunctionRef` drop.
///
/// A `create_with_stream_bytes` output whose pull future REJECTS (the underlying
/// stream yields an `Err` item, or the output is cancelled while a pull is parked)
/// drops the pull resolver — which owns the controller's `enqueue`/`close`
/// `FunctionRef`s — on a Tokio worker thread rather than the JS thread. A
/// `FunctionRef` holds a thread-affine `napi_ref`; deleting it off the JS thread
/// mutates V8's `GlobalHandles` concurrently with the JS thread and corrupts the
/// heap, surfacing later as a SIGSEGV/SIGBUS inside V8/napi. This emits one `Ok`
/// chunk then a terminal `Err`, so JS can loop it and assert the process stays
/// alive (see the matching test in `__tests__/values.spec.ts`).
#[napi]
pub fn create_erroring_readable_stream(env: &Env) -> Result<ReadableStream<'_, BufferSlice<'_>>> {
  let (tx, rx) = tokio::sync::mpsc::channel::<Result<Vec<u8>>>(4);
  std::thread::spawn(move || {
    let _ = tx.blocking_send(Ok(b"partial".to_vec()));
    let _ = tx.blocking_send(Err(Error::new(Status::GenericFailure, "boom")));
  });
  ReadableStream::create_with_stream_bytes(env, ReceiverStream::new(rx))
}

/// Nested metadata for demonstrating object streaming with complex types
#[napi(object)]
#[derive(Default)]
pub struct NestedMetadata {
  pub hello: String,
}

/// Example struct demonstrating object streaming with nested types
#[napi(object)]
#[derive(Default)]
pub struct StreamItem {
  pub something: NestedMetadata,
  pub name: String,
  pub size: i32,
}

/// Creates a ReadableStream that emits StreamItem objects.
/// This demonstrates streaming custom Rust structs to JavaScript.
#[napi]
pub fn create_readable_stream_with_object(env: &Env) -> Result<ReadableStream<'_, StreamItem>> {
  let (tx, rx) = tokio::sync::mpsc::channel(100);
  std::thread::spawn(move || {
    for i in 0..100 {
      let item = StreamItem {
        something: Default::default(),
        name: Default::default(),
        size: i,
      };
      match tx.try_send(Ok(item)) {
        Err(TrySendError::Closed(_)) => {
          panic!("closed");
        }
        Err(TrySendError::Full(_)) => {
          panic!("queue is full");
        }
        Ok(_) => {}
      }
    }
  });
  ReadableStream::new(env, ReceiverStream::new(rx))
}

#[napi(ts_args_type = "readableStreamClass: typeof ReadableStream")]
pub fn create_readable_stream_from_class<'env>(
  env: &Env,
  readable_stream_class: Unknown<'env>,
) -> Result<ReadableStream<'env, BufferSlice<'env>>> {
  let (tx, rx) = tokio::sync::mpsc::channel(100);
  std::thread::spawn(move || {
    for _ in 0..100 {
      match tx.try_send(Ok(b"hello".to_vec())) {
        Err(TrySendError::Closed(_)) => {
          panic!("closed");
        }
        Err(TrySendError::Full(_)) => {
          panic!("queue is full");
        }
        Ok(_) => {}
      }
    }
  });
  ReadableStream::with_stream_bytes_and_readable_stream_class(
    env,
    &readable_stream_class,
    ReceiverStream::new(rx),
  )
}

/// Calls `ReadableStream::cancel`, which calls `stream.cancel(reason)`.
#[napi]
pub fn cancel_readable_stream(
  env: &Env,
  mut stream: ReadableStream<Uint8Array>,
  reason: Option<String>,
) -> Result<AsyncBlock<()>> {
  let cancelled = stream.cancel(reason)?.into_sendable_promise()?;
  AsyncBlockBuilder::new(cancelled).build(env)
}

/// What `read_then_cancel` and `cancel_pending_read` saw. An error field is unset when
/// that cancel resolved, or holds the error message when it failed.
#[napi(object)]
pub struct ReaderCancelOutcome {
  /// Chunks read before the cancel.
  pub chunks: u32,
  pub cancel_error: Option<String>,
  pub second_cancel_error: Option<String>,
  /// `next()` returned `None` after the cancel.
  pub ended: bool,
  /// `next()` still returned `None` when polled once more.
  pub stays_ended: bool,
}

/// Reads up to `chunks` chunks, then cancels the stream through the reader twice and
/// polls the reader again.
#[napi]
pub fn read_then_cancel(
  env: &Env,
  stream: ReadableStream<Uint8Array>,
  chunks: u32,
  reason: Option<String>,
) -> Result<AsyncBlock<ReaderCancelOutcome>> {
  let mut reader = stream.read()?;
  AsyncBlockBuilder::new(async move {
    let mut read = 0u32;
    while read < chunks {
      match reader.next().await {
        Some(chunk) => {
          chunk?;
          read += 1;
        }
        None => break,
      }
    }
    let cancel_error = reader.cancel(reason.clone()).await.err().map(|e| e.reason);
    let second_cancel_error = reader.cancel(reason).await.err().map(|e| e.reason);
    let ended = reader.next().await.is_none();
    let stays_ended = reader.next().await.is_none();
    Ok(ReaderCancelOutcome {
      chunks: read,
      cancel_error,
      second_cancel_error,
      ended,
      stays_ended,
    })
  })
  .build(env)
}

/// Starts reading the stream on another task, waits until JavaScript has a read in flight
/// (the test resolves `pulled` from the source's `pull` or a custom reader's `read`), then
/// cancels twice through a `ReaderCancelHandle` while that read is still pending.
#[napi]
pub fn cancel_pending_read(
  env: &Env,
  stream: ReadableStream<Uint8Array>,
  pulled: Promise<()>,
  reason: Option<String>,
) -> Result<AsyncBlock<ReaderCancelOutcome>> {
  let mut reader = stream.read()?;
  let cancel = reader.cancel_handle();
  AsyncBlockBuilder::new(async move {
    let reading = tokio::spawn(async move {
      let ended = reader.next().await.is_none();
      let stays_ended = reader.next().await.is_none();
      (ended, stays_ended)
    });
    pulled.await?;
    // Both calls are sent before either is awaited.
    let first = cancel.cancel(reason.clone());
    let second = cancel.cancel(reason);
    let cancel_error = first.await.err().map(|e| e.reason);
    let second_cancel_error = second.await.err().map(|e| e.reason);
    let (ended, stays_ended) = reading
      .await
      .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;
    Ok(ReaderCancelOutcome {
      chunks: 0,
      cancel_error,
      second_cancel_error,
      ended,
      stays_ended,
    })
  })
  .build(env)
}

// The cancel handle can be cloned and shared between threads.
const _: fn() = || {
  fn shareable<T: Clone + Send + Sync + 'static>() {}
  shareable::<ReaderCancelHandle>();
};

/// Reads a stream on a task and cancels it from a JavaScript call, like a decoder whose
/// `close()` cancels the stream it reads.
#[napi]
pub struct ClosableStreamRead {
  // `read_to_end` moves the reader out and takes `&self`, so that `close()` can be called
  // while its Promise is pending.
  reader: std::cell::Cell<Option<Reader<Uint8Array>>>,
  cancel: ReaderCancelHandle,
}

#[napi]
impl ClosableStreamRead {
  #[napi(constructor)]
  pub fn new(stream: ReadableStream<Uint8Array>) -> Result<Self> {
    let reader = stream.read()?;
    let cancel = reader.cancel_handle();
    Ok(Self {
      reader: std::cell::Cell::new(Some(reader)),
      cancel,
    })
  }

  /// Reads until the reader ends, and resolves with the number of chunks read.
  #[napi]
  pub fn read_to_end(&self, env: &Env) -> Result<AsyncBlock<u32>> {
    let mut reader = self
      .reader
      .take()
      .ok_or_else(|| Error::new(Status::GenericFailure, "readToEnd was already called"))?;
    AsyncBlockBuilder::new(async move {
      let mut chunks = 0u32;
      while let Some(chunk) = reader.next().await {
        chunk?;
        chunks += 1;
      }
      Ok(chunks)
    })
    .build(env)
  }

  /// Cancels with `ReaderCancelHandle::cancel_on_js_thread`, and throws the error it
  /// returns right away. The Promise resolves with `null` when the cancel settled as
  /// fulfilled, or with the error message.
  #[napi]
  pub fn close(&self, env: &Env, reason: Option<String>) -> Result<AsyncBlock<Option<String>>> {
    let settled = self.cancel.cancel_on_js_thread(env, reason)?;
    AsyncBlockBuilder::new(async move { Ok(settled.await.err().map(|e| e.reason)) }).build(env)
  }

  /// Same as `close`, with the queued `ReaderCancelHandle::cancel`.
  #[napi]
  pub fn close_queued(
    &self,
    env: &Env,
    reason: Option<String>,
  ) -> Result<AsyncBlock<Option<String>>> {
    let settled = self.cancel.cancel(reason);
    AsyncBlockBuilder::new(async move { Ok(settled.await.err().map(|e| e.reason)) }).build(env)
  }

  /// Keeps a clone of the cancel handle in a global, so that `cancelStashedOnJsThread` can
  /// use it from another environment (a worker).
  #[napi]
  pub fn stash_cancel_handle(&self) {
    *STASHED_CANCEL_HANDLE
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(self.cancel.clone());
  }

  /// Makes a queued `ReaderCancelHandle::cancel` from an env cleanup hook, when this
  /// environment is torn down. Node.js runs cleanup hooks in reverse order, so the hook
  /// runs before the stream's threadsafe functions are closed: the call is queued, and the
  /// environment goes away before it runs. The future is kept in a global for
  /// `queuedCancelAtTeardownOutcome`.
  #[napi]
  pub fn close_queued_at_env_teardown(&self, env: &Env) -> Result<()> {
    env.add_env_cleanup_hook(self.cancel.clone(), |cancel| {
      *QUEUED_CANCEL_AT_TEARDOWN
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(Box::pin(cancel.cancel(None)));
    })?;
    Ok(())
  }
}

type CancelFuture = std::pin::Pin<Box<dyn std::future::Future<Output = Result<()>> + Send>>;

static QUEUED_CANCEL_AT_TEARDOWN: std::sync::Mutex<Option<CancelFuture>> =
  std::sync::Mutex::new(None);

/// Awaits the future of `closeQueuedAtEnvTeardown` for up to `ms` milliseconds. Resolves
/// with `null` when it resolved to `Ok`, the error message when it resolved to `Err`, or
/// `"still pending"`.
#[napi]
pub fn queued_cancel_at_teardown_outcome(env: &Env, ms: u32) -> Result<AsyncBlock<Option<String>>> {
  let settled = QUEUED_CANCEL_AT_TEARDOWN
    .lock()
    .unwrap_or_else(std::sync::PoisonError::into_inner)
    .take()
    .ok_or_else(|| Error::new(Status::GenericFailure, "no queued cancel kept"))?;
  AsyncBlockBuilder::new(async move {
    Ok(
      match tokio::time::timeout(std::time::Duration::from_millis(ms.into()), settled).await {
        Ok(outcome) => outcome.err().map(|e| e.reason),
        Err(_) => Some("still pending".to_owned()),
      },
    )
  })
  .build(env)
}

static STASHED_CANCEL_HANDLE: std::sync::Mutex<Option<ReaderCancelHandle>> =
  std::sync::Mutex::new(None);

/// Calls `cancel_on_js_thread` on the stashed handle with the caller's env. Returns the
/// error message if it returned `Err`, or `null` if it returned a future (dropped here).
#[napi]
pub fn cancel_stashed_on_js_thread(env: &Env) -> Result<Option<String>> {
  // Cloned out first, so that the lock is not held while JavaScript runs.
  let handle = STASHED_CANCEL_HANDLE
    .lock()
    .unwrap_or_else(std::sync::PoisonError::into_inner)
    .clone()
    .ok_or_else(|| Error::new(Status::GenericFailure, "no cancel handle stashed"))?;
  let outcome = handle.cancel_on_js_thread(env, None);
  Ok(outcome.err().map(|e| e.reason))
}

/// Drops the stashed cancel handle, on the calling thread.
#[napi]
pub fn drop_stashed_cancel_handle() {
  let handle = STASHED_CANCEL_HANDLE
    .lock()
    .unwrap_or_else(std::sync::PoisonError::into_inner)
    .take();
  drop(handle);
}

/// A waker that passes each wake on to the task's own waker. Each clone of it is one
/// strong count on its `Arc`.
struct CountedWaker {
  task: std::sync::Mutex<Option<std::task::Waker>>,
}

impl CountedWaker {
  fn task(&self) -> Option<std::task::Waker> {
    self
      .task
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner)
      .clone()
  }
}

impl std::task::Wake for CountedWaker {
  fn wake(self: std::sync::Arc<Self>) {
    // Drop this clone before the task can run, so that the task does not count it.
    let task = self.task();
    drop(self);
    if let Some(task) = task {
      task.wake();
    }
  }

  fn wake_by_ref(self: &std::sync::Arc<Self>) {
    if let Some(task) = self.task() {
      task.wake();
    }
  }
}

/// Reads the stream with a waker that counts its clones, and keeps a cancel handle.
/// Resolves with the number of clones that napi-rs still holds when the read stops:
/// - `"end"`: reads like `while let Some(chunk) = reader.next().await { chunk?; }`, so it
///   stops at the end of the stream or at the first error.
/// - `"cancel"`: cancels through the handle while the first read is pending, then reads to
///   the end. Use a reader whose read never settles, so that no read callback holds a
///   clone while the clones are counted.
/// - `"drop"`: reads one chunk, then drops the reader.
#[napi]
pub fn reader_waker_clones_after_read(
  env: &Env,
  stream: ReadableStream<Uint8Array>,
  mode: String,
) -> Result<AsyncBlock<u32>> {
  use std::{
    pin::Pin,
    sync::Arc,
    task::{Context, Poll, Waker},
  };

  use tokio_stream::Stream as _;

  let mut reader = stream.read()?;
  let cancel = reader.cancel_handle();
  AsyncBlockBuilder::new(async move {
    let counted = Arc::new(CountedWaker {
      task: std::sync::Mutex::new(None),
    });
    let poll_counted = |reader: &mut Reader<Uint8Array>, cx: &mut Context<'_>| {
      *counted
        .task
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(cx.waker().clone());
      let waker = Waker::from(counted.clone());
      Pin::new(reader).poll_next(&mut Context::from_waker(&waker))
    };
    match mode.as_str() {
      "end" | "cancel" => {
        if mode == "cancel" {
          let first = std::future::poll_fn(|cx| Poll::Ready(poll_counted(&mut reader, cx))).await;
          if first.is_ready() {
            return Err(Error::new(
              Status::GenericFailure,
              "the first read was not pending",
            ));
          }
          drop(cancel.cancel(None));
        }
        while let Some(chunk) = std::future::poll_fn(|cx| poll_counted(&mut reader, cx)).await {
          if chunk.is_err() {
            break;
          }
        }
      }
      "drop" => {
        std::future::poll_fn(|cx| poll_counted(&mut reader, cx))
          .await
          .ok_or_else(|| Error::new(Status::GenericFailure, "the stream had no chunk"))??;
        drop(reader);
      }
      _ => {
        return Err(Error::new(
          Status::InvalidArg,
          format!("unknown mode {mode}"),
        ))
      }
    }
    // `counted` itself is one strong count.
    let clones = Arc::strong_count(&counted) as u32 - 1;
    drop(cancel);
    Ok(clones)
  })
  .build(env)
}
