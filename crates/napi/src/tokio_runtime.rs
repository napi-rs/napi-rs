#[cfg(all(
  not(feature = "noop"),
  any(not(feature = "async-runtime"), feature = "tokio_rt")
))]
use std::sync::LazyLock;
#[cfg(not(feature = "noop"))]
use std::sync::{OnceLock, RwLock};
use std::{future::Future, marker::PhantomData};

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
use std::panic::AssertUnwindSafe;
#[cfg(feature = "async-runtime")]
use std::pin::Pin;

use tokio::runtime::Runtime;

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
use futures::FutureExt;

use crate::{bindgen_runtime::ToNapiValue, sys, Env, Error, Result};
#[cfg(not(feature = "noop"))]
use crate::{JsDeferred, SendableResolver, Unknown};

#[cfg(feature = "async-runtime")]
pub trait AsyncRuntimeGuard {}

#[cfg(feature = "async-runtime")]
impl AsyncRuntimeGuard for () {}

#[cfg(feature = "async-runtime")]
pub trait AsyncRuntime: Send + Sync + 'static {
  fn spawn(&self, future: Pin<Box<dyn Future<Output = ()> + Send + 'static>>);

  fn block_on(&self, future: Pin<&mut dyn Future<Output = ()>>);

  fn enter(&self) -> Box<dyn AsyncRuntimeGuard + '_> {
    Box::new(())
  }

  fn start(&self) {}

  fn shutdown(&self) {}
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
static CUSTOM_ASYNC_RUNTIME: OnceLock<Box<dyn AsyncRuntime>> = OnceLock::new();

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
fn custom_async_runtime() -> &'static dyn AsyncRuntime {
  CUSTOM_ASYNC_RUNTIME
    .get()
    .map(Box::as_ref)
    .expect("Custom async runtime is not configured")
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
pub fn create_custom_async_runtime<R: AsyncRuntime>(runtime: R) {
  CUSTOM_ASYNC_RUNTIME.get_or_init(|| Box::new(runtime));
}

#[cfg(all(feature = "async-runtime", feature = "noop"))]
pub fn create_custom_async_runtime<R: AsyncRuntime>(_: R) {}

#[cfg(all(
  not(feature = "noop"),
  any(not(feature = "async-runtime"), feature = "tokio_rt")
))]
fn create_runtime() -> Runtime {
  // Check if we're supposed to use a user-defined runtime
  if IS_USER_DEFINED_RT.get().copied().unwrap_or(false) {
    // Try to take the user-defined runtime if it's still available
    if let Some(user_defined_rt) = USER_DEFINED_RT
      .get()
      .and_then(|rt| rt.write().ok().and_then(|mut rt| rt.take()))
    {
      return user_defined_rt;
    }
    // If the user-defined runtime was already taken, fall back to creating a default runtime
    // This handles the case where the runtime was shutdown and needs to be restarted
  }

  #[cfg(any(
    all(target_family = "wasm", tokio_unstable),
    not(target_family = "wasm")
  ))]
  {
    tokio::runtime::Builder::new_multi_thread()
      .enable_all()
      .build()
      .expect("Create tokio runtime failed")
  }
  #[cfg(all(target_family = "wasm", not(tokio_unstable)))]
  {
    tokio::runtime::Builder::new_current_thread()
      .enable_all()
      .build()
      .expect("Create tokio runtime failed")
  }
}

#[cfg(all(
  not(feature = "noop"),
  any(not(feature = "async-runtime"), feature = "tokio_rt")
))]
static RT: LazyLock<RwLock<Option<Runtime>>> =
  LazyLock::new(|| RwLock::new(Some(create_runtime())));

#[cfg(not(feature = "noop"))]
static USER_DEFINED_RT: OnceLock<RwLock<Option<Runtime>>> = OnceLock::new();

#[cfg(not(feature = "noop"))]
static IS_USER_DEFINED_RT: OnceLock<bool> = OnceLock::new();

#[cfg(not(feature = "noop"))]
/// Create a custom Tokio runtime used by the NAPI-RS.
/// You can control the tokio runtime configuration by yourself.
/// ### Example
/// ```no_run
/// use tokio::runtime::Builder;
/// use napi::create_custom_tokio_runtime;
///
/// #[napi_derive::module_init]
/// fn init() {
///    let rt = Builder::new_multi_thread().enable_all().thread_stack_size(32 * 1024 * 1024).build().unwrap();
///    create_custom_tokio_runtime(rt);
/// }
pub fn create_custom_tokio_runtime(rt: Runtime) {
  USER_DEFINED_RT.get_or_init(move || RwLock::new(Some(rt)));
  IS_USER_DEFINED_RT.get_or_init(|| true);
}

