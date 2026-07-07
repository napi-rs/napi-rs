#![cfg(all(
  feature = "async-runtime",
  not(feature = "tokio_rt"),
  not(feature = "noop")
))]

use std::{
  future::Future,
  pin::Pin,
  sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
  },
};

use napi::bindgen_prelude::{
  spawn_blocking_on_custom_runtime, spawn_on_custom_runtime, try_register_async_runtime,
  try_shutdown_async_runtime, try_start_async_runtime, within_selected_async_runtime, AsyncRuntime,
  AsyncRuntimeTask,
};

struct TestRuntime {
  running: Arc<AtomicBool>,
}

unsafe impl AsyncRuntime for TestRuntime {
  fn spawn(&self, task: AsyncRuntimeTask) -> std::result::Result<(), AsyncRuntimeTask> {
    Err(task)
  }

  fn block_on(&self, future: Pin<&mut dyn Future<Output = ()>>) {
    futures::executor::block_on(future);
  }

  fn start(&self) -> napi::Result<()> {
    self.running.store(true, Ordering::SeqCst);
    Ok(())
  }

  fn shutdown(&self) -> napi::Result<()> {
    self.running.store(false, Ordering::SeqCst);
    Ok(())
  }
}

#[test]
fn missing_backend_is_rejected_by_operations_not_feature_activation() {
  let error = futures::executor::block_on(spawn_on_custom_runtime(async {}))
    .expect_err("spawning without a backend must preserve the configuration error");
  assert!(error.is_runtime_error());
  assert!(error.to_string().contains("No AsyncRuntime backend"));
  let error = futures::executor::block_on(spawn_blocking_on_custom_runtime(|| ()))
    .expect_err("blocking work without a backend must preserve the configuration error");
  assert!(error.is_runtime_error());
  assert!(error.to_string().contains("No AsyncRuntime backend"));

  let error = try_start_async_runtime().expect_err("runtime use must require registration");
  assert!(error.reason.contains("No AsyncRuntime backend"), "{error}");
  let error = within_selected_async_runtime(|| Ok::<_, napi::Error>(()))
    .expect_err("generated entry guards must require registration");
  assert!(error.reason.contains("No AsyncRuntime backend"), "{error}");

  let running = Arc::new(AtomicBool::new(false));
  try_register_async_runtime(TestRuntime {
    running: Arc::clone(&running),
  })
  .expect("a failed operation without an active environment must not freeze backend selection");
  try_start_async_runtime().unwrap();
  assert!(running.load(Ordering::SeqCst));
  try_shutdown_async_runtime().unwrap();
  assert!(!running.load(Ordering::SeqCst));
}
