//! Runtime registration and lifecycle failures must be returned instead of unwinding across
//! a library or Node-API boundary.
//!
//! This lives in its own integration-test target because registration is once per linked test
//! image and would cross-contaminate unrelated unit tests.
#![cfg(all(feature = "async-runtime", not(feature = "noop")))]

use std::{
  future::Future,
  pin::Pin,
  sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
  },
  time::{Duration, Instant},
};

#[cfg(feature = "tokio_rt")]
use napi::bindgen_prelude::tokio_runtime_retirement_waiter;
use napi::bindgen_prelude::{
  register_async_runtime, spawn_blocking_on_custom_runtime, spawn_on_custom_runtime,
  try_block_on_custom_runtime, try_register_async_runtime, try_shutdown_async_runtime,
  try_start_async_runtime, try_within_runtime_if_available, AsyncRuntime, AsyncRuntimeRejection,
  AsyncRuntimeTask,
};

static PANIC_START: AtomicBool = AtomicBool::new(false);
static PANIC_SHUTDOWN: AtomicBool = AtomicBool::new(false);
static FAIL_AFTER_PARTIAL_START: AtomicBool = AtomicBool::new(false);
static PARTIAL_RUNTIME_RUNNING: AtomicBool = AtomicBool::new(false);
static FIRST_RUNTIME_RUNNING: AtomicBool = AtomicBool::new(false);
static SHUTDOWN_ON_DUPLICATE_DROP: AtomicBool = AtomicBool::new(false);
static DUPLICATE_DROP_SHUTDOWN_RESULT: Mutex<Option<napi::Result<()>>> = Mutex::new(None);

struct FirstRuntime;

unsafe impl AsyncRuntime for FirstRuntime {
  fn spawn(
    &self,
    task: AsyncRuntimeTask,
  ) -> std::result::Result<(), AsyncRuntimeRejection<AsyncRuntimeTask>> {
    Err(AsyncRuntimeRejection::new(
      task,
      napi::Error::from_reason("FirstRuntime does not accept tasks"),
    ))
  }

  fn block_on(&self, _future: Pin<&mut dyn Future<Output = ()>>) -> napi::Result<()> {
    Ok(())
  }

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
    FIRST_RUNTIME_RUNNING.store(true, Ordering::SeqCst);
    Ok(())
  }

  fn shutdown(&self) -> napi::Result<()> {
    if PANIC_SHUTDOWN.load(Ordering::SeqCst) {
      panic!("backend shutdown panic");
    }
    #[cfg(feature = "tokio_rt")]
    try_within_runtime_if_available(|| ())?;
    PARTIAL_RUNTIME_RUNNING.store(false, Ordering::SeqCst);
    FIRST_RUNTIME_RUNNING.store(false, Ordering::SeqCst);
    Ok(())
  }
}

struct SecondRuntime;

impl Drop for SecondRuntime {
  fn drop(&mut self) {
    if SHUTDOWN_ON_DUPLICATE_DROP.load(Ordering::SeqCst) {
      *DUPLICATE_DROP_SHUTDOWN_RESULT
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(try_shutdown_async_runtime());
      return;
    }
    panic!("duplicate backend destructor panic");
  }
}

unsafe impl AsyncRuntime for SecondRuntime {
  fn spawn(
    &self,
    task: AsyncRuntimeTask,
  ) -> std::result::Result<(), AsyncRuntimeRejection<AsyncRuntimeTask>> {
    Err(AsyncRuntimeRejection::new(
      task,
      napi::Error::from_reason("SecondRuntime does not accept tasks"),
    ))
  }

  fn block_on(&self, _future: Pin<&mut dyn Future<Output = ()>>) -> napi::Result<()> {
    Ok(())
  }

  fn shutdown(&self) -> napi::Result<()> {
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
  #[cfg(feature = "tokio_rt")]
  {
    tokio_runtime_retirement_waiter()
      .wait()
      .expect("the previous Tokio generation must retire before repeated shutdown");
    try_shutdown_async_runtime()
      .expect("the repeated custom shutdown hook may lazily construct its Tokio runtime");
  }

  start_after_retirement();
  SHUTDOWN_ON_DUPLICATE_DROP.store(true, Ordering::SeqCst);
  let error = try_register_async_runtime(SecondRuntime).unwrap_err();
  SHUTDOWN_ON_DUPLICATE_DROP.store(false, Ordering::SeqCst);
  assert!(error.reason.contains("more than once"));
  let shutdown_error = DUPLICATE_DROP_SHUTDOWN_RESULT
    .lock()
    .unwrap_or_else(std::sync::PoisonError::into_inner)
    .take()
    .expect("the duplicate backend destructor must attempt shutdown")
    .expect_err("duplicate backend destruction must not transition the registered runtime");
  assert!(shutdown_error
    .reason
    .contains("inside an AsyncRuntime operation"));
  assert!(
    FIRST_RUNTIME_RUNNING.load(Ordering::SeqCst),
    "rejected backend destruction must leave the registered backend running"
  );
  try_shutdown_async_runtime().expect("the registered backend must remain independently stoppable");

  register_async_runtime(SecondRuntime);

  let error = futures::executor::block_on(spawn_on_custom_runtime(async {}))
    .expect_err("infallible duplicate registration must poison custom task submission");
  assert!(error.is_runtime_error());
  assert!(error.to_string().contains("more than once"), "{error}");

  let error = futures::executor::block_on(spawn_blocking_on_custom_runtime(|| ()))
    .expect_err("infallible duplicate registration must poison custom blocking submission");
  assert!(error.is_runtime_error());
  assert!(error.to_string().contains("more than once"), "{error}");

  let error = try_block_on_custom_runtime(async {})
    .expect_err("infallible duplicate registration must poison custom block_on");
  assert!(error.reason.contains("more than once"), "{error}");

  let error = try_within_runtime_if_available(|| ())
    .expect_err("infallible duplicate registration must poison runtime entry");
  assert!(error.reason.contains("more than once"), "{error}");
}
