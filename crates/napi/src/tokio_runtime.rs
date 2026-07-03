#[cfg(all(not(feature = "noop"), not(feature = "async-runtime")))]
use std::sync::LazyLock;
#[cfg(all(not(feature = "noop"), feature = "async-runtime"))]
use std::sync::OnceLock;
#[cfg(all(not(feature = "noop"), not(feature = "async-runtime")))]
use std::sync::{OnceLock, RwLock};
use std::{future::Future, marker::PhantomData};

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
use std::any::Any;
#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
use std::panic::AssertUnwindSafe;
#[cfg(feature = "async-runtime")]
use std::pin::Pin;
#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
use std::sync::{Arc, Mutex};
#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
use std::task::{Context, Poll, Waker};

#[cfg(feature = "tokio")]
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
/// The public free `spawn`/`spawn_blocking` helper functions are part of this routing
/// contract too. The free `spawn` is served by this trait's detached
/// [`spawn`](AsyncRuntime::spawn) hook: napi wraps the future so its output (or panic
/// payload) is captured, and manufactures the joinable `JoinHandle` itself. The free
/// `spawn_blocking` routes through the optional
/// [`spawn_blocking`](AsyncRuntime::spawn_blocking) hook; if the backend declines (the
/// default), napi runs the closure on a plain dedicated `std::thread` — it never lazily
/// constructs a hidden tokio runtime, not even when Cargo feature unification enables
/// `tokio_rt` alongside `async-runtime`.
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

  /// Optional hook: run `work` on the backend's blocking-capable lane.
  ///
  /// This backs the public free `spawn_blocking` helper. Return `Ok(())` once the work is
  /// accepted; the backend MUST then eventually run the closure exactly once, on a thread
  /// where blocking is acceptable. Return `Err(work)` to decline — the closure is handed
  /// back untouched and napi runs it on a plain dedicated fallback thread instead (never a
  /// lazily-created tokio pool). The default implementation declines.
  ///
  /// Panic handling is napi's: the closure is already wrapped in `catch_unwind` before it
  /// reaches this hook and a panic is surfaced as a `JoinError` through the caller's
  /// `JoinHandle`, so just run it — do not add another panic layer.
  fn spawn_blocking(
    &self,
    work: Box<dyn FnOnce() + Send + 'static>,
  ) -> std::result::Result<(), Box<dyn FnOnce() + Send + 'static>> {
    Err(work)
  }
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
static CUSTOM_ASYNC_RUNTIME: OnceLock<Box<dyn AsyncRuntime>> = OnceLock::new();

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
fn custom_async_runtime() -> &'static dyn AsyncRuntime {
  CUSTOM_ASYNC_RUNTIME.get().map(Box::as_ref).expect(
    "No `AsyncRuntime` backend is registered but the `async-runtime` feature is enabled. \
     Call `napi::bindgen_prelude::create_custom_async_runtime(...)` in a \
     `#[napi_derive::module_init]` fn, before any async entry point runs.",
  )
}

/// Register the custom [`AsyncRuntime`] backend that napi will use process-wide.
///
/// Call this once, at module init, before any async entry point runs.
///
/// Registration is **once, exactly once**: the backend is stored in a process-global
/// `OnceLock` and cannot be replaced. A second call **panics** — a silently dropped backend
/// almost always hides a real bug (two addon crates fighting over the runtime, or a
/// duplicated `module_init` hook). Note that `#[napi_derive::module_init]` runs once per
/// dylib load, so an Electron window reload does *not* re-run it and will not trigger the
/// panic.
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
  if CUSTOM_ASYNC_RUNTIME.set(Box::new(runtime)).is_err() {
    panic!(
      "napi::bindgen_prelude::create_custom_async_runtime was called more than once: an \
       `AsyncRuntime` backend is already registered for this process and cannot be replaced. \
       Register exactly one backend, once — usually from a single \
       `#[napi_derive::module_init]` fn — and remove the duplicate registration."
    );
  }
}

#[cfg(all(feature = "async-runtime", feature = "noop"))]
pub fn create_custom_async_runtime<R: AsyncRuntime>(_: R) {}

#[cfg(all(not(feature = "noop"), not(feature = "async-runtime")))]
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

