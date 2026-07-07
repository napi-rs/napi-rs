use std::{
  future::Future,
  path::Path,
  pin::Pin,
  sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
  },
  task::{Context, Poll},
  time::{Duration, Instant},
};

use napi::bindgen_prelude::{
  try_block_on_custom_runtime, try_shutdown_async_runtime, AsyncBlock, AsyncBlockBuilder, Either,
  Env, Error, PromiseRaw, Result, Status,
};
use napi_derive::napi;

const DROP_RELEASE_TIMEOUT: Duration = Duration::from_secs(20);
static ACTIVE_POLL_SHUTDOWN_ENTERED_PATH: Mutex<Option<String>> = Mutex::new(None);

pub(crate) fn mark_active_poll_shutdown_entered() {
  let path = ACTIVE_POLL_SHUTDOWN_ENTERED_PATH
    .lock()
    .unwrap_or_else(std::sync::PoisonError::into_inner)
    .take();
  if let Some(path) = path {
    let _ = std::fs::write(path, b"entered");
  }
}

#[napi]
pub fn arm_custom_runtime_poll_shutdown_probe(path: String) -> Result<()> {
  let mut armed = ACTIVE_POLL_SHUTDOWN_ENTERED_PATH
    .lock()
    .unwrap_or_else(std::sync::PoisonError::into_inner);
  if armed.is_some() {
    return Err(Error::new(
      Status::GenericFailure,
      "custom runtime active-poll shutdown probe is already armed",
    ));
  }
  *armed = Some(path);
  Ok(())
}

#[napi]
pub struct CancellationBorrowProbe {
  value: u32,
  drop_path: Option<String>,
}

#[napi]
impl CancellationBorrowProbe {
  #[napi(constructor)]
  pub fn new(value: u32, drop_path: Option<String>) -> Self {
    Self { value, drop_path }
  }

  #[napi]
  pub fn set_value(&mut self, value: u32) {
    self.value = value;
  }

  #[napi]
  pub fn get_value(&self) -> u32 {
    self.value
  }
}

impl Drop for CancellationBorrowProbe {
  fn drop(&mut self) {
    if let Some(drop_path) = self.drop_path.as_ref() {
      let _ = std::fs::write(drop_path, self.value.to_string());
    }
  }
}

struct BlockingDropProbe {
  entered_path: String,
  release_path: String,
}

impl Drop for BlockingDropProbe {
  fn drop(&mut self) {
    let _ = std::fs::write(&self.entered_path, b"entered");
    let deadline = Instant::now() + DROP_RELEASE_TIMEOUT;
    while !Path::new(&self.release_path).exists() && Instant::now() < deadline {
      std::thread::sleep(Duration::from_millis(1));
    }
  }
}

struct ActivePollCleanupProbe {
  wake_path: String,
  poll_entered_path: String,
  poll_release_path: String,
  future_drop_entered_path: String,
  future_drop_release_path: String,
  future_drop_path: String,
  future_dropped: Arc<AtomicBool>,
  complete_after_poll_release: bool,
  wake_armed: bool,
}

impl Future for ActivePollCleanupProbe {
  type Output = ();

  fn poll(mut self: Pin<&mut Self>, context: &mut Context<'_>) -> Poll<Self::Output> {
    if !self.wake_armed {
      self.wake_armed = true;
      let wake_path = self.wake_path.clone();
      let waker = context.waker().clone();
      std::thread::Builder::new()
        .name("napi-custom-runtime-poll-waker".to_owned())
        .spawn(move || {
          let deadline = Instant::now() + DROP_RELEASE_TIMEOUT;
          while !Path::new(&wake_path).exists() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(1));
          }
          waker.wake();
        })
        .expect("failed to spawn active-poll wake thread");
      return Poll::Pending;
    }

    let _ = std::fs::write(&self.poll_entered_path, b"entered");
    let deadline = Instant::now() + DROP_RELEASE_TIMEOUT;
    while !Path::new(&self.poll_release_path).exists() && Instant::now() < deadline {
      std::thread::sleep(Duration::from_millis(1));
    }
    if self.complete_after_poll_release {
      Poll::Ready(())
    } else {
      Poll::Pending
    }
  }
}

