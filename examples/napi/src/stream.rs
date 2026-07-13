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