// Note there is deliberately no `RT` static in any `async-runtime` build (not even combined
// with `tokio_rt`): a built-in tokio runtime that could be lazily materialized behind the
// registered backend's back is exactly the hazard the `async-runtime` feature exists to
// remove, so it is unrepresentable here.
#[cfg(all(not(feature = "noop"), not(feature = "async-runtime")))]
static RT: LazyLock<RwLock<Option<Runtime>>> = LazyLock::new(|| {
  // `Option` so `shutdown_async_runtime` can take the runtime down while the `RwLock`
  // (and the `LazyLock` around it) stays initialized for a later `start_async_runtime`.
  RwLock::new(Some(create_runtime()))
});

#[cfg(all(not(feature = "noop"), not(feature = "async-runtime")))]
static USER_DEFINED_RT: OnceLock<RwLock<Option<Runtime>>> = OnceLock::new();

#[cfg(all(not(feature = "noop"), not(feature = "async-runtime")))]
static IS_USER_DEFINED_RT: OnceLock<bool> = OnceLock::new();

#[cfg(all(not(feature = "noop"), not(feature = "async-runtime")))]
/// Configure the built-in Tokio runtime used by NAPI-RS, controlling its configuration yourself.
///
/// This affects only the built-in Tokio path (the default / `tokio_rt` build). In an
/// `async-runtime` build there is no built-in Tokio runtime at all — async work is driven by
/// the registered `AsyncRuntime` backend — and this helper is a documented no-op kept only for
/// source compatibility.
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

#[cfg(all(not(feature = "noop"), feature = "async-runtime", feature = "tokio"))]
/// No-op shim for `async-runtime` builds that also link tokio (e.g. `tokio_rt` enabled by
/// Cargo feature unification): there is no built-in Tokio runtime here — every routed entry
/// point is served by the registered `AsyncRuntime` backend — so the passed runtime is simply
/// dropped. This shim only exists so unified builds keep compiling.
pub fn create_custom_tokio_runtime(_rt: Runtime) {}

#[cfg(all(feature = "noop", feature = "tokio"))]
pub fn create_custom_tokio_runtime(_: Runtime) {}

#[cfg(not(feature = "noop"))]
/// Start the async runtime.
///
/// With the `async-runtime` feature this delegates to the registered `AsyncRuntime` backend's
/// `start` — including when `tokio_rt` is also enabled by Cargo feature unification, since an
/// `async-runtime` build has no built-in tokio runtime at all. Otherwise it starts napi's
/// built-in tokio runtime (the default path).
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
/// Shut the async runtime down.
///
/// With the `async-runtime` feature this delegates to the registered `AsyncRuntime` backend's
/// `shutdown` — including when `tokio_rt` is also enabled by Cargo feature unification: an
/// `async-runtime` build has no built-in tokio runtime, so there is nothing else to tear
/// down. Otherwise it takes down napi's built-in tokio runtime (the default path).
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

/// The error returned when joining a [`JoinHandle`] whose task panicked.
///
/// This is napi's runtime-agnostic analogue of `tokio::task::JoinError`, produced by the
/// free [`spawn`]/[`spawn_blocking`] helpers in `async-runtime` builds. There is no task
/// cancellation for these handles, so a `JoinError` always carries a panic payload.
#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
pub struct JoinError {
  panic_payload: Box<dyn Any + Send + 'static>,
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
impl JoinError {
  fn new_panic(panic_payload: Box<dyn Any + Send + 'static>) -> Self {
    Self { panic_payload }
  }

  /// Whether the task failed because it panicked. Always `true`: these handles cannot be
  /// cancelled, so a panic is the only way a task can fail.
  pub fn is_panic(&self) -> bool {
    true
  }

  /// Consume the error, returning the panic payload the task panicked with.
  pub fn into_panic(self) -> Box<dyn Any + Send + 'static> {
    self.panic_payload
  }

