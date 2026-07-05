//! Compile-time coverage for runtime helper signatures across additive Cargo features.
#![cfg(not(feature = "noop"))]

#[cfg(any(feature = "async-runtime", feature = "tokio_rt"))]
#[test]
fn async_block_terminal_finalizer_builder_is_feature_stable() {
  use std::sync::Arc;

  use napi::bindgen_prelude::AsyncBlockBuilder;

  let terminal_capture = Arc::new(());
  let builder = AsyncBlockBuilder::new(async { Ok(42_u8) }).with_terminal_finalizer(move || {
    drop(terminal_capture);
  });
  drop(builder);

  let terminal_capture = Arc::new(());
  let builder = AsyncBlockBuilder::with(async { Ok(42_u8) }).with_terminal_finalizer(move || {
    drop(terminal_capture);
  });
  drop(builder);

  let terminal_capture = Arc::new(());
  let dispose_capture = Arc::new(());
  let builder = AsyncBlockBuilder::with(async { Ok(42_u8) })
    .with_terminal_finalizer(move || {
      drop(terminal_capture);
    })
    .with_dispose(move |_| {
      drop(dispose_capture);
      Ok(())
    });
  drop(builder);

  let terminal_capture = Arc::new(());
  let dispose_capture = Arc::new(());
  let builder = AsyncBlockBuilder::with(async { Ok(42_u8) })
    .with_dispose(move |_| {
      drop(dispose_capture);
      Ok(())
    })
    .with_terminal_finalizer(move || {
      drop(terminal_capture);
    });
  drop(builder);
}

#[cfg(feature = "async-runtime")]
#[test]
fn custom_runtime_helper_signatures_are_feature_stable() {
  use std::{future::Future, pin::Pin};

  use napi::bindgen_prelude::{
    block_on_custom_runtime, spawn_blocking_on_custom_runtime, spawn_on_custom_runtime,
    try_block_on_custom_runtime, within_custom_runtime_if_available, AsyncRuntime,
    AsyncRuntimeTask, JoinHandle,
  };

  struct CompileRuntime;

  impl AsyncRuntime for CompileRuntime {
    fn spawn(&self, task: AsyncRuntimeTask) -> std::result::Result<(), AsyncRuntimeTask> {
      Err(task)
    }

    fn block_on(&self, _future: Pin<&mut dyn Future<Output = ()>>) {}
  }

  fn assert_spawn_signature() -> JoinHandle<u8> {
    spawn_on_custom_runtime(async { 42 })
  }

  fn assert_spawn_blocking_signature() -> JoinHandle<u8> {
    spawn_blocking_on_custom_runtime(|| 42)
  }

  fn assert_block_on_signature() -> u8 {
    block_on_custom_runtime(async { 42 })
  }

  fn assert_try_block_on_signature() -> napi::Result<u8> {
    try_block_on_custom_runtime(async { 42 })
  }

  fn assert_enter_signature() -> napi::Result<u8> {
    within_custom_runtime_if_available(|| Ok(42))
  }

  let _ = assert_spawn_signature as fn() -> JoinHandle<u8>;
  let _ = assert_spawn_blocking_signature as fn() -> JoinHandle<u8>;
  let _ = assert_block_on_signature as fn() -> u8;
  let _ = assert_try_block_on_signature as fn() -> napi::Result<u8>;
  let _ = assert_enter_signature as fn() -> napi::Result<u8>;

  let _ = napi::bindgen_prelude::register_async_runtime::<CompileRuntime> as fn(CompileRuntime);
  let _ = napi::bindgen_prelude::try_register_async_runtime::<CompileRuntime>
    as fn(CompileRuntime) -> napi::Result<()>;

  #[allow(deprecated)]
  {
    let _ =
      napi::bindgen_prelude::create_custom_async_runtime::<CompileRuntime> as fn(CompileRuntime);
    let _ = napi::bindgen_prelude::try_create_custom_async_runtime::<CompileRuntime>
      as fn(CompileRuntime) -> napi::Result<()>;
  }
}

#[cfg(feature = "tokio_rt")]
#[test]
fn tokio_runtime_helper_signatures_remain_compatible() {
  use napi::bindgen_prelude::{
    async_runtime_retirement_waiter, spawn, spawn_blocking, AsyncRuntimeRetirementWaiter,
  };

  fn assert_spawn_signature() -> tokio::task::JoinHandle<()> {
    spawn(async {})
  }

  fn assert_spawn_blocking_signature() -> tokio::task::JoinHandle<u8> {
    spawn_blocking(|| 42)
  }

  fn assert_retirement_waiter_signature() -> AsyncRuntimeRetirementWaiter {
    async_runtime_retirement_waiter()
  }

  fn assert_retirement_wait_signature(waiter: &AsyncRuntimeRetirementWaiter) -> napi::Result<()> {
    waiter.wait()
  }

  fn assert_retirement_cancel_signature(waiter: &AsyncRuntimeRetirementWaiter) {
    waiter.cancel();
  }

  fn assert_waiter_traits<T: Clone + Send + Sync>() {}

  let _ = assert_spawn_signature as fn() -> tokio::task::JoinHandle<()>;
  let _ = assert_spawn_blocking_signature as fn() -> tokio::task::JoinHandle<u8>;
  let _ = assert_retirement_waiter_signature as fn() -> AsyncRuntimeRetirementWaiter;
  let _ = assert_retirement_wait_signature as fn(&AsyncRuntimeRetirementWaiter) -> napi::Result<()>;
  let _ = assert_retirement_cancel_signature as fn(&AsyncRuntimeRetirementWaiter);
  assert_waiter_traits::<AsyncRuntimeRetirementWaiter>();
}
