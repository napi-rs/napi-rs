#[cfg(all(
  feature = "async-runtime",
  feature = "tokio",
  not(feature = "tokio_rt"),
  not(feature = "noop")
))]
#[test]
fn custom_tokio_runtime_factory_requires_tokio_rt() {
  let error = napi::bindgen_prelude::try_create_custom_tokio_runtime_factory(
    || -> napi::Result<tokio::runtime::Runtime> {
      panic!("an unsupported factory must not be invoked")
    },
  )
  .expect_err("a runtime factory that cannot be installed must not report success");

  assert_eq!(error.status, napi::Status::InvalidArg);
  assert!(error.reason.contains("tokio_rt feature is not enabled"));
}

#[cfg(all(feature = "noop", feature = "async-runtime", feature = "tokio"))]
#[test]
fn custom_tokio_runtime_factory_is_rejected_by_noop_builds() {
  let error = napi::bindgen_prelude::try_create_custom_tokio_runtime_factory(
    || -> napi::Result<tokio::runtime::Runtime> { panic!("a noop factory must not be invoked") },
  )
  .expect_err("a noop build cannot install a runtime factory");

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

  use napi::bindgen_prelude::{AsyncRuntime, AsyncRuntimeRejection, AsyncRuntimeTask};

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
    fn spawn(
      &self,
      task: AsyncRuntimeTask,
    ) -> std::result::Result<(), AsyncRuntimeRejection<AsyncRuntimeTask>> {
      Err(AsyncRuntimeRejection::new(
        task,
        napi::Error::from_reason("NoopRuntime does not accept tasks"),
      ))
    }

    fn block_on(&self, _future: Pin<&mut dyn Future<Output = ()>>) -> napi::Result<()> {
      Ok(())
    }

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
fn custom_tokio_runtime_registration_remains_consumed_after_startup() {
  use std::{
    sync::mpsc,
    time::{Duration, Instant},
  };

  use napi::bindgen_prelude::{
    create_custom_tokio_runtime, tokio_runtime_retirement_waiter, try_block_on,
    try_create_custom_tokio_runtime, try_shutdown_async_runtime, try_start_async_runtime,
    try_within_runtime_if_available,
  };

  let runtime = tokio::runtime::Builder::new_current_thread()
    .build()
    .expect("first test runtime should build");
  let first_runtime_id = runtime.handle().id();
  create_custom_tokio_runtime(runtime);
  try_start_async_runtime().expect("the first custom Tokio runtime must start");
  assert_eq!(
    try_within_runtime_if_available(|| tokio::runtime::Handle::current().id()).unwrap(),
    first_runtime_id
  );

  let (late_started_tx, late_started_rx) = mpsc::channel();
  let (late_stopped_tx, late_stopped_rx) = mpsc::channel();
  let duplicate = tokio::runtime::Builder::new_multi_thread()
    .worker_threads(1)
    .on_thread_stop(move || {
      let _ = late_stopped_tx.send(());
    })
    .build()
    .expect("fallible duplicate test runtime should build");
  let duplicate_runtime_id = duplicate.handle().id();
  drop(duplicate.spawn(async move {
    late_started_tx.send(()).unwrap();
    std::future::pending::<()>().await;
  }));
  late_started_rx
    .recv_timeout(Duration::from_secs(5))
    .expect("the rejected threaded runtime must start its worker");
  let error = try_create_custom_tokio_runtime(duplicate)
    .expect_err("registration after startup must remain a duplicate");
  assert_eq!(error.status, napi::Status::InvalidArg);
  assert!(
    error.reason.contains("first registration permanently owns"),
    "{error}"
  );
  late_stopped_rx
    .recv_timeout(Duration::from_secs(5))
    .expect("the rejected threaded runtime must be retired");
  assert_eq!(
    try_within_runtime_if_available(|| tokio::runtime::Handle::current().id()).unwrap(),
    first_runtime_id,
    "a rejected registration must not replace the running generation"
  );

  let ignored_duplicate = tokio::runtime::Builder::new_current_thread()
    .build()
    .expect("infallible duplicate test runtime should build");
  let ignored_duplicate_id = ignored_duplicate.handle().id();
  create_custom_tokio_runtime(ignored_duplicate);

  assert_eq!(
    try_within_runtime_if_available(|| tokio::runtime::Handle::current().id()).unwrap(),
    first_runtime_id,
    "the compatibility wrapper must preserve first-registration-wins behavior"
  );
  assert_eq!(try_block_on(async { 42 }).unwrap(), 42);
  try_shutdown_async_runtime().expect("the winning Tokio runtime should shut down");

  let deadline = Instant::now() + Duration::from_secs(5);
  loop {
    match try_start_async_runtime() {
      Ok(()) => break,
      Err(error) if error.status == napi::Status::WouldDeadlock && Instant::now() < deadline => {
        std::thread::sleep(Duration::from_millis(10));
      }
      Err(error) => panic!("the Tokio runtime did not become restartable: {error}"),
    }
  }

  let restarted_runtime_id =
    try_within_runtime_if_available(|| tokio::runtime::Handle::current().id()).unwrap();
  assert_ne!(restarted_runtime_id, first_runtime_id);
  assert_ne!(restarted_runtime_id, duplicate_runtime_id);
  assert_ne!(restarted_runtime_id, ignored_duplicate_id);

  let post_restart_duplicate = tokio::runtime::Builder::new_current_thread()
    .build()
    .expect("post-restart duplicate test runtime should build");
  let error = try_create_custom_tokio_runtime(post_restart_duplicate)
    .expect_err("restart must not reopen the consumed registration");
  assert_eq!(error.status, napi::Status::InvalidArg);
  assert_eq!(
    try_within_runtime_if_available(|| tokio::runtime::Handle::current().id()).unwrap(),
    restarted_runtime_id
  );
  try_shutdown_async_runtime().expect("the restarted Tokio runtime should shut down");
  tokio_runtime_retirement_waiter()
    .wait()
    .expect("the restarted built-in runtime should retire");
}
