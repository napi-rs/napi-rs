use std::{
  future::Future,
  marker::PhantomData,
  sync::{OnceLock, RwLock},
};

use tokio::runtime::Runtime;

use crate::{
  bindgen_runtime::ToNapiValue, sys, Env, Error, JsDeferred, JsUnknown, NapiValue, Result,
};

fn create_runtime() -> Runtime {
  tokio::runtime::Builder::new_multi_thread()
    .enable_all()
    .build()
    .expect("Create tokio runtime failed")
}

static RT: OnceLock<RwLock<Option<Runtime>>> = OnceLock::new();

/// Create a custom Tokio runtime used by the NAPI-RS.
/// You can control the tokio runtime configuration by yourself.
/// ### Example
/// ```no_run
/// use tokio::runtime::Builder;
/// use napi::create_custom_tokio_runtime;
///
/// #[napi::module_init]
/// fn init() {
///    let rt = Builder::new_multi_thread().enable_all().thread_stack_size(32 * 1024 * 1024).build().unwrap();
///    create_custom_tokio_runtime(rt);
/// }
pub fn create_custom_tokio_runtime(rt: Runtime) {
  RT.get_or_init(move || RwLock::new(Some(rt)));
}

#[cfg(not(feature = "noop"))]
/// Ensure that the Tokio runtime is initialized.
/// In Node.js the Tokio runtime will be dropped when Node env exits.
/// But in Electron renderer process, the Node env will exits and recreate when the window reloads.
/// So we need to ensure that the Tokio runtime is initialized when the Node env is created.
pub(crate) fn ensure_runtime() {
  RT.get_or_init(|| {
    let rt = create_runtime();
    RwLock::new(Some(rt))
  });
}

#[cfg(not(feature = "noop"))]
pub fn shutdown_tokio_runtime() {
  if let Some(rt) = RT
    .get()
    .and_then(|rt| rt.write().ok().and_then(|mut rt| rt.take()))
  {
    rt.shutdown_background();
  }
}

/// Spawns a future onto the Tokio runtime.
///
/// Depending on where you use it, you should await or abort the future in your drop function.
/// To avoid undefined behavior and memory corruptions.
pub fn spawn<F>(fut: F) -> tokio::task::JoinHandle<F::Output>
where
  F: 'static + Send + Future<Output = ()>,
{
  RT.get()
    .and_then(|rt| {
      rt.read()
        .ok()
        .and_then(|rt| rt.as_ref().map(|rt| rt.spawn(fut)))
    })
    .expect("Access tokio runtime failed")
}

/// Runs a future to completion
/// This is blocking, meaning that it pauses other execution until the future is complete,
/// only use it when it is absolutely necessary, in other places use async functions instead.
pub fn block_on<F: Future>(fut: F) -> F::Output {
  RT.get()
    .and_then(|rt| {
      rt.read()
        .ok()
        .and_then(|rt| rt.as_ref().map(|rt| rt.block_on(fut)))
    })
    .expect("Access tokio runtime failed")
}

/// spawn_blocking on the current Tokio runtime.
pub fn spawn_blocking<F, R>(func: F) -> tokio::task::JoinHandle<R>
where
  F: FnOnce() -> R + Send + 'static,
  R: Send + 'static,
{
  RT.get()
    .and_then(|rt| {
      rt.read()
        .ok()
        .and_then(|rt| rt.as_ref().map(|rt| rt.spawn_blocking(func)))
    })
    .expect("Access tokio runtime failed")
}

// This function's signature must be kept in sync with the one in lib.rs, otherwise napi
// will fail to compile with the `tokio_rt` feature.

/// If the feature `tokio_rt` has been enabled this will enter the runtime context and
/// then call the provided closure. Otherwise it will just call the provided closure.
pub fn within_runtime_if_available<F: FnOnce() -> T, T>(f: F) -> T {
  RT.get()
    .and_then(|rt| {
      rt.read().ok().and_then(|rt| {
        rt.as_ref().map(|rt| {
          let rt_guard = rt.enter();
          let ret = f();
          drop(rt_guard);
          ret
        })
      })
    })
    .expect("Access tokio runtime failed")
}

struct SendableResolver<
  Data: 'static + Send,
  R: 'static + FnOnce(sys::napi_env, Data) -> Result<sys::napi_value>,
> {
  inner: R,
  _data: PhantomData<Data>,
}

// the `SendableResolver` will be only called in the `threadsafe_function_call_js` callback
// which means it will be always called in the Node.js JavaScript thread
// so the inner function is not required to be `Send`
// but the `Send` bound is required by the `execute_tokio_future` function
unsafe impl<Data: 'static + Send, R: 'static + FnOnce(sys::napi_env, Data) -> Result<sys::napi_value>>
  Send for SendableResolver<Data, R>
{
}

impl<Data: 'static + Send, R: 'static + FnOnce(sys::napi_env, Data) -> Result<sys::napi_value>>
  SendableResolver<Data, R>
{
  fn new(inner: R) -> Self {
    Self {
      inner,
      _data: PhantomData,
    }
  }

  fn resolve(self, env: sys::napi_env, data: Data) -> Result<sys::napi_value> {
    (self.inner)(env, data)
  }
}

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
  let (deferred, promise) = JsDeferred::new(env)?;
  let deferred_for_panic = deferred.clone();
  let sendable_resolver = SendableResolver::new(resolver);

  let inner = async move {
    match fut.await {
      Ok(v) => deferred.resolve(move |env| {
        sendable_resolver
          .resolve(env.raw(), v)
          .map(|v| unsafe { JsUnknown::from_raw_unchecked(env.raw(), v) })
      }),
      Err(e) => deferred.reject(e.into()),
    }
  };

  let jh = spawn(inner);

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

  Ok(promise.0.value)
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