#[cfg(feature = "noop")]
pub fn create_custom_tokio_runtime(_: Runtime) {}

#[cfg(not(feature = "noop"))]
/// Start the async runtime (Currently is tokio).
///
/// In Node.js native targets the async runtime will be dropped when Node env exits.
/// But in Electron renderer process, the Node env will exits and recreate when the window reloads.
/// So we need to ensure that the async runtime is initialized when the Node env is created.
///
/// In wasm targets, the async runtime will not been shutdown automatically due to the limitation of the wasm runtime.
/// So, you need to call `shutdown_async_runtime` function to manually shutdown the async runtime.
/// In some scenarios, you may want to start the async runtime again like in tests.
pub fn start_async_runtime() {
  #[cfg(feature = "async-runtime")]
  {
    custom_async_runtime().start();
  }
  #[cfg(not(feature = "async-runtime"))]
  {
    if let Ok(mut rt) = RT.write() {
      if rt.is_none() {
        *rt = Some(create_runtime());
      }
    }
  }
}

#[cfg(not(feature = "noop"))]
pub fn shutdown_async_runtime() {
  #[cfg(feature = "async-runtime")]
  {
    custom_async_runtime().shutdown();
  }
  #[cfg(not(feature = "async-runtime"))]
  {
    if let Some(rt) = RT.write().ok().and_then(|mut rt| rt.take()) {
      rt.shutdown_background();
    }
  }
}

#[cfg(all(
  not(feature = "noop"),
  any(not(feature = "async-runtime"), feature = "tokio_rt")
))]
/// Spawns a future onto the Tokio runtime.
///
/// Depending on where you use it, you should await or abort the future in your drop function.
/// To avoid undefined behavior and memory corruptions.
pub fn spawn<F>(fut: F) -> tokio::task::JoinHandle<F::Output>
where
  F: 'static + Send + Future<Output = ()>,
{
  RT.read()
    .ok()
    .and_then(|rt| rt.as_ref().map(|rt| rt.spawn(fut)))
    .expect("Access tokio runtime failed in spawn")
}

#[cfg(all(
  not(feature = "noop"),
  feature = "async-runtime",
  not(feature = "tokio_rt")
))]
/// In a pure `async-runtime` build there is no tokio runtime to spawn onto, and the
/// [`AsyncRuntime`] trait deliberately exposes no `spawn` hook (it returns nothing, so a
/// caller could never join the task). Rather than silently constructing a multi-threaded
/// tokio runtime — the exact opposite of a threadless custom backend — this fails loud.
pub fn spawn<F>(_fut: F) -> tokio::task::JoinHandle<F::Output>
where
  F: 'static + Send + Future<Output = ()>,
{
  panic!(
    "napi `spawn` is not routed through the custom async runtime; \
     use the registered `AsyncRuntime` backend instead"
  )
}

#[cfg(not(feature = "noop"))]
/// Runs a future to completion
/// This is blocking, meaning that it pauses other execution until the future is complete,
/// only use it when it is absolutely necessary, in other places use async functions instead.
pub fn block_on<F: Future>(fut: F) -> F::Output {
  #[cfg(feature = "async-runtime")]
  {
    let mut output = None;
    {
      let mut future = std::pin::pin!(async {
        output = Some(fut.await);
      });
      custom_async_runtime().block_on(future.as_mut());
    }
    output.expect("Custom async runtime returned before the future completed")
  }
  #[cfg(not(feature = "async-runtime"))]
  {
    RT.read()
      .ok()
      .and_then(|rt| rt.as_ref().map(|rt| rt.block_on(fut)))
      .expect("Access tokio runtime failed in block_on")
  }
}

#[cfg(feature = "noop")]
/// Runs a future to completion
/// This is blocking, meaning that it pauses other execution until the future is complete,
/// only use it when it is absolutely necessary, in other places use async functions instead.
pub fn block_on<F: Future>(_: F) -> F::Output {
  unreachable!("noop feature is enabled, block_on is not available")
}

