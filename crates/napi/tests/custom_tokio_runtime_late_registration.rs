//! Custom Tokio configuration must not report success after runtime selection.
#![cfg(all(
  feature = "tokio_rt",
  not(feature = "async-runtime"),
  not(feature = "noop"),
  not(target_family = "wasm"),
  not(target_os = "aix")
))]

use std::sync::{
  atomic::{AtomicBool, Ordering},
  Arc,
};

use napi::bindgen_prelude::{
  create_custom_tokio_runtime_factory, tokio_runtime_retirement_waiter,
  try_create_custom_tokio_runtime, try_shutdown_async_runtime, try_start_async_runtime,
  try_within_runtime_if_available,
};

#[test]
fn registration_after_default_runtime_start_is_rejected() {
  try_start_async_runtime().expect("the default runtime must start");
  let default_runtime_id =
    try_within_runtime_if_available(|| tokio::runtime::Handle::current().id()).unwrap();

  let late = tokio::runtime::Builder::new_current_thread()
    .build()
    .expect("the late runtime must build");
  let late_runtime_id = late.handle().id();
  let error = try_create_custom_tokio_runtime(late)
    .expect_err("late configuration must not report ambiguous success");
  assert_eq!(error.status, napi::Status::InvalidArg);
  assert!(error.reason.contains("after the first runtime generation"));
  assert_eq!(
    try_within_runtime_if_available(|| tokio::runtime::Handle::current().id()).unwrap(),
    default_runtime_id
  );
  assert_ne!(default_runtime_id, late_runtime_id);

  let factory_called = Arc::new(AtomicBool::new(false));
  let factory_called_from_hook = Arc::clone(&factory_called);
  create_custom_tokio_runtime_factory(move || -> napi::Result<_> {
    factory_called_from_hook.store(true, Ordering::SeqCst);
    unreachable!("a factory registered after startup must never run")
  });
  let error = try_start_async_runtime()
    .expect_err("the infallible wrapper must defer its late-registration error");
  assert!(error.reason.contains("after the first runtime generation"));
  assert!(!factory_called.load(Ordering::SeqCst));

  try_shutdown_async_runtime().expect("the default runtime must shut down");
  tokio_runtime_retirement_waiter()
    .wait()
    .expect("the default runtime must retire");
}
