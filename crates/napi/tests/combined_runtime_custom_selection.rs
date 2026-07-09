#![cfg(all(feature = "async-runtime", feature = "tokio_rt", not(feature = "noop")))]

use std::{
  future::Future,
  pin::Pin,
  sync::{
    atomic::{AtomicBool, AtomicUsize, Ordering},
    mpsc, Arc, Mutex,
  },
  time::{Duration, Instant},
};

use napi::bindgen_prelude::{
  spawn, spawn_on_custom_runtime, try_register_async_runtime, try_shutdown_async_runtime,
  try_start_async_runtime, within_selected_async_runtime, AsyncRuntime, AsyncRuntimeGuard,
  AsyncRuntimeRejection, AsyncRuntimeTask,
};

#[derive(Default)]
struct RuntimeState {
  running: AtomicBool,
  starts: AtomicUsize,
  shutdowns: AtomicUsize,
  enters: AtomicUsize,
  exits: AtomicUsize,
  queued: Mutex<Vec<AsyncRuntimeTask>>,
}

struct TestRuntime {
  state: Arc<RuntimeState>,
}

struct TestRuntimeGuard {
  state: Arc<RuntimeState>,
}

impl AsyncRuntimeGuard for TestRuntimeGuard {}

impl Drop for TestRuntimeGuard {
  fn drop(&mut self) {
    self.state.exits.fetch_add(1, Ordering::SeqCst);
  }
}

unsafe impl AsyncRuntime for TestRuntime {
  fn spawn(
    &self,
    task: AsyncRuntimeTask,
  ) -> std::result::Result<(), AsyncRuntimeRejection<AsyncRuntimeTask>> {
    if !self.state.running.load(Ordering::SeqCst) {
      return Err(AsyncRuntimeRejection::new(
        task,
        napi::Error::from_reason("TestRuntime is not running"),
      ));
    }
    self
      .state
      .queued
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner)
      .push(task);
    Ok(())
  }

  fn block_on(&self, future: Pin<&mut dyn Future<Output = ()>>) -> napi::Result<()> {
    futures::executor::block_on(future);
    Ok(())
  }

  fn enter(&self) -> napi::Result<Box<dyn AsyncRuntimeGuard + '_>> {
    self.state.enters.fetch_add(1, Ordering::SeqCst);
    Ok(Box::new(TestRuntimeGuard {
      state: Arc::clone(&self.state),
    }))
  }

  fn start(&self) -> napi::Result<()> {
    self.state.starts.fetch_add(1, Ordering::SeqCst);
    self.state.running.store(true, Ordering::SeqCst);
    Ok(())
  }

  fn shutdown(&self) -> napi::Result<()> {
    self.state.running.store(false, Ordering::SeqCst);
    self.state.shutdowns.fetch_add(1, Ordering::SeqCst);
    let queued = std::mem::take(
      &mut *self
        .state
        .queued
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner),
    );
    drop(queued);
    Ok(())
  }
}

fn start_after_retirement() {
  let deadline = Instant::now() + Duration::from_secs(5);
  loop {
    match try_start_async_runtime() {
      Ok(()) => return,
      Err(error) if error.reason.contains("still shutting down") && Instant::now() < deadline => {
        std::thread::sleep(Duration::from_millis(10));
      }
      Err(error) => panic!("combined custom runtime did not become restartable: {error}"),
    }
  }
}

fn assert_join_cancelled<T: Send + 'static>(
  wait: impl FnOnce() -> T + Send + 'static,
  message: &'static str,
) -> T {
  let (result_tx, result_rx) = mpsc::channel();
  std::thread::spawn(move || result_tx.send(wait()).unwrap());
  result_rx
    .recv_timeout(Duration::from_secs(5))
    .expect(message)
}

#[test]
fn registration_before_use_selects_custom_and_lazily_starts_paired_tokio() {
  let state = Arc::new(RuntimeState::default());
  try_register_async_runtime(TestRuntime {
    state: Arc::clone(&state),
  })
  .unwrap();
  try_start_async_runtime().unwrap();
  assert_eq!(state.starts.load(Ordering::SeqCst), 1);

  within_selected_async_runtime(|| Ok(())).unwrap();
  assert_eq!(state.enters.load(Ordering::SeqCst), 1);
  assert_eq!(state.exits.load(Ordering::SeqCst), 1);

  let custom_pending = spawn_on_custom_runtime(std::future::pending::<()>());
  let tokio_pending = spawn(async {
    std::future::pending::<()>().await;
  });

  try_shutdown_async_runtime().unwrap();
  assert_eq!(state.shutdowns.load(Ordering::SeqCst), 1);
  assert!(assert_join_cancelled(
    move || futures::executor::block_on(custom_pending),
    "custom task cancellation must settle its JoinHandle",
  )
  .unwrap_err()
  .is_cancelled());
  assert!(assert_join_cancelled(
    move || futures::executor::block_on(tokio_pending),
    "lazily started Tokio task cancellation must settle its JoinHandle",
  )
  .unwrap_err()
  .is_cancelled());

  start_after_retirement();
  assert_eq!(state.starts.load(Ordering::SeqCst), 2);
  within_selected_async_runtime(|| Ok(())).unwrap();
  assert_eq!(state.enters.load(Ordering::SeqCst), 2);
  try_shutdown_async_runtime().unwrap();
}