#[cfg(all(
  not(feature = "noop"),
  any(not(feature = "async-runtime"), feature = "tokio_rt")
))]
/// spawn_blocking on the current Tokio runtime.
pub fn spawn_blocking<F, R>(func: F) -> tokio::task::JoinHandle<R>
where
  F: FnOnce() -> R + Send + 'static,
  R: Send + 'static,
{
  RT.read()
    .ok()
    .and_then(|rt| rt.as_ref().map(|rt| rt.spawn_blocking(func)))
    .expect("Access tokio runtime failed in spawn_blocking")
}

#[cfg(all(
  not(feature = "noop"),
  feature = "async-runtime",
  not(feature = "tokio_rt")
))]
/// In a pure `async-runtime` build there is no tokio runtime and the [`AsyncRuntime`] trait
/// has no `spawn_blocking` hook, so blocking work cannot be offloaded to a backend thread
/// pool. Fail loud instead of spinning up a multi-threaded tokio runtime behind the user's
/// back.
pub fn spawn_blocking<F, R>(_func: F) -> tokio::task::JoinHandle<R>
where
  F: FnOnce() -> R + Send + 'static,
  R: Send + 'static,
{
  panic!(
    "napi `spawn_blocking` is not routed through the custom async runtime; \
     use the registered `AsyncRuntime` backend instead"
  )
}

#[cfg(not(feature = "noop"))]
// This function's signature must be kept in sync with the one in lib.rs, otherwise napi
// will fail to compile with the `tokio_rt` feature.
#[cfg(not(feature = "noop"))]
/// If the feature `tokio_rt` has been enabled this will enter the runtime context and
/// then call the provided closure. Otherwise it will just call the provided closure.
pub fn within_runtime_if_available<F: FnOnce() -> T, T>(f: F) -> T {
  #[cfg(feature = "async-runtime")]
  {
    let runtime_guard = custom_async_runtime().enter();
    let ret = f();
    drop(runtime_guard);
    ret
  }
  #[cfg(not(feature = "async-runtime"))]
  {
    RT.read()
      .ok()
      .and_then(|rt| {
        rt.as_ref().map(|rt| {
          let rt_guard = rt.enter();
          let ret = f();
          drop(rt_guard);
          ret
        })
      })
      .expect("Access tokio runtime failed in within_runtime_if_available")
  }
}

#[cfg(feature = "noop")]
pub fn within_runtime_if_available<F: FnOnce() -> T, T>(f: F) -> T {
  f()
}

#[cfg(feature = "noop")]
#[allow(unused)]
pub fn execute_tokio_future<
  Data: 'static + Send,
  Fut: 'static + Send + Future<Output = std::result::Result<Data, impl Into<Error>>>,
  Resolver: 'static + FnOnce(sys::napi_env, Data) -> Result<sys::napi_value>,
>(
  env: sys::napi_env,
  fut: Fut,
  resolver: Resolver,
) -> Result<sys::napi_value> {
  Ok(std::ptr::null_mut())
}

#[cfg(not(feature = "noop"))]
#[allow(clippy::not_unsafe_ptr_arg_deref)]
pub fn execute_tokio_future<
  Data: 'static + Send,
  Fut: 'static + Send + Future<Output = std::result::Result<Data, impl Into<Error>>>,
  Resolver: 'static + FnOnce(sys::napi_env, Data) -> Result<sys::napi_value>,
