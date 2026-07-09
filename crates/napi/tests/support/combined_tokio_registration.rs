use std::{
  future::Future,
  pin::Pin,
  sync::atomic::{AtomicUsize, Ordering},
};

use napi::bindgen_prelude::{
  tokio_runtime_retirement_waiter, try_block_on, try_register_async_runtime,
  try_shutdown_async_runtime, try_start_async_runtime, AsyncRuntime, AsyncRuntimeTask,
};

static STARTS: AtomicUsize = AtomicUsize::new(0);

struct TestRuntime;

unsafe impl AsyncRuntime for TestRuntime {
  fn spawn(&self, task: AsyncRuntimeTask) -> std::result::Result<(), AsyncRuntimeTask> {
    Err(task)
  }

  fn block_on(&self, future: Pin<&mut dyn Future<Output = ()>>) {
    futures::executor::block_on(future);
  }

  fn start(&self) -> napi::Result<()> {
    STARTS.fetch_add(1, Ordering::SeqCst);
    Ok(())
  }

  fn shutdown(&self) -> napi::Result<()> {
    Ok(())
  }
}

pub fn start_custom_and_paired_tokio() {
  try_register_async_runtime(TestRuntime).expect("the custom async runtime must register");
  assert_eq!(
    restart_custom_and_paired_tokio().expect("the combined runtimes must start"),
    42
  );
}

pub fn restart_custom_and_paired_tokio() -> napi::Result<i32> {
  try_start_async_runtime()?;
  try_block_on(async { 42 })
}

pub fn shutdown_and_wait() {
  try_shutdown_async_runtime().expect("the combined runtimes must shut down");
  tokio_runtime_retirement_waiter()
    .wait()
    .expect("the paired built-in Tokio runtime must retire");
}

pub fn starts() -> usize {
  STARTS.load(Ordering::SeqCst)
}

pub fn assert_registration_error(error: &napi::Error) {
  #[cfg(any(target_os = "aix", all(target_family = "wasm", tokio_unstable)))]
  assert!(
    error.reason.contains("unsupported on this target"),
    "{error}"
  );
  #[cfg(not(any(target_os = "aix", all(target_family = "wasm", tokio_unstable))))]
  assert!(
    error
      .reason
      .contains("after the first runtime generation has started"),
    "{error}"
  );
}
