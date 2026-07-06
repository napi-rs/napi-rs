//! Explicit Tokio shutdown is sticky until an explicit restart.
#![cfg(all(
  feature = "tokio_rt",
  not(feature = "async-runtime"),
  not(feature = "noop")
))]

use std::{sync::mpsc, time::Duration};

use napi::bindgen_prelude::{
  block_on, create_custom_tokio_runtime, spawn, tokio_runtime_retirement_waiter, try_block_on,
  try_shutdown_async_runtime, try_start_async_runtime, try_within_runtime_if_available,
};

struct WaitForRetirementOnDrop {
  result: mpsc::Sender<napi::Result<()>>,
}

impl Drop for WaitForRetirementOnDrop {
  fn drop(&mut self) {
    self
      .result
      .send(tokio_runtime_retirement_waiter().wait())
      .unwrap();
  }
}

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

  create_custom_tokio_runtime(
    napi::tokio::runtime::Builder::new_current_thread()
      .build()
      .unwrap(),
  );
  try_start_async_runtime().expect("an explicit start must restart Tokio");
  let handle = spawn(async {});
  block_on(async { handle.await.expect("restarted task must complete") });

  let (result_tx, result_rx) = mpsc::channel();
  let (started_tx, started_rx) = mpsc::channel();
  spawn(async move {
    let _wait_on_drop = WaitForRetirementOnDrop { result: result_tx };
    started_tx.send(()).unwrap();
    std::future::pending::<()>().await;
  });
  block_on(async {
    napi::tokio::task::yield_now().await;
  });
  started_rx
    .recv_timeout(Duration::from_secs(5))
    .expect("the pending task must start");

  try_shutdown_async_runtime().expect("the restarted runtime must shut down cleanly");
  assert_eq!(
    result_rx
      .recv_timeout(Duration::from_secs(5))
      .expect("task destruction must not wait for its own runtime retirement")
      .expect_err("retiring-generation destruction must reject its own wait")
      .status,
    napi::Status::WouldDeadlock
  );
  let waiter = tokio_runtime_retirement_waiter();
  let deadline = std::time::Instant::now() + Duration::from_secs(5);
  loop {
    match waiter.wait() {
      Ok(()) => break,
      Err(error)
        if error.status == napi::Status::WouldDeadlock && std::time::Instant::now() < deadline =>
      {
        std::thread::yield_now();
      }
      Err(error) => panic!("runtime retirement did not complete: {error}"),
    }
  }
}