impl Drop for ActivePollCleanupProbe {
  fn drop(&mut self) {
    let _ = std::fs::write(&self.future_drop_entered_path, b"entered");
    if !self.complete_after_poll_release {
      let deadline = Instant::now() + DROP_RELEASE_TIMEOUT;
      while !Path::new(&self.future_drop_release_path).exists() && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(1));
      }
    }
    self.future_dropped.store(true, Ordering::Release);
    let _ = std::fs::write(&self.future_drop_path, b"dropped");
  }
}

struct EnvSpawnFutureCancellationProbe {
  poll_entered_path: String,
  future_drop_entered_path: String,
  future_drop_release_path: String,
  future_drop_path: String,
  poll_entered: bool,
}

impl Future for EnvSpawnFutureCancellationProbe {
  type Output = Result<u32>;

  fn poll(mut self: Pin<&mut Self>, _context: &mut Context<'_>) -> Poll<Self::Output> {
    if !self.poll_entered {
      self.poll_entered = true;
      let _ = std::fs::write(&self.poll_entered_path, b"entered");
    }
    Poll::Pending
  }
}

impl Drop for EnvSpawnFutureCancellationProbe {
  fn drop(&mut self) {
    let _ = std::fs::write(&self.future_drop_entered_path, b"entered");
    let deadline = Instant::now() + DROP_RELEASE_TIMEOUT;
    while !Path::new(&self.future_drop_release_path).exists() && Instant::now() < deadline {
      std::thread::sleep(Duration::from_millis(1));
    }
    let _ = std::fs::write(&self.future_drop_path, b"dropped");
  }
}

#[napi]
pub fn custom_runtime_spawn_future_cancellation_order<'env>(
  env: &'env Env,
  poll_entered_path: String,
  future_drop_entered_path: String,
  future_drop_release_path: String,
  future_drop_path: String,
) -> Result<PromiseRaw<'env, u32>> {
  env.spawn_future(EnvSpawnFutureCancellationProbe {
    poll_entered_path,
    future_drop_entered_path,
    future_drop_release_path,
    future_drop_path,
    poll_entered: false,
  })
}

#[napi]
pub fn custom_runtime_poll_cleanup_order(
  env: &Env,
  wake_path: String,
  poll_entered_path: String,
  poll_release_path: String,
  future_drop_entered_path: String,
  future_drop_release_path: String,
  future_drop_path: String,
  terminal_order_path: String,
  completion_drop_entered_path: Option<String>,
  completion_drop_release_path: Option<String>,
  complete_after_poll_release: bool,
) -> Result<AsyncBlock<()>> {
  let future_dropped = Arc::new(AtomicBool::new(false));
  let terminal_future_dropped = Arc::clone(&future_dropped);
  AsyncBlockBuilder::new(async move {
    ActivePollCleanupProbe {
      wake_path,
      poll_entered_path,
      poll_release_path,
      future_drop_entered_path,
      future_drop_release_path,
      future_drop_path,
      future_dropped,
      complete_after_poll_release,
      wake_armed: false,
    }
    .await;
    Ok(())
  })
  .with_dispose(move |_| {
    if let (Some(entered_path), Some(release_path)) =
      (completion_drop_entered_path, completion_drop_release_path)
    {
      drop(BlockingDropProbe {
        entered_path,
        release_path,
      });
    }
    Ok(())
  })
  .with_terminal_finalizer(move || {
    let order = if terminal_future_dropped.load(Ordering::Acquire) {
      b"after-drop".as_slice()
    } else {
      b"before-drop".as_slice()
    };
    let _ = std::fs::write(terminal_order_path, order);
  })
  .build(env)
}

struct PendingBorrowFuture<'a> {
  _drop_probe: BlockingDropProbe,
  _borrowed: &'a CancellationBorrowProbe,
}

