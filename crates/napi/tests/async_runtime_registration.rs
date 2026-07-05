//! Runtime registration and lifecycle failures must be returned instead of unwinding across
//! a library or Node-API boundary.
//!
//! This lives in its own integration-test target because registration is once per linked test
//! image and would cross-contaminate unrelated unit tests.
#![cfg(all(feature = "async-runtime", not(feature = "noop")))]

use std::{
  future::Future,
  pin::Pin,
  sync::atomic::{AtomicBool, Ordering},
  time::{Duration, Instant},
};

use napi::bindgen_prelude::{
  register_async_runtime, try_register_async_runtime, try_shutdown_async_runtime,
  try_start_async_runtime, AsyncRuntime, AsyncRuntimeTask,
};

static PANIC_START: AtomicBool = AtomicBool::new(false);
static PANIC_SHUTDOWN: AtomicBool = AtomicBool::new(false);
static FAIL_AFTER_PARTIAL_START: AtomicBool = AtomicBool::new(false);
static PARTIAL_RUNTIME_RUNNING: AtomicBool = AtomicBool::new(false);

struct FirstRuntime;

impl AsyncRuntime for FirstRuntime {
  fn spawn(&self, task: AsyncRuntimeTask) -> std::result::Result<(), AsyncRuntimeTask> {
    Err(task)
  }

  fn block_on(&self, _future: Pin<&mut dyn Future<Output = ()>>) {}

  fn start(&self) -> napi::Result<()> {
    if PANIC_START.load(Ordering::SeqCst) {
      panic!("backend start panic");
    }
    if FAIL_AFTER_PARTIAL_START.load(Ordering::SeqCst) {
      PARTIAL_RUNTIME_RUNNING.store(true, Ordering::SeqCst);
      return Err(napi::Error::new(
        napi::Status::GenericFailure,
        "backend failed after partial start",
      ));
    }
    Ok(())
  }

  fn shutdown(&self) -> napi::Result<()> {
    if PANIC_SHUTDOWN.load(Ordering::SeqCst) {
      panic!("backend shutdown panic");
    }
    PARTIAL_RUNTIME_RUNNING.store(false, Ordering::SeqCst);
    Ok(())
  }
}

struct SecondRuntime;

impl Drop for SecondRuntime {
  fn drop(&mut self) {
    panic!("duplicate backend destructor panic");
  }
}

impl AsyncRuntime for SecondRuntime {
  fn spawn(&self, task: AsyncRuntimeTask) -> std::result::Result<(), AsyncRuntimeTask> {
    Err(task)
  }

  fn block_on(&self, _future: Pin<&mut dyn Future<Output = ()>>) {}
}

fn start_after_retirement() {
  let deadline = Instant::now() + Duration::from_secs(5);
  loop {
    match try_start_async_runtime() {
      Ok(()) => return,
      Err(error) if error.reason.contains("still shutting down") && Instant::now() < deadline => {
        std::thread::sleep(Duration::from_millis(10));
      }
      Err(error) => panic!("runtime did not become restartable: {error}"),
    }
  }
}

fn start_after_retirement_expect_error(expected: &str) -> napi::Error {
  let deadline = Instant::now() + Duration::from_secs(5);
  loop {
    match try_start_async_runtime() {
      Ok(()) => panic!("runtime unexpectedly started"),
      Err(error) if error.reason.contains("still shutting down") && Instant::now() < deadline => {
        std::thread::sleep(Duration::from_millis(10));
      }
      Err(error) => {
        assert!(error.reason.contains(expected), "{error}");
        return error;
      }
    }
  }
}

#[test]
fn registration_and_lifecycle_failures_return_errors() {
  register_async_runtime(FirstRuntime);

  PANIC_START.store(true, Ordering::SeqCst);
  let error = try_start_async_runtime().expect_err("start panic must be contained");
  assert!(error.reason.contains("backend start panic"));
  PANIC_START.store(false, Ordering::SeqCst);
  start_after_retirement();

  try_shutdown_async_runtime().expect("runtime must stop before partial-start rollback coverage");
  FAIL_AFTER_PARTIAL_START.store(true, Ordering::SeqCst);
  let _ = start_after_retirement_expect_error("backend failed after partial start");
  assert!(
    !PARTIAL_RUNTIME_RUNNING.load(Ordering::SeqCst),
    "failed startup must invoke backend shutdown before restart is allowed"
  );
  FAIL_AFTER_PARTIAL_START.store(false, Ordering::SeqCst);
  start_after_retirement();

  PANIC_SHUTDOWN.store(true, Ordering::SeqCst);
  let error = try_shutdown_async_runtime().expect_err("shutdown panic must be contained");
  assert!(error.reason.contains("backend shutdown panic"));
  PANIC_SHUTDOWN.store(false, Ordering::SeqCst);
  let error = try_start_async_runtime()
    .expect_err("runtime must not restart while the previous generation may still be alive");
  assert!(error.reason.contains("backend shutdown panic"));
  try_shutdown_async_runtime().expect("a failed shutdown must be retryable");
  start_after_retirement();
  try_shutdown_async_runtime().expect("runtime must shut down after retry");

  let error = try_register_async_runtime(SecondRuntime).unwrap_err();
  assert!(error.reason.contains("more than once"));
}
