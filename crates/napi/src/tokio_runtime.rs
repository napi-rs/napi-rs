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

/// Service-provider interface for plugging a custom async runtime into NAPI-RS.
///
/// When the `async-runtime` feature is enabled, napi no longer drives JS-facing futures on
/// its built-in tokio runtime. The futures produced by `#[napi]` async functions — together
/// with napi's own [`block_on`], [`within_runtime_if_available`], `start_async_runtime` and
/// `shutdown_async_runtime` entry points — are routed through the single backend registered
/// with [`create_custom_async_runtime`]. Implement this trait to back napi with your own
/// scheduler (e.g. a single-threaded or WASI-friendly runtime) and register exactly one
/// instance, once, at module init.
///
/// Under the `noop` feature this SPI is inert: [`create_custom_async_runtime`] does nothing and
/// the routed entry points are stubbed out (e.g. `block_on` panics), so the notes below about
/// routing apply only to non-`noop` builds.
///
/// Note that the public free `spawn`/`spawn_blocking` helper functions are **not** part of
/// this routing contract. This trait's own [`spawn`](AsyncRuntime::spawn) hook IS the routed
/// entry point for JS-facing async work, but it is detached (it hands back nothing to join)
/// and there is no `spawn_blocking` hook — so the public helpers, whose contract is to return
/// a joinable `JoinHandle`, cannot be served by the backend. In a `tokio_rt` build those
/// helpers run on the tokio runtime; in a pure `async-runtime` build (no `tokio_rt`) they fail
/// loud — calling them panics rather than silently spinning up a hidden tokio runtime. Drive
/// background work through the backend's own scheduler instead.
///
/// The implementation is stored process-globally and shared across threads, hence the
/// `Send + Sync + 'static` bound. Only one runtime is ever registered for the lifetime of
/// the process; see [`create_custom_async_runtime`] for the first-writer-wins semantics.
#[cfg(feature = "async-runtime")]
pub trait AsyncRuntime: Send + Sync + 'static {
  /// Spawn a future to run to completion in the background, detached.
  ///
  /// napi calls this for every JS-facing async function. The returned task is detached:
  /// the trait intentionally hands back nothing to join on, so the backend MUST drive the
  /// future all the way to completion on its own — napi never awaits it.
  ///
  /// Panic handling is already done by napi: the future passed in has been wrapped in
  /// `AssertUnwindSafe(..).catch_unwind()` before it reaches `spawn`, so a panic inside the
  /// user code is caught internally and surfaced as a rejected JS promise. The backend MUST
  /// NOT add its own `catch_unwind`/abort layer or otherwise treat the future as fallible —
  /// just poll it to completion like any other `Future<Output = ()>`.
  fn spawn(&self, future: Pin<Box<dyn Future<Output = ()> + Send + 'static>>);

  /// Block the current thread, fully driving the pinned future to completion before
  /// returning.
  ///
  /// This backs napi's synchronous [`block_on`]. napi stores the future's result via a
  /// side-effect and, the instant this method returns, asserts that the result is present —
  /// `output.expect("Custom async runtime returned before the future completed")`. A backend
  /// that returns early (without having polled the future to `Poll::Ready`) will therefore
  /// make napi panic. Run the future to completion; do not return on the first pending poll.
  fn block_on(&self, future: Pin<&mut dyn Future<Output = ()>>);

  /// Enter the runtime context and return a guard that establishes it for the calling
  /// thread.
  ///
  /// napi calls this in [`within_runtime_if_available`]: it enters, runs a synchronous
  /// closure, then drops the guard. The returned guard MUST keep the runtime context active
  /// for as long as it is held (i.e. for the whole duration of the closure) and tear it down
  /// on drop. The default implementation returns a no-op guard, which is correct for backends
  /// that do not need an ambient context.
  fn enter(&self) -> Box<dyn AsyncRuntimeGuard + '_> {
    Box::new(())
  }

  /// Start (or restart) the runtime.
  ///
  /// Called by `start_async_runtime`, which napi invokes when a Node env is created — note
  /// that an Electron renderer process can create and tear down its Node env repeatedly (on
  /// window reload), so this may be called more than once over the backend's lifetime.
  /// Implement it idempotently. The default is a no-op.
  fn start(&self) {}

  /// Shut the runtime down.
  ///
  /// Called by `shutdown_async_runtime`. On native Node targets a single process-wide env
  /// cleanup hook (registered once, on the first env that initializes the runtime) invokes it
  /// when that env exits; because the hook is registered only once, an env recreated after a
  /// full teardown — e.g. an Electron window reload — may not re-trigger it, so a backend should
  /// not rely on per-env shutdown. On wasm it is **not** tied to that env cleanup hook;
  /// instead it may be triggered either by the registered wasm finalizer (a `napi_wrap`
  /// finalizer on the module exports that fires once the live module count reaches zero) or by
  /// an explicit user call, depending on the host's finalization behavior. After shutdown the
  /// runtime may be started again via [`start`](AsyncRuntime::start), so release resources
  /// without making a subsequent `start` impossible. The default is a no-op.
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

