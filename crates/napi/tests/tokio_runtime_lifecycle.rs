//! Explicit Tokio shutdown is sticky until an explicit restart.
#![cfg(all(
  feature = "tokio_rt",
  not(feature = "async-runtime"),
  not(feature = "noop")
))]

use std::{
  sync::mpsc,
  time::{Duration, Instant},
};

use napi::bindgen_prelude::{
  block_on, create_custom_tokio_runtime, spawn, spawn_blocking, tokio_runtime_retirement_waiter,
  try_block_on, try_shutdown_async_runtime, try_start_async_runtime,
  try_within_runtime_if_available,
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

fn start_after_retirement() {
  let deadline = Instant::now() + Duration::from_secs(5);
  loop {
    match try_start_async_runtime() {
      Ok(()) => return,
      Err(error) if error.status == napi::Status::WouldDeadlock && Instant::now() < deadline => {
        std::thread::sleep(Duration::from_millis(10));
      }
      Err(error) => panic!("Tokio runtime did not become restartable: {error}"),
    }
  }
}

fn assert_runtime_operation_error(error: napi::Error) {
  assert!(
    error.reason.contains("inside an AsyncRuntime operation"),
    "{error}"
  );
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

  assert_runtime_operation_error(
    try_block_on(async { try_shutdown_async_runtime() })
      .unwrap()
      .expect_err("Tokio block_on work must not shut down its own runtime"),
  );
  assert_runtime_operation_error(
    try_within_runtime_if_available(|| {
      try_shutdown_async_runtime().expect_err("Tokio entry must not shut down its own guard")
    })
    .unwrap(),
  );
  let (poll_result_tx, poll_result_rx) = mpsc::channel();
  let poll = spawn(async move {
    poll_result_tx.send(try_shutdown_async_runtime()).unwrap();
  });
  try_block_on(async { poll.await.unwrap() }).unwrap();
  assert_runtime_operation_error(
    poll_result_rx
      .recv_timeout(Duration::from_secs(5))
      .expect("Tokio task poll must report its nested shutdown result")
      .expect_err("Tokio task poll must not shut down its own runtime"),
  );
  assert_runtime_operation_error(
    try_block_on(async { spawn_blocking(try_shutdown_async_runtime).await.unwrap() })
      .unwrap()
      .expect_err("Tokio blocking work must not shut down its own runtime"),
  );

  let (entered_tx, entered_rx) = mpsc::channel();
  let (release_tx, release_rx) = mpsc::channel();
  let runtime_use = std::thread::spawn(move || {
    try_block_on(async move {
      entered_tx.send(()).unwrap();
      release_rx.recv().unwrap();
    })
  });
  entered_rx
    .recv_timeout(Duration::from_secs(5))
    .expect("the synchronous Tokio use must start");
  let (shutdown_tx, shutdown_rx) = mpsc::channel();
  let first_shutdown_tx = shutdown_tx.clone();
  let first_shutdown = std::thread::spawn(move || {
    first_shutdown_tx
      .send(try_shutdown_async_runtime())
      .unwrap();
  });
  let second_shutdown = std::thread::spawn(move || {
    shutdown_tx.send(try_shutdown_async_runtime()).unwrap();
  });
  let contention_error = shutdown_rx
    .recv_timeout(Duration::from_secs(5))
    .expect("one shutdown contender must observe transition ownership")
    .expect_err("the admitted synchronous use must keep the transition owner blocked");
  assert_eq!(contention_error.status, napi::Status::WouldDeadlock);
  assert!(
    contention_error.reason.contains("transition"),
    "{contention_error}"
  );
  assert!(
    matches!(shutdown_rx.try_recv(), Err(mpsc::TryRecvError::Empty)),
    "shutdown must wait for admitted synchronous Tokio use"
  );
  release_tx.send(()).unwrap();
  runtime_use.join().unwrap().unwrap();
  shutdown_rx
    .recv_timeout(Duration::from_secs(5))
    .expect("shutdown must resume after synchronous Tokio use")
    .unwrap();
  first_shutdown.join().unwrap();
  second_shutdown.join().unwrap();
  start_after_retirement();

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
