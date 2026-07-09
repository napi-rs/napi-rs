//! A custom Tokio factory must survive failed startup and repeated lifecycle generations.
#![cfg(all(
  feature = "tokio_rt",
  not(feature = "async-runtime"),
  not(feature = "noop"),
  not(target_family = "wasm"),
  not(target_os = "aix")
))]

use std::{
  sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
  },
  time::{Duration, Instant},
};

use napi::bindgen_prelude::{
  tokio_runtime_retirement_waiter, try_create_custom_tokio_runtime_factory,
  try_shutdown_async_runtime, try_start_async_runtime, try_within_runtime_if_available,
};

fn start_after_retirement() {
  let deadline = Instant::now() + Duration::from_secs(5);
  loop {
    match try_start_async_runtime() {
      Ok(()) => return,
      Err(error) if error.status == napi::Status::WouldDeadlock && Instant::now() < deadline => {
        std::thread::sleep(Duration::from_millis(10));
      }
      Err(error) => panic!("the factory runtime did not become restartable: {error}"),
    }
  }
}

fn wait_for_retirement() {
  let deadline = Instant::now() + Duration::from_secs(5);
  loop {
    match tokio_runtime_retirement_waiter().wait() {
      Ok(()) => return,
      Err(error) if error.status == napi::Status::WouldDeadlock && Instant::now() < deadline => {
        std::thread::sleep(Duration::from_millis(10));
      }
      Err(error) => panic!("the factory runtime did not retire cleanly: {error}"),
    }
  }
}

#[test]
fn factory_is_retryable_and_rebuilds_every_generation() {
  let builds = Arc::new(AtomicUsize::new(0));
  let factory_builds = Arc::clone(&builds);
  try_create_custom_tokio_runtime_factory(move || -> napi::Result<_> {
    let attempt = factory_builds.fetch_add(1, Ordering::SeqCst) + 1;
    tokio_runtime_retirement_waiter().wait()?;
    let reentrant =
      try_start_async_runtime().expect_err("factory reentry must return instead of deadlocking");
    assert_eq!(reentrant.status, napi::Status::WouldDeadlock);
    let cross_thread_reentry = std::thread::spawn(|| {
      let start =
        try_start_async_runtime().expect_err("cross-thread factory reentry must not deadlock");
      let shutdown =
        try_shutdown_async_runtime().expect_err("cross-thread factory shutdown must not deadlock");
      (start.status, shutdown.status)
    })
    .join()
    .expect("the cross-thread lifecycle probe must return");
    assert_eq!(
      cross_thread_reentry,
      (napi::Status::WouldDeadlock, napi::Status::WouldDeadlock)
    );
    match attempt {
      1 => Err(napi::Error::from_reason("injected factory failure")),
      2 => panic!("injected factory panic"),
      _ => tokio::runtime::Builder::new_current_thread()
        .build()
        .map_err(Into::into),
    }
  })
  .expect("the first custom Tokio registration must succeed");

  let error = try_start_async_runtime().expect_err("the first factory failure must be reported");
  assert!(error.reason.contains("injected factory failure"));
  let error = try_start_async_runtime().expect_err("the factory panic must be reported");
  assert!(error.reason.contains("injected factory panic"));

  try_start_async_runtime().expect("the retried factory runtime must start");
  let first_runtime_id =
    try_within_runtime_if_available(|| tokio::runtime::Handle::current().id()).unwrap();
  assert_eq!(builds.load(Ordering::SeqCst), 3);

  try_shutdown_async_runtime().expect("the first factory runtime must shut down");
  wait_for_retirement();

  let first_start = std::thread::spawn(start_after_retirement);
  let second_start = std::thread::spawn(start_after_retirement);
  first_start.join().unwrap();
  second_start.join().unwrap();

  let second_runtime_id =
    try_within_runtime_if_available(|| tokio::runtime::Handle::current().id()).unwrap();
  assert_ne!(second_runtime_id, first_runtime_id);
  assert_eq!(
    builds.load(Ordering::SeqCst),
    4,
    "concurrent startup must construct exactly one replacement generation"
  );
  try_shutdown_async_runtime().expect("the second factory runtime must shut down");
  wait_for_retirement();

  start_after_retirement();
  assert_eq!(builds.load(Ordering::SeqCst), 5);
  try_shutdown_async_runtime().expect("the final factory runtime must shut down");
  wait_for_retirement();
}
