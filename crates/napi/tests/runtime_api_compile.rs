//! Compile-time coverage for runtime helper signatures across additive Cargo features.
#![cfg(not(feature = "noop"))]

#[test]
fn promise_raw_constructor_requires_raw_handle_invariants() {
  use std::marker::PhantomData;

  use napi::{bindgen_prelude::PromiseRaw, sys};

  fn assert_signature<'env>(_: PhantomData<&'env ()>) {
    let _: unsafe fn(sys::napi_env, sys::napi_value) -> PromiseRaw<'env, ()> = PromiseRaw::new;
  }

  assert_signature(PhantomData);
}

#[cfg(feature = "napi4")]
#[test]
fn threadsafe_function_quiescence_finalizer_apis_are_unsafe() {
  use napi::{
    bindgen_prelude::ThreadsafeFunctionBuilder,
    threadsafe_function::{ThreadsafeCallContext, ThreadsafeFunction},
    Result, Status,
  };

  type CompileThreadsafeFunction = ThreadsafeFunction<(), (), (), Status, false, false, 0>;
  type CompileThreadsafeFunctionBuilder<'env> =
    ThreadsafeFunctionBuilder<'env, (), (), (), Status, false, false, 0>;
  type CompileCallback = fn(ThreadsafeCallContext<()>) -> Result<()>;

  let _: unsafe fn(&CompileThreadsafeFunction, fn()) -> Result<()> =
    CompileThreadsafeFunction::register_finalizer::<fn()>;
  let _: fn(&CompileThreadsafeFunction) -> Result<()> = CompileThreadsafeFunction::abort;

  fn assert_builder_signatures<'env>(_: std::marker::PhantomData<&'env ()>) {
    let _: unsafe fn(
      &CompileThreadsafeFunctionBuilder<'env>,
      fn(),
    ) -> Result<CompileThreadsafeFunction> =
      CompileThreadsafeFunctionBuilder::build_with_finalizer::<fn()>;
    let _: unsafe fn(
      &CompileThreadsafeFunctionBuilder<'env>,
      CompileCallback,
      fn(),
    ) -> Result<CompileThreadsafeFunction> =
      CompileThreadsafeFunctionBuilder::build_callback_with_finalizer::<(), CompileCallback, fn()>;
  }

  assert_builder_signatures(std::marker::PhantomData);
}

#[cfg(feature = "napi4")]
#[test]
fn threadsafe_function_builder_callback_remains_js_thread_only() {
  use std::{cell::Cell, rc::Rc};

  use napi::{
    bindgen_prelude::{JsValuesTupleIntoVec, ThreadsafeFunctionBuilder},
    threadsafe_function::{ThreadsafeCallContext, ThreadsafeFunction},
    Result, Status,
  };

  struct JsThreadOnlyArgs(Rc<Cell<u32>>);

  impl JsValuesTupleIntoVec for JsThreadOnlyArgs {
    fn into_vec(self, _env: napi::sys::napi_env) -> Result<Vec<napi::sys::napi_value>> {
      self.0.set(self.0.get() + 1);
      Ok(Vec::new())
    }
  }

  type CompileThreadsafeFunction =
    ThreadsafeFunction<u32, (), JsThreadOnlyArgs, Status, false, false, 0>;
  type CompileThreadsafeFunctionBuilder<'env> =
    ThreadsafeFunctionBuilder<'env, u32, (), (), Status, false, false, 0>;

  fn build_with_local_callback(
    builder: &CompileThreadsafeFunctionBuilder<'_>,
  ) -> Result<CompileThreadsafeFunction> {
    let state = Rc::new(Cell::new(0));
    builder.build_callback(move |ctx: ThreadsafeCallContext<u32>| {
      state.set(ctx.value);
      Ok(JsThreadOnlyArgs(Rc::clone(&state)))
    })
  }

  fn assert_send_sync<T: Send + Sync>() {}

  let _ = build_with_local_callback
    as fn(&CompileThreadsafeFunctionBuilder<'_>) -> Result<CompileThreadsafeFunction>;
  assert_send_sync::<ThreadsafeFunction<Rc<Cell<u32>>, (), (), Status, false, false, 0>>();
}

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
    try_block_on_custom_runtime, within_selected_async_runtime, AsyncRuntime, AsyncRuntimeTask,
    JoinHandle,
  };

  struct CompileRuntime;

  unsafe impl AsyncRuntime for CompileRuntime {
    fn spawn(&self, task: AsyncRuntimeTask) -> std::result::Result<(), AsyncRuntimeTask> {
      Err(task)
    }

    fn block_on(&self, _future: Pin<&mut dyn Future<Output = ()>>) {}

    fn shutdown(&self) -> napi::Result<()> {
      Ok(())
    }
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
    within_selected_async_runtime(|| Ok(42))
  }

  fn assert_codegen_enter_signature() -> napi::Result<u8> {
    napi::__private::codegen_v1::within_selected_async_runtime(|| Ok(42))
  }

  let _ = assert_spawn_signature as fn() -> JoinHandle<u8>;
  let _ = assert_spawn_blocking_signature as fn() -> JoinHandle<u8>;
  let _ = assert_block_on_signature as fn() -> u8;
  let _ = assert_try_block_on_signature as fn() -> napi::Result<u8>;
  let _ = assert_enter_signature as fn() -> napi::Result<u8>;
  let _ = assert_codegen_enter_signature as fn() -> napi::Result<u8>;
  assert_eq!(napi::__private::async_runtime_v1::CONTRACT_VERSION, 1);
  assert_eq!(napi::__private::codegen_v1::CONTRACT_VERSION, 1);

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

  let _ = napi::bindgen_prelude::start_async_runtime as fn();
  let _ = napi::bindgen_prelude::try_start_async_runtime as fn() -> napi::Result<()>;
  let _ = napi::bindgen_prelude::shutdown_async_runtime as fn();
  let _ = napi::bindgen_prelude::try_shutdown_async_runtime as fn() -> napi::Result<()>;
}