impl Future for PendingBorrowFuture<'_> {
  type Output = ();

  fn poll(self: Pin<&mut Self>, _cx: &mut Context<'_>) -> Poll<Self::Output> {
    Poll::Pending
  }
}

#[napi]
pub async fn custom_runtime_cancellation_borrow(
  probe: &CancellationBorrowProbe,
  entered_path: String,
  release_path: String,
) {
  PendingBorrowFuture {
    _drop_probe: BlockingDropProbe {
      entered_path,
      release_path,
    },
    _borrowed: probe,
  }
  .await;
}

struct PendingNestedBorrowFuture<'a> {
  option_probe: Option<&'a CancellationBorrowProbe>,
  either_probe: Either<u32, &'a CancellationBorrowProbe>,
  shared_probes: Vec<&'a CancellationBorrowProbe>,
  mutable_probes: Vec<&'a mut CancellationBorrowProbe>,
  future_drop_path: String,
}

impl Future for PendingNestedBorrowFuture<'_> {
  type Output = ();

  fn poll(self: Pin<&mut Self>, _cx: &mut Context<'_>) -> Poll<Self::Output> {
    Poll::Pending
  }
}

impl Drop for PendingNestedBorrowFuture<'_> {
  fn drop(&mut self) {
    let option_value = self.option_probe.map_or(0, |probe| probe.value);
    let either_value = match self.either_probe {
      Either::A(value) => value,
      Either::B(probe) => probe.value,
    };
    let shared_value = self
      .shared_probes
      .iter()
      .map(|probe| probe.value)
      .sum::<u32>();
    let mutable_value = self
      .mutable_probes
      .iter_mut()
      .map(|probe| {
        probe.value += 1;
        probe.value
      })
      .sum::<u32>();
    let _ = std::fs::write(
      &self.future_drop_path,
      format!("{option_value},{either_value},{shared_value},{mutable_value}"),
    );
  }
}

#[napi]
pub async unsafe fn custom_runtime_nested_cancellation_borrow<'a>(
  option_probe: Option<&'a CancellationBorrowProbe>,
  either_probe: Either<u32, &'a CancellationBorrowProbe>,
  shared_probes: Vec<&'a CancellationBorrowProbe>,
  mutable_probes: Vec<&'a mut CancellationBorrowProbe>,
  future_drop_path: String,
) {
  PendingNestedBorrowFuture {
    option_probe,
    either_probe,
    shared_probes,
    mutable_probes,
    future_drop_path,
  }
  .await;
}

struct RuntimeUseOnDrop {
  result_path: String,
}

impl Future for RuntimeUseOnDrop {
  type Output = ();

  fn poll(self: Pin<&mut Self>, _cx: &mut Context<'_>) -> Poll<Self::Output> {
    Poll::Pending
  }
}

impl Drop for RuntimeUseOnDrop {
  fn drop(&mut self) {
    let marker = match try_block_on_custom_runtime(async {}) {
      Ok(()) => "Ok\nnested runtime use unexpectedly succeeded".to_owned(),
      Err(error) => format!("{}\n{}", error.status.as_ref(), error.reason),
    };
    let _ = std::fs::write(&self.result_path, marker);
  }
}

#[napi]
pub async fn custom_runtime_cancellation_reentry(result_path: String) {
  RuntimeUseOnDrop { result_path }.await;
}

#[napi]
pub fn cancel_custom_runtime_for_order_probe(result_path: String) -> Result<()> {
  std::thread::Builder::new()
    .name("napi-custom-runtime-order-cancellation".to_owned())
    .spawn(move || {
      let result = try_shutdown_async_runtime();
      let marker = match result {
        Ok(()) => "cancelled".to_owned(),
        Err(error) => format!("error={error}"),
      };
      let _ = std::fs::write(result_path, marker);
    })
    .map_err(|error| {
      Error::new(
        Status::GenericFailure,
        format!("failed to spawn custom runtime cancellation thread: {error}"),
      )
    })?;
  Ok(())
}