  /// Consume the error, returning the panic payload the task panicked with. Mirrors
  /// `tokio::task::JoinError::try_into_panic`; for this error type it always returns `Ok`.
  pub fn try_into_panic(self) -> std::result::Result<Box<dyn Any + Send + 'static>, Self> {
    Ok(self.panic_payload)
  }
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
impl std::fmt::Debug for JoinError {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    f.write_str("JoinError::Panic(...)")
  }
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
impl std::fmt::Display for JoinError {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    f.write_str("task panicked")
  }
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
impl std::error::Error for JoinError {}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
struct JoinStateInner<T> {
  result: Option<std::result::Result<T, JoinError>>,
  waker: Option<Waker>,
}

/// Shared completion slot between a spawned task and its [`JoinHandle`]. napi manufactures
/// joinable-ness over the backend's detached hooks with this: the task wrapper stores its
/// output (or panic payload) here and wakes the handle.
#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
struct JoinState<T> {
  inner: Mutex<JoinStateInner<T>>,
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
impl<T> JoinState<T> {
  fn new() -> Self {
    Self {
      inner: Mutex::new(JoinStateInner {
        result: None,
        waker: None,
      }),
    }
  }

  fn complete(&self, result: std::result::Result<T, JoinError>) {
    let waker = {
      let mut inner = self
        .inner
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
      inner.result = Some(result);
      inner.waker.take()
    };
    if let Some(waker) = waker {
      waker.wake();
    }
  }
}

/// A napi-owned handle to a task spawned via the free [`spawn`]/[`spawn_blocking`] helpers
/// in `async-runtime` builds.
///
/// Await it to join the task: it resolves to the task's output, or to a [`JoinError`]
/// carrying the panic payload if the task panicked. Unlike `tokio::task::JoinHandle` it is
/// join-only — there is no `abort`; detach the task by dropping the handle. If the backend
/// drops the task without ever running it, the handle never resolves.
#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
pub struct JoinHandle<T> {
  state: Arc<JoinState<T>>,
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
impl<T> Future for JoinHandle<T> {
  type Output = std::result::Result<T, JoinError>;

  fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output> {
    let mut inner = self
      .state
      .inner
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner);
    if let Some(result) = inner.result.take() {
      Poll::Ready(result)
    } else {
      inner.waker = Some(cx.waker().clone());
      Poll::Pending
    }
  }
}

/// The name of the dedicated thread the free [`spawn_blocking`] helper falls back to when
/// the registered [`AsyncRuntime`] backend declines the work.
#[cfg(all(not(feature = "noop"), feature = "async-runtime"))]
pub const SPAWN_BLOCKING_FALLBACK_THREAD_NAME: &str = "napi-spawn-blocking-fallback";

#[cfg(all(not(feature = "noop"), not(feature = "async-runtime")))]
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

#[cfg(all(not(feature = "noop"), feature = "async-runtime"))]
/// Spawn a future onto the registered [`AsyncRuntime`] backend, returning a joinable
/// [`JoinHandle`].
///
/// The joinable-ness is manufactured by napi over the backend's detached
/// [`spawn`](AsyncRuntime::spawn) hook: the future is wrapped so that its output — or, if it
/// panics, the caught panic payload as a [`JoinError`] — is handed to the returned handle.
/// This routed arm serves every `async-runtime` build, including combined
/// `async-runtime` + `tokio_rt` builds: there is no built-in tokio runtime to spawn onto.
pub fn spawn<F>(fut: F) -> JoinHandle<F::Output>
where
  F: 'static + Send + Future,
  F::Output: 'static + Send,
{
  let state = Arc::new(JoinState::new());
  let task_state = state.clone();
  custom_async_runtime().spawn(Box::pin(async move {
    let result = AssertUnwindSafe(fut).catch_unwind().await;
    task_state.complete(result.map_err(JoinError::new_panic));
  }));
  JoinHandle { state }
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

#[cfg(all(not(feature = "noop"), not(feature = "async-runtime")))]
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

#[cfg(all(not(feature = "noop"), feature = "async-runtime"))]
/// Run blocking work through the registered [`AsyncRuntime`] backend, returning a joinable
/// [`JoinHandle`].
///
/// The closure — wrapped so that its output, or the caught panic payload as a [`JoinError`],
/// is handed to the returned handle — is offered to the backend's
/// [`spawn_blocking`](AsyncRuntime::spawn_blocking) hook. If the backend declines (the
/// default implementation does), napi runs the closure on a plain dedicated `std::thread`
/// named [`SPAWN_BLOCKING_FALLBACK_THREAD_NAME`]: a hidden tokio blocking pool is never
/// constructed, not even in combined `async-runtime` + `tokio_rt` builds.
pub fn spawn_blocking<F, R>(func: F) -> JoinHandle<R>
where
  F: FnOnce() -> R + Send + 'static,
  R: Send + 'static,
{
  let state = Arc::new(JoinState::new());
  let task_state = state.clone();
  let work: Box<dyn FnOnce() + Send + 'static> = Box::new(move || {
    let result = std::panic::catch_unwind(AssertUnwindSafe(func));
    task_state.complete(result.map_err(JoinError::new_panic));
  });
  if let Err(work) = custom_async_runtime().spawn_blocking(work) {
    std::thread::Builder::new()
      .name(SPAWN_BLOCKING_FALLBACK_THREAD_NAME.to_owned())
      .spawn(work)
      .expect("Failed to spawn the napi `spawn_blocking` fallback thread");
  }
  JoinHandle { state }
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

// These tests compile for both the pure `async-runtime` build and the combined
// `async-runtime` + `tokio_rt` build (Cargo feature unification): in both, the free
// `spawn`/`spawn_blocking` helpers must route through the registered `AsyncRuntime`
// backend — there is no built-in tokio runtime to fall back on under `async-runtime`.
#[cfg(all(test, not(feature = "noop"), feature = "async-runtime"))]
mod tests {
  use std::sync::{
    atomic::{AtomicBool, AtomicUsize, Ordering},
    Mutex, MutexGuard,
  };

