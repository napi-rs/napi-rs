#![cfg(all(feature = "async-runtime", feature = "tokio_rt", not(feature = "noop")))]

use std::{
  future::Future,
  pin::Pin,
  sync::{
    atomic::{AtomicBool, Ordering},
    mpsc,
  },
  time::{Duration, Instant},
};

use napi::bindgen_prelude::{
  spawn, try_block_on_custom_runtime, try_register_async_runtime, try_shutdown_async_runtime,
  try_start_async_runtime, within_selected_async_runtime, AsyncRuntime, AsyncRuntimeTask,
};

static REJECTED_RUNTIME_SHUT_DOWN: AtomicBool = AtomicBool::new(false);

struct RejectedRuntime;

unsafe impl AsyncRuntime for RejectedRuntime {
  fn spawn(&self, task: AsyncRuntimeTask) -> std::result::Result<(), AsyncRuntimeTask> {
    Err(task)
  }

  fn block_on(&self, _future: Pin<&mut dyn Future<Output = ()>>) {}

  fn shutdown(&self) -> napi::Result<()> {
    REJECTED_RUNTIME_SHUT_DOWN.store(true, Ordering::SeqCst);
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
      Err(error) => panic!("Tokio runtime did not become restartable: {error}"),
    }
  }
}

fn assert_tokio_task_cancelled(handle: tokio::task::JoinHandle<()>) {
  let (result_tx, result_rx) = mpsc::channel();
  std::thread::spawn(move || {
    result_tx.send(futures::executor::block_on(handle)).unwrap();
  });
  let error = result_rx
    .recv_timeout(Duration::from_secs(5))
    .expect("Tokio task cancellation must settle its JoinHandle")
    .expect_err("runtime shutdown must cancel pending Tokio tasks");
  assert!(error.is_cancelled(), "{error}");
}

#[test]
fn passive_async_runtime_selects_tokio_and_rejects_late_registration() {
  try_start_async_runtime().expect("combined runtime must default to built-in Tokio");

  within_selected_async_runtime(|| {
    tokio::runtime::Handle::try_current()
      .expect("generated async-runtime entry guards must enter selected Tokio");
    Ok(())
  })
  .unwrap();

  let error = try_block_on_custom_runtime(async {})
    .expect_err("explicit custom-only helpers still require a custom backend");
  assert!(error.reason.contains("No AsyncRuntime backend"), "{error}");

  let error = try_register_async_runtime(RejectedRuntime)
    .expect_err("custom registration after Tokio selection must be rejected");
  assert!(error.reason.contains("before the first"), "{error}");
  assert!(
    REJECTED_RUNTIME_SHUT_DOWN.load(Ordering::SeqCst),
    "a rejected unsafe backend must be shut down before it is dropped"
  );

  let pending = spawn(async {
    std::future::pending::<()>().await;
  });
  try_shutdown_async_runtime().expect("selected Tokio runtime must shut down");
  assert_tokio_task_cancelled(pending);

  start_after_retirement();
  within_selected_async_runtime(|| {
    tokio::runtime::Handle::try_current().expect("restarted Tokio runtime must be entered");
    Ok(())
  })
  .unwrap();
  try_shutdown_async_runtime().unwrap();
}