/// Register the custom [`AsyncRuntime`] backend that napi will use process-wide.
///
/// Call this once, at module init, before any async entry point runs.
///
/// Registration is **first-writer-wins**: the backend is stored in a process-global
/// `OnceLock`, so the first call wins and every later call is silently ignored (the runtime
/// you pass is dropped without being installed). There is no way to replace the backend once
/// it is set.
/// ### Example
/// ```no_run
/// use std::future::Future;
/// use std::pin::Pin;
/// use napi::{create_custom_async_runtime, AsyncRuntime};
///
/// struct MyRuntime;
/// impl AsyncRuntime for MyRuntime {
///   fn spawn(&self, _future: Pin<Box<dyn Future<Output = ()> + Send + 'static>>) { todo!() }
///   fn block_on(&self, _future: Pin<&mut dyn Future<Output = ()>>) { todo!() }
/// }
///
/// #[napi_derive::module_init]
/// fn init() {
///   create_custom_async_runtime(MyRuntime);
/// }
/// ```
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
/// Configure the built-in Tokio runtime used by NAPI-RS, controlling its configuration yourself.
///
/// This affects only the built-in Tokio path: the default build, or — with `async-runtime` plus
/// `tokio_rt` — the public Tokio helper runtime. In a pure `async-runtime` build, JS-facing async
/// work is driven by the registered `AsyncRuntime` backend, and this helper has no effect.
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
/// Start the async runtime.
///
/// With the `async-runtime` feature this delegates to the registered `AsyncRuntime` backend's
/// `start`; otherwise it starts napi's built-in tokio runtime (the default path).
///
/// In Node.js native targets the async runtime will be dropped when Node env exits.
/// But in Electron renderer process, the Node env will exits and recreate when the window reloads.
/// So we need to ensure that the async runtime is initialized when the Node env is created.
///
/// On wasm, shutdown is not tied to the Node env cleanup hook: depending on host finalization
/// it may be triggered by the exports `napi_wrap` finalizer when the module count reaches zero,
/// or you can call `shutdown_async_runtime` explicitly. A custom `async-runtime` backend
/// controls its own lifetime. In some scenarios you may want to start the runtime again, e.g.
/// in tests.
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
/// In a pure `async-runtime` build there is no tokio runtime to spawn onto. The
/// [`AsyncRuntime`] trait's own [`spawn`](AsyncRuntime::spawn) hook is detached — it returns
/// nothing to join — so it cannot serve this public `spawn`, whose contract is to hand back a
/// joinable `JoinHandle`. Rather than silently constructing a multi-threaded tokio runtime —
/// the exact opposite of a threadless custom backend — this fails loud.
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
/// Unavailable under the `noop` feature: calling this panics. (Other builds run the future to
/// completion, blocking the current thread until it resolves.)
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
/// Enter the async runtime context for the duration of the provided closure, then call it.
///
/// With the `async-runtime` feature this enters the registered `AsyncRuntime` backend's
/// context (via its `enter`); with the built-in tokio runtime it enters the tokio context;
/// under the `noop` feature it simply calls the closure without entering any context.
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
        } else if let Some(s) = reason.downcast_ref::<String>() {
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
        } else if let Some(s) = reason.downcast_ref::<String>() {
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