  use super::*;

  const BACKEND_WORKER_THREAD: &str = "inline-runtime-worker";
  const BACKEND_BLOCKING_THREAD: &str = "inline-runtime-blocking";

  static BACKEND_SPAWN_CALLS: AtomicUsize = AtomicUsize::new(0);
  static BACKEND_BLOCKING_CALLS: AtomicUsize = AtomicUsize::new(0);
  static DECLINE_SPAWN_BLOCKING: AtomicBool = AtomicBool::new(false);
  /// Serializes the tests that observe `BACKEND_BLOCKING_CALLS` or flip
  /// `DECLINE_SPAWN_BLOCKING`, so a decline in one test cannot leak into another.
  static SPAWN_BLOCKING_TEST_LOCK: Mutex<()> = Mutex::new(());

  fn spawn_blocking_test_guard() -> MutexGuard<'static, ()> {
    SPAWN_BLOCKING_TEST_LOCK
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner)
  }

  /// Resets `DECLINE_SPAWN_BLOCKING` even if the test body panics.
  struct DeclineNextSpawnBlocking;

  impl DeclineNextSpawnBlocking {
    fn arm() -> Self {
      DECLINE_SPAWN_BLOCKING.store(true, Ordering::SeqCst);
      DeclineNextSpawnBlocking
    }
  }

  impl Drop for DeclineNextSpawnBlocking {
    fn drop(&mut self) {
      DECLINE_SPAWN_BLOCKING.store(false, Ordering::SeqCst);
    }
  }

  /// A minimal joinable-capable backend: every hook runs the work on a dedicated,
  /// deterministically named `std::thread`, so tests can assert *where* routed work ran.
  struct InlineRuntime;

  impl AsyncRuntime for InlineRuntime {
    fn spawn(&self, future: Pin<Box<dyn Future<Output = ()> + Send + 'static>>) {
      BACKEND_SPAWN_CALLS.fetch_add(1, Ordering::SeqCst);
      std::thread::Builder::new()
        .name(BACKEND_WORKER_THREAD.to_owned())
        .spawn(move || futures::executor::block_on(future))
        .expect("failed to spawn the InlineRuntime worker thread");
    }

    fn block_on(&self, future: Pin<&mut dyn Future<Output = ()>>) {
      futures::executor::block_on(future);
    }

    fn spawn_blocking(
      &self,
      work: Box<dyn FnOnce() + Send + 'static>,
    ) -> std::result::Result<(), Box<dyn FnOnce() + Send + 'static>> {
      if DECLINE_SPAWN_BLOCKING.load(Ordering::SeqCst) {
        return Err(work);
      }
      BACKEND_BLOCKING_CALLS.fetch_add(1, Ordering::SeqCst);
      std::thread::Builder::new()
        .name(BACKEND_BLOCKING_THREAD.to_owned())
        .spawn(work)
        .expect("failed to spawn the InlineRuntime blocking thread");
      Ok(())
    }
  }

  /// Registers `InlineRuntime` exactly once for the whole test binary: registration is
  /// process-global and double registration panics by design (covered by the separate
  /// `async_runtime_registration` integration-test binary).
  fn ensure_runtime() {
    static REGISTER: std::sync::Once = std::sync::Once::new();
    REGISTER.call_once(|| create_custom_async_runtime(InlineRuntime));
  }

  #[test]
  fn free_spawn_returns_joinable_handle() {
    ensure_runtime();
    let calls_before = BACKEND_SPAWN_CALLS.load(Ordering::SeqCst);

    let handle = spawn(async { 41 + 1 });
    let value = futures::executor::block_on(handle)
      .expect("the spawned task completed, so joining its handle must succeed");

    assert_eq!(value, 42);
    assert!(
      BACKEND_SPAWN_CALLS.load(Ordering::SeqCst) > calls_before,
      "the free `spawn` helper must route through `AsyncRuntime::spawn`"
    );
  }

  #[test]
  fn free_spawn_blocking_routes_to_backend() {
    ensure_runtime();
    let _guard = spawn_blocking_test_guard();
    let calls_before = BACKEND_BLOCKING_CALLS.load(Ordering::SeqCst);

    let handle = spawn_blocking(|| std::thread::current().name().map(str::to_owned));
    let thread_name = futures::executor::block_on(handle)
      .expect("the blocking task completed, so joining its handle must succeed");

    assert_eq!(
      thread_name.as_deref(),
      Some(BACKEND_BLOCKING_THREAD),
      "routed `spawn_blocking` work must run on the custom runtime"
    );
    assert_eq!(
      BACKEND_BLOCKING_CALLS.load(Ordering::SeqCst),
      calls_before + 1,
      "the free `spawn_blocking` helper must route through `AsyncRuntime::spawn_blocking`"
    );
  }

  #[test]
  fn declined_spawn_blocking_completes_on_fallback_thread() {
    ensure_runtime();
    let _guard = spawn_blocking_test_guard();
    let calls_before = BACKEND_BLOCKING_CALLS.load(Ordering::SeqCst);
    let _decline = DeclineNextSpawnBlocking::arm();

    let handle = spawn_blocking(|| std::thread::current().name().map(str::to_owned));
    let thread_name = futures::executor::block_on(handle)
      .expect("work declined by the backend must still run to completion");

    assert_eq!(
      thread_name.as_deref(),
      Some(SPAWN_BLOCKING_FALLBACK_THREAD_NAME),
      "declined `spawn_blocking` work must run on napi's plain fallback thread"
    );
    assert_eq!(
      BACKEND_BLOCKING_CALLS.load(Ordering::SeqCst),
      calls_before,
      "a declining backend must hand the closure back instead of running it"
    );
  }

  #[test]
  fn spawn_join_error_carries_panic_payload() {
    ensure_runtime();

    let handle = spawn(async { panic!("boom-in-async-task") });
    let err = futures::executor::block_on(handle)
      .expect_err("a panicking task must surface a JoinError through its handle");

    assert!(err.is_panic());
    let payload = err
      .try_into_panic()
      .expect("a panic JoinError must hand the payload back");
    assert_eq!(
      payload.downcast_ref::<&str>().copied(),
      Some("boom-in-async-task")
    );
  }

  #[test]
  fn spawn_blocking_join_error_carries_panic_payload() {
    ensure_runtime();
    let _guard = spawn_blocking_test_guard();

    let handle = spawn_blocking(|| -> () { panic!("boom-in-blocking-task") });
    let err = futures::executor::block_on(handle)
      .expect_err("a panicking blocking task must surface a JoinError through its handle");

    assert!(err.is_panic());
    let payload = err
      .try_into_panic()
      .expect("a panic JoinError must hand the payload back");
    assert_eq!(
      payload.downcast_ref::<&str>().copied(),
      Some("boom-in-blocking-task")
    );
  }
}
