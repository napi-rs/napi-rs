#[cfg(all(
  feature = "async-runtime",
  feature = "tokio",
  not(feature = "tokio_rt"),
  not(feature = "noop")
))]
#[test]
fn custom_tokio_runtime_requires_tokio_rt() {
  let runtime = tokio::runtime::Builder::new_current_thread()
    .build()
    .expect("test runtime should build");
  let error = napi::bindgen_prelude::try_create_custom_tokio_runtime(runtime)
    .expect_err("a runtime that cannot be installed must not report success");

  assert_eq!(error.status, napi::Status::InvalidArg);
  assert!(error.reason.contains("tokio_rt feature is not enabled"));
}

#[cfg(all(feature = "noop", feature = "async-runtime", feature = "tokio"))]
#[test]
fn custom_tokio_runtime_is_rejected_by_noop_builds() {
  let runtime = tokio::runtime::Builder::new_current_thread()
    .build()
    .expect("test runtime should build");
  let error = napi::bindgen_prelude::try_create_custom_tokio_runtime(runtime)
    .expect_err("a noop build cannot install a runtime");

  assert_eq!(error.status, napi::Status::InvalidArg);
  assert!(error.reason.contains("noop build"));
}

#[cfg(all(feature = "noop", feature = "async-runtime"))]
#[test]
fn custom_async_runtime_is_retired_and_rejected_by_noop_builds() {
  use std::{
    future::Future,
    pin::Pin,
    sync::{
      atomic::{AtomicBool, Ordering},
      Arc,
    },
  };

  use napi::bindgen_prelude::{AsyncRuntime, AsyncRuntimeTask};

  struct NoopRuntime {
    dropped: Arc<AtomicBool>,
    shut_down: Arc<AtomicBool>,
  }

  impl Drop for NoopRuntime {
    fn drop(&mut self) {
      self.dropped.store(true, Ordering::SeqCst);
    }
  }

  unsafe impl AsyncRuntime for NoopRuntime {
    fn spawn(&self, task: AsyncRuntimeTask) -> std::result::Result<(), AsyncRuntimeTask> {
      Err(task)
    }

    fn block_on(&self, _future: Pin<&mut dyn Future<Output = ()>>) {}

    fn shutdown(&self) -> napi::Result<()> {
      self.shut_down.store(true, Ordering::SeqCst);
      Ok(())
    }
  }

  let dropped = Arc::new(AtomicBool::new(false));
  let shut_down = Arc::new(AtomicBool::new(false));
  let error = napi::bindgen_prelude::try_register_async_runtime(NoopRuntime {
    dropped: Arc::clone(&dropped),
    shut_down: Arc::clone(&shut_down),
  })
  .expect_err("a noop build cannot install a custom async runtime");

  assert_eq!(error.status, napi::Status::InvalidArg);
  assert!(error.reason.contains("noop build"));
  assert!(shut_down.load(Ordering::SeqCst));
  assert!(dropped.load(Ordering::SeqCst));
}

#[cfg(all(
  feature = "tokio_rt",
  not(feature = "noop"),
  not(target_family = "wasm"),
  not(target_os = "aix")
))]
#[test]
fn infallible_duplicate_tokio_configuration_keeps_first_registration_usable() {
  use napi::bindgen_prelude::{
    create_custom_tokio_runtime, try_block_on, try_create_custom_tokio_runtime,
    try_shutdown_async_runtime, try_start_async_runtime,
  };

  let runtime = tokio::runtime::Builder::new_current_thread()
    .build()
    .expect("first test runtime should build");
  create_custom_tokio_runtime(runtime);

  let duplicate = tokio::runtime::Builder::new_current_thread()
    .build()
    .expect("fallible duplicate test runtime should build");
  let error = try_create_custom_tokio_runtime(duplicate)
    .expect_err("the fallible API must still report duplicate configuration");
  assert_eq!(error.status, napi::Status::InvalidArg);
  assert!(error.reason.contains("called more than once"));

  let ignored_duplicate = tokio::runtime::Builder::new_current_thread()
    .build()
    .expect("infallible duplicate test runtime should build");
  create_custom_tokio_runtime(ignored_duplicate);

  try_start_async_runtime().expect("an ignored duplicate must not poison Tokio startup");
  assert_eq!(try_block_on(async { 42 }).unwrap(), 42);
  try_shutdown_async_runtime().expect("the winning Tokio runtime should shut down");
}
