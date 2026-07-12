//! Compile-checked API-superset contract: every scheduler item that rolldown
//! consumes from its former `rolldown_utils::async_runtime` module (plus the
//! crate-root worker-cap helpers) must stay `pub` at this crate's root with an
//! identical monomorphic signature, so rolldown can replace that module with
//! `pub use napi_async_runtime::*;` and compile unmodified.

#![allow(unused_imports)]

use std::{future::Future, pin::Pin, sync::Arc, time::Instant};

use napi_async_runtime::{
  // types / traits
  BlockOnDeadlock,
  BlockOnDeadlockKind,
  CurrentThreadTaskCallbackLease,
  CurrentThreadTaskDelivery,
  CurrentThreadTaskDriver,
  CurrentThreadTaskDriverId,
  JoinError,
  JoinHandle,
  // crate-root helpers (formerly rolldown_utils/lib.rs)
  MAX_ASYNC_RUNTIME_WORKER_THREADS,
  PARK_DEADLINE_ENV,
  RuntimeConfigError,
  RuntimeFlavor,
  RuntimeMetricsSnapshot,
  RuntimeOptions,
  RuntimeOptionsPatch,
  Sleep,
  TimerDriver,
  TimerDriverId,
  TimerId,
  // functions
  acknowledge_current_thread_task_delivery,
  block_on,
  block_on_dyn,
  cancel_current_thread_task_dispatch,
  configure,
  configure_partial,
  configured_options,
  drive_current_thread_tasks,
  fail_current_thread_task_delivery,
  has_live_timer_driver,
  is_multi_threaded,
  max_async_runtime_worker_threads,
  metrics,
  register_current_thread_task_driver,
  register_timer_driver,
  request_current_thread_task_drain,
  reset_metrics,
  shutdown,
  sleep_until,
  spawn,
  spawn_blocking,
  spawn_detached,
  start,
  try_block_on_dyn,
  try_spawn,
  try_spawn_blocking,
  try_spawn_detached,
  unregister_current_thread_task_driver,
  unregister_timer_driver,
};

#[test]
fn consumed_api_signatures_are_stable() {
  // Monomorphic signatures pinned exactly.
  let _: usize = MAX_ASYNC_RUNTIME_WORKER_THREADS;
  let _: fn() -> usize = max_async_runtime_worker_threads;
  let _: &str = PARK_DEADLINE_ENV;
  let _: fn(RuntimeOptions) -> Result<(), RuntimeConfigError> = configure;
  let _: fn(RuntimeOptionsPatch) -> Result<(), RuntimeConfigError> = configure_partial;
  let _: fn() -> RuntimeOptions = configured_options;
  let _: fn() -> bool = is_multi_threaded;
  let _: fn() -> bool = has_live_timer_driver;
  let _: fn() -> Result<(), RuntimeConfigError> = start;
  let _: fn() -> Result<(), RuntimeConfigError> = shutdown;
  let _: fn() = reset_metrics;
  let _: fn() = request_current_thread_task_drain;
  let _: fn() -> RuntimeMetricsSnapshot = metrics;
  let _: fn(Instant) -> Sleep = sleep_until;
  let _: fn(Pin<&mut dyn Future<Output = ()>>) = block_on_dyn;
  let _: fn(
    Pin<&mut dyn Future<Output = ()>>,
  ) -> Result<(), napi_async_runtime::RuntimeConfigError> = try_block_on_dyn;
  let _: fn(CurrentThreadTaskDelivery) = acknowledge_current_thread_task_delivery;
  let _: fn(CurrentThreadTaskDelivery) = fail_current_thread_task_delivery;
  let _: fn(u64) = cancel_current_thread_task_dispatch;
  let _: fn(u64) -> Option<CurrentThreadTaskCallbackLease> = drive_current_thread_tasks;
  let _: fn(Arc<dyn CurrentThreadTaskDriver>) -> CurrentThreadTaskDriverId =
    register_current_thread_task_driver;
  let _: fn(CurrentThreadTaskDriverId) = unregister_current_thread_task_driver;
  let _: fn(Arc<dyn TimerDriver>) -> TimerDriverId = register_timer_driver;
  let _: fn(TimerDriverId) = unregister_timer_driver;
  let _: TimerId = 0_u64;

  // Generic spawn facade, instantiated the way rolldown_utils/futures.rs
  // (spawn/try_spawn/spawn_detached/spawn_blocking/block_on) consumes it.
  fn spawn_facade() {
    let _: fn(std::future::Ready<u8>) -> JoinHandle<u8> = spawn::<std::future::Ready<u8>, u8>;
    let _: fn(
      std::future::Ready<u8>,
    ) -> Result<JoinHandle<u8>, (RuntimeConfigError, std::future::Ready<u8>)> =
      try_spawn::<std::future::Ready<u8>, u8>;
    let _: fn(std::future::Ready<()>) -> Result<(), std::future::Ready<()>> =
      try_spawn_detached::<std::future::Ready<()>>;
    let _: fn(std::future::Ready<()>) = spawn_detached::<std::future::Ready<()>>;
    let _: fn(fn() -> u8) -> JoinHandle<u8> = spawn_blocking::<fn() -> u8, u8>;
    let _: fn(fn() -> u8) -> Result<JoinHandle<u8>, (RuntimeConfigError, fn() -> u8)> =
      try_spawn_blocking::<fn() -> u8, u8>;
    let _: fn(std::future::Ready<u8>) -> u8 = block_on::<std::future::Ready<u8>>;
  }
  let _ = spawn_facade;

  // `JoinError` type re-export used by `rolldown_utils::futures` and the
  // `JoinHandle` future output shape.
  fn join_handle_output(handle: JoinHandle<u8>) -> impl Future<Output = Result<u8, JoinError>> {
    handle
  }
  let _ = join_handle_output;
}
