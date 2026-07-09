#![cfg(all(feature = "async-runtime", feature = "tokio_rt", not(feature = "noop")))]

use std::{
  future::Future,
  pin::Pin,
  sync::{
    atomic::{AtomicBool, Ordering},
    mpsc,
  },
  time::{Duration, Instant},
};

use napi::bindgen_prelude::{
  spawn, spawn_blocking, try_block_on, try_block_on_custom_runtime, try_register_async_runtime,
  try_shutdown_async_runtime, try_start_async_runtime, within_selected_async_runtime, AsyncRuntime,
  AsyncRuntimeRejection, AsyncRuntimeTask,
};

static REJECTED_RUNTIME_SHUT_DOWN: AtomicBool = AtomicBool::new(false);

struct RejectedRuntime;

unsafe impl AsyncRuntime for RejectedRuntime {
  fn spawn(
    &self,
    task: AsyncRuntimeTask,
  ) -> std::result::Result<(), AsyncRuntimeRejection<AsyncRuntimeTask>> {
    Err(AsyncRuntimeRejection::new(
      task,
      napi::Error::from_reason("RejectedRuntime does not accept tasks"),
    ))
  }

  fn block_on(&self, _future: Pin<&mut dyn Future<Output = ()>>) -> napi::Result<()> {
    Ok(())
  }

  fn shutdown(&self) -> napi::Result<()> {
    REJECTED_RUNTIME_SHUT_DOWN.store(true, Ordering::SeqCst);
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
      Err(error) => panic!("Tokio runtime did not become restartable: {error}"),
    }
  }
}

fn assert_tokio_task_cancelled(handle: tokio::task::JoinHandle<()>) {
  let (result_tx, result_rx) = mpsc::channel();
  std::thread::spawn(move || {
    result_tx.send(futures::executor::block_on(handle)).unwrap();
  });
  let error = result_rx
    .recv_timeout(Duration::from_secs(5))
    .expect("Tokio task cancellation must settle its JoinHandle")
    .expect_err("runtime shutdown must cancel pending Tokio tasks");
  assert!(error.is_cancelled(), "{error}");
}

fn assert_runtime_operation_error(error: napi::Error) {
  assert!(
    error.reason.contains("inside an AsyncRuntime operation"),
    "{error}"
  );
}

#[test]
fn passive_async_runtime_selects_tokio_and_rejects_late_registration() {
  try_start_async_runtime().expect("combined runtime must default to built-in Tokio");

  within_selected_async_runtime(|| {
    tokio::runtime::Handle::try_current()
      .expect("generated async-runtime entry guards must enter selected Tokio");
    Ok(())
  })
  .unwrap();

  let error = try_block_on(async { try_shutdown_async_runtime() })
    .unwrap()
    .expect_err("Tokio block_on work must not shut down its own runtime");
  assert_runtime_operation_error(error);
  let error = within_selected_async_runtime(|| {
    Ok::<_, napi::Error>(
      try_shutdown_async_runtime()
        .expect_err("Tokio runtime entry must not shut down its own guard"),
    )
  })
  .unwrap();
  assert_runtime_operation_error(error);
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
  let blocking = spawn_blocking(try_shutdown_async_runtime);
  assert_runtime_operation_error(
    try_block_on(async { blocking.await.unwrap() })
      .unwrap()
      .expect_err("Tokio blocking work must not shut down its own runtime"),
  );

  let error = try_block_on_custom_runtime(async {})
    .expect_err("explicit custom-only helpers still require a custom backend");
  assert!(error.reason.contains("No AsyncRuntime backend"), "{error}");

  let error = try_register_async_runtime(RejectedRuntime)
    .expect_err("custom registration after Tokio selection must be rejected");
  assert!(error.reason.contains("before the first"), "{error}");
  assert!(
    REJECTED_RUNTIME_SHUT_DOWN.load(Ordering::SeqCst),
    "a rejected unsafe backend must be shut down before it is dropped"
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

  let pending = spawn(async {
    std::future::pending::<()>().await;
  });
  try_shutdown_async_runtime().expect("selected Tokio runtime must shut down");
  assert_tokio_task_cancelled(pending);

  start_after_retirement();
  within_selected_async_runtime(|| {
    tokio::runtime::Handle::try_current().expect("restarted Tokio runtime must be entered");
    Ok(())
  })
  .unwrap();
  try_shutdown_async_runtime().unwrap();
}