>(
  env: sys::napi_env,
  fut: Fut,
  resolver: Resolver,
) -> Result<sys::napi_value> {
  let env = Env::from_raw(env);
  let (deferred, promise) = JsDeferred::new(&env)?;
  #[cfg(all(
    not(feature = "async-runtime"),
    any(
      all(target_family = "wasm", tokio_unstable),
      not(target_family = "wasm")
    )
  ))]
  let deferred_for_panic = deferred.clone();
  let sendable_resolver = SendableResolver::new(resolver);

  #[cfg(feature = "async-runtime")]
  let inner = async move {
    match AssertUnwindSafe(fut).catch_unwind().await {
      Ok(Ok(v)) => deferred.resolve(move |env| {
        sendable_resolver
          .resolve(env.raw(), v)
          .map(|v| unsafe { Unknown::from_raw_unchecked(env.raw(), v) })
      }),
      Ok(Err(e)) => deferred.reject(e.into()),
      Err(reason) => {
        if let Some(s) = reason.downcast_ref::<&str>() {
          deferred.reject(Error::new(crate::Status::GenericFailure, s));
        } else {
          deferred.reject(Error::new(
            crate::Status::GenericFailure,
            "Panic in async function",
          ));
        }
      }
    }
  };

  #[cfg(not(feature = "async-runtime"))]
  let inner = async move {
    match fut.await {
      Ok(v) => deferred.resolve(move |env| {
        sendable_resolver
          .resolve(env.raw(), v)
          .map(|v| unsafe { Unknown::from_raw_unchecked(env.raw(), v) })
      }),
      Err(e) => deferred.reject(e.into()),
    }
  };

  #[cfg(feature = "async-runtime")]
  custom_async_runtime().spawn(Box::pin(inner));

  #[cfg(all(
    not(feature = "async-runtime"),
    any(
      all(target_family = "wasm", tokio_unstable),
      not(target_family = "wasm")
    )
  ))]
  let jh = spawn(inner);

  #[cfg(all(
    not(feature = "async-runtime"),
    any(
      all(target_family = "wasm", tokio_unstable),
      not(target_family = "wasm")
    )
  ))]
  spawn(async move {
    if let Err(err) = jh.await {
      if let Ok(reason) = err.try_into_panic() {
        if let Some(s) = reason.downcast_ref::<&str>() {
          deferred_for_panic.reject(Error::new(crate::Status::GenericFailure, s));
        } else {
          deferred_for_panic.reject(Error::new(
            crate::Status::GenericFailure,
            "Panic in async function",
          ));
        }
      }
    }
  });

  #[cfg(all(
    not(feature = "async-runtime"),
    target_family = "wasm",
    not(tokio_unstable)
  ))]
  {
    std::thread::spawn(|| {
      block_on(inner);
    });
  }

  Ok(promise.0.value)
}

#[doc(hidden)]
#[cfg(not(feature = "noop"))]
#[allow(clippy::not_unsafe_ptr_arg_deref)]
pub fn execute_tokio_future_with_finalize_callback<
  Data: 'static + Send,
  Fut: 'static + Send + Future<Output = std::result::Result<Data, impl Into<Error>>>,
  Resolver: 'static + FnOnce(sys::napi_env, Data) -> Result<sys::napi_value>,
>(
  env: sys::napi_env,
  fut: Fut,
  resolver: Resolver,
  finalize_callback: Option<Box<dyn FnOnce(sys::napi_env)>>,
) -> Result<sys::napi_value> {
  let env = Env::from_raw(env);
  let (mut deferred, promise) = JsDeferred::new(&env)?;
  deferred.set_finalize_callback(finalize_callback);
  #[cfg(all(
    not(feature = "async-runtime"),
    any(
      all(target_family = "wasm", tokio_unstable),
      not(target_family = "wasm")
    )
  ))]
  let deferred_for_panic = deferred.clone();
  let sendable_resolver = SendableResolver::new(resolver);

  #[cfg(feature = "async-runtime")]
  let inner = async move {
    match AssertUnwindSafe(fut).catch_unwind().await {
      Ok(Ok(v)) => deferred.resolve(move |env| {
        sendable_resolver
          .resolve(env.raw(), v)
          .map(|v| unsafe { Unknown::from_raw_unchecked(env.raw(), v) })
      }),
      Ok(Err(e)) => deferred.reject(e.into()),
      Err(reason) => {
        if let Some(s) = reason.downcast_ref::<&str>() {
          deferred.reject(Error::new(crate::Status::GenericFailure, s));
        } else {
          deferred.reject(Error::new(
            crate::Status::GenericFailure,
            "Panic in async function",
          ));
        }
      }
    }
  };

  #[cfg(not(feature = "async-runtime"))]
  let inner = async move {
    match fut.await {
      Ok(v) => deferred.resolve(move |env| {
        sendable_resolver
          .resolve(env.raw(), v)
          .map(|v| unsafe { Unknown::from_raw_unchecked(env.raw(), v) })
      }),
      Err(e) => deferred.reject(e.into()),
    }
  };

  #[cfg(feature = "async-runtime")]
  custom_async_runtime().spawn(Box::pin(inner));

  #[cfg(all(
    not(feature = "async-runtime"),
    any(
      all(target_family = "wasm", tokio_unstable),
      not(target_family = "wasm")
    )
  ))]
  let jh = spawn(inner);

  #[cfg(all(
    not(feature = "async-runtime"),
    any(
      all(target_family = "wasm", tokio_unstable),
      not(target_family = "wasm")
    )
  ))]
  spawn(async move {
    if let Err(err) = jh.await {
      if let Ok(reason) = err.try_into_panic() {
        if let Some(s) = reason.downcast_ref::<&str>() {
          deferred_for_panic.reject(Error::new(crate::Status::GenericFailure, s));
        } else {
          deferred_for_panic.reject(Error::new(
            crate::Status::GenericFailure,
            "Panic in async function",
          ));
        }
      }
    }
  });

  #[cfg(all(
    not(feature = "async-runtime"),
    target_family = "wasm",
    not(tokio_unstable)
  ))]
  {
    std::thread::spawn(|| {
      block_on(inner);
    });
  }

  Ok(promise.0.value)
}