#[cfg(feature = "tokio_rt")]
#[test]
fn tokio_runtime_helper_signatures_remain_compatible() {
  use napi::bindgen_prelude::{
    create_custom_tokio_runtime, spawn, spawn_blocking, tokio_runtime_retirement_waiter,
    try_create_custom_tokio_runtime, TokioRuntimeRetirementWaiter,
  };

  fn assert_spawn_signature() -> tokio::task::JoinHandle<()> {
    spawn(async {})
  }

  fn assert_spawn_blocking_signature() -> tokio::task::JoinHandle<u8> {
    spawn_blocking(|| 42)
  }

  fn assert_retirement_waiter_signature() -> TokioRuntimeRetirementWaiter {
    tokio_runtime_retirement_waiter()
  }

  fn assert_retirement_wait_signature(waiter: &TokioRuntimeRetirementWaiter) -> napi::Result<()> {
    waiter.wait()
  }

  fn assert_retirement_cancel_signature(waiter: &TokioRuntimeRetirementWaiter) {
    waiter.cancel();
  }

  fn assert_execute_tokio_future_signature(
    env: napi::sys::napi_env,
  ) -> napi::Result<napi::sys::napi_value> {
    napi::bindgen_prelude::execute_tokio_future(
      env,
      async { Ok::<_, napi::Error>(42_u8) },
      |_, _| Ok(std::ptr::null_mut()),
    )
  }

  fn assert_waiter_traits<T: Clone + Send + Sync>() {}

  let _ = assert_spawn_signature as fn() -> tokio::task::JoinHandle<()>;
  let _ = assert_spawn_blocking_signature as fn() -> tokio::task::JoinHandle<u8>;
  let _ = assert_retirement_waiter_signature as fn() -> TokioRuntimeRetirementWaiter;
  let _ = assert_retirement_wait_signature as fn(&TokioRuntimeRetirementWaiter) -> napi::Result<()>;
  let _ = assert_retirement_cancel_signature as fn(&TokioRuntimeRetirementWaiter);
  let _ = create_custom_tokio_runtime as fn(tokio::runtime::Runtime);
  let _ = try_create_custom_tokio_runtime as fn(tokio::runtime::Runtime) -> napi::Result<()>;
  let _ = assert_execute_tokio_future_signature
    as fn(napi::sys::napi_env) -> napi::Result<napi::sys::napi_value>;
  assert_waiter_traits::<TokioRuntimeRetirementWaiter>();
}
