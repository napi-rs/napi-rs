//! Explicit Tokio shutdown is sticky until an explicit restart.
#![cfg(all(
  feature = "tokio_rt",
  not(feature = "async-runtime"),
  not(feature = "noop")
))]

use napi::bindgen_prelude::{
  block_on, spawn, try_block_on, try_shutdown_async_runtime, try_start_async_runtime,
  try_within_runtime_if_available,
};

#[test]
fn shutdown_before_first_use_requires_an_explicit_restart() {
  try_shutdown_async_runtime().expect("shutdown before first use must succeed");

  let error = std::panic::catch_unwind(|| spawn(async {}))
    .expect_err("a free helper must not implicitly restart a stopped runtime");
  let message = error
    .downcast_ref::<String>()
    .map(String::as_str)
    .or_else(|| error.downcast_ref::<&str>().copied())
    .unwrap_or_default();
  assert!(message.contains("call start_async_runtime"));
  assert!(try_block_on(async {}).is_err());
  assert!(try_within_runtime_if_available(|| 42).is_err());

  try_start_async_runtime().expect("an explicit start must restart Tokio");
  let handle = spawn(async {});
  block_on(async { handle.await.expect("restarted task must complete") });

  try_shutdown_async_runtime().expect("the restarted runtime must shut down cleanly");
}