#[cfg(feature = "noop")]
#[doc(hidden)]
pub fn execute_tokio_future_with_finalize_callback<
  Data: 'static + Send,
  Fut: 'static + Send + Future<Output = std::result::Result<Data, impl Into<Error>>>,
  Resolver: 'static + FnOnce(sys::napi_env, Data) -> Result<sys::napi_value>,
>(
  _env: sys::napi_env,
  _fut: Fut,
  _resolver: Resolver,
  _finalize_callback: Option<Box<dyn FnOnce(sys::napi_env)>>,
) -> Result<sys::napi_value> {
  Ok(std::ptr::null_mut())
}

pub struct AsyncBlockBuilder<
  V: Send + 'static,
  F: Future<Output = Result<V>> + Send + 'static,
  Dispose: FnOnce(Env) -> Result<()> + 'static = fn(Env) -> Result<()>,
> {
  inner: F,
  dispose: Option<Dispose>,
}

impl<V: ToNapiValue + Send + 'static, F: Future<Output = Result<V>> + Send + 'static>
  AsyncBlockBuilder<V, F>
{
  /// Create a new `AsyncBlockBuilder` with the given future, without dispose
  pub fn new(inner: F) -> Self {
    Self {
      inner,
      dispose: None,
    }
  }
}

impl<
    V: ToNapiValue + Send + 'static,
    F: Future<Output = Result<V>> + Send + 'static,
    Dispose: FnOnce(Env) -> Result<()> + 'static,
  > AsyncBlockBuilder<V, F, Dispose>
{
  pub fn with(inner: F) -> Self {
    Self {
      inner,
      dispose: None,
    }
  }

  pub fn with_dispose(mut self, dispose: Dispose) -> Self {
    self.dispose = Some(dispose);
    self
  }

  pub fn build(self, env: &Env) -> Result<AsyncBlock<V>> {
    Ok(AsyncBlock {
      inner: execute_tokio_future(env.0, self.inner, |env, v| unsafe {
        if let Some(dispose) = self.dispose {
          let env = Env::from_raw(env);
          dispose(env)?;
        }
        V::to_napi_value(env, v)
      })?,
      _phantom: PhantomData,
    })
  }
}

impl<V: Send + 'static, F: Future<Output = Result<V>> + Send + 'static> AsyncBlockBuilder<V, F> {
  /// Create a new `AsyncBlockBuilder` with the given future, without dispose
  pub fn build_with_map<T: ToNapiValue, Map: FnOnce(Env, V) -> Result<T> + 'static>(
    env: &Env,
    inner: F,
    map: Map,
  ) -> Result<AsyncBlock<T>> {
    Ok(AsyncBlock {
      inner: execute_tokio_future(env.0, inner, |env, v| unsafe {
        let v = map(Env::from_raw(env), v)?;
        T::to_napi_value(env, v)
      })?,
      _phantom: PhantomData,
    })
  }
}

pub struct AsyncBlock<T: ToNapiValue + 'static> {
  inner: sys::napi_value,
  _phantom: PhantomData<T>,
}

impl<T: ToNapiValue + 'static> ToNapiValue for AsyncBlock<T> {
  unsafe fn to_napi_value(_: napi_sys::napi_env, val: Self) -> Result<napi_sys::napi_value> {
    Ok(val.inner)
  }
}
