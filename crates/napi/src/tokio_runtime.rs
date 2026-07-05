#[cfg(all(not(feature = "noop"), feature = "async-runtime"))]
use std::cell::Cell;
#[cfg(all(not(feature = "noop"), feature = "async-runtime"))]
use std::collections::HashMap;
#[cfg(not(feature = "noop"))]
use std::sync::OnceLock;
#[cfg(all(not(feature = "noop"), feature = "async-runtime"))]
use std::sync::{
  atomic::{AtomicBool, AtomicUsize, Ordering},
  LazyLock,
};
#[cfg(all(not(feature = "noop"), feature = "tokio_rt"))]
use std::sync::{RwLock, Weak};
use std::{future::Future, marker::PhantomData};

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
use std::any::Any;
#[cfg(not(feature = "noop"))]
use std::panic::AssertUnwindSafe;
#[cfg(any(
  feature = "async-runtime",
  all(feature = "tokio_rt", not(feature = "noop"))
))]
use std::pin::Pin;
#[cfg(all(
  not(feature = "noop"),
  any(feature = "async-runtime", feature = "tokio_rt")
))]
use std::sync::Arc;
#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
use std::sync::{Condvar, Mutex};
#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
use std::task::Context;
#[cfg(not(feature = "noop"))]
use std::task::Poll;
#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
use std::task::Waker;

#[cfg(feature = "tokio")]
use tokio::runtime::Runtime;

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
use futures::{
  future::{AbortHandle, Abortable},
  FutureExt,
};

use crate::{bindgen_runtime::ToNapiValue, sys, Env, Error, Result};
#[cfg(not(feature = "noop"))]
use crate::{JsDeferred, SendableResolver, Unknown};

#[cfg(feature = "async-runtime")]
pub trait AsyncRuntimeGuard {}

#[cfg(feature = "async-runtime")]
impl AsyncRuntimeGuard for () {}

#[cfg(all(feature = "async-runtime", feature = "noop"))]
pub struct AsyncRuntimeTask {
  _private: (),
}

#[cfg(all(feature = "async-runtime", feature = "noop"))]
impl Future for AsyncRuntimeTask {
  type Output = ();

  fn poll(self: Pin<&mut Self>, _cx: &mut std::task::Context<'_>) -> std::task::Poll<Self::Output> {
    std::task::Poll::Ready(())
  }
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
enum AsyncTaskOutcome {
  Completed,
  Cancelled,
}

/// Runtime-owned task submitted through [`AsyncRuntime::spawn`].
///
/// The wrapper is intentionally opaque: it guarantees that rejection, environment teardown,
/// or backend-side task dropping runs the cancellation callback exactly once. Backends should
/// poll it like any other `Future<Output = ()>` and return it untouched when submission fails.
#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
pub struct AsyncRuntimeTask {
  future: Option<Pin<Box<dyn Future<Output = AsyncTaskOutcome> + Send + 'static>>>,
  cancel: Option<Box<dyn FnOnce(Option<Error>) + Send + 'static>>,
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
impl AsyncRuntimeTask {
  fn new(
    future: impl Future<Output = AsyncTaskOutcome> + Send + 'static,
    cancel: impl FnOnce(Option<Error>) + Send + 'static,
  ) -> Self {
    Self {
      future: Some(Box::pin(future)),
      cancel: Some(Box::new(cancel)),
    }
  }

  fn cancel(&mut self, error: Option<Error>) {
    if let Some(cancel) = self.cancel.take() {
      crate::bindgen_runtime::catch_unwind_safely(|| cancel(error));
    }
  }

  fn reject(mut self, error: Error) {
    self.cancel(Some(error));
    self.drop_future();
  }

  fn disarm_cancel(&mut self) {
    if let Some(cancel) = self.cancel.take() {
      drop_safely(cancel);
    }
  }

  fn drop_future(&mut self) {
    if let Some(future) = self.future.take() {
      drop_safely(future);
    }
  }
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
impl Future for AsyncRuntimeTask {
  type Output = ();

  fn poll(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output> {
    let Some(future) = self.future.as_mut() else {
      return Poll::Ready(());
    };
    let poll = std::panic::catch_unwind(AssertUnwindSafe(|| future.as_mut().poll(cx)));
    match poll {
      Err(reason) => {
        drop(crate::bindgen_runtime::panic_to_error(reason));
        self.cancel(None);
        self.drop_future();
        Poll::Ready(())
      }
      Ok(Poll::Ready(AsyncTaskOutcome::Completed)) => {
        self.disarm_cancel();
        self.drop_future();
        Poll::Ready(())
      }
      Ok(Poll::Ready(AsyncTaskOutcome::Cancelled)) => {
        self.cancel(None);
        self.drop_future();
        Poll::Ready(())
      }
      Ok(Poll::Pending) => Poll::Pending,
    }
  }
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
impl Drop for AsyncRuntimeTask {
  fn drop(&mut self) {
    self.cancel(None);
    self.drop_future();
  }
}

#[cfg(not(feature = "noop"))]
fn drop_safely<T>(value: T) {
  crate::bindgen_runtime::catch_unwind_safely(|| drop(value));
}

#[cfg(not(feature = "noop"))]
struct SafeDrop<T>(Option<T>);

#[cfg(not(feature = "noop"))]
impl<T> SafeDrop<T> {
  fn new(value: T) -> Self {
    Self(Some(value))
  }

  fn get_mut(&mut self) -> &mut T {
    self
      .0
      .as_mut()
      .expect("safe-drop value is present until taken")
  }

  fn take(&mut self) -> T {
    self
      .0
      .take()
      .expect("safe-drop value is taken exactly once")
  }
}

#[cfg(not(feature = "noop"))]
impl<T> Drop for SafeDrop<T> {
  fn drop(&mut self) {
    if let Some(value) = self.0.take() {
      drop_safely(value);
    }
  }
}

/// Service-provider interface for plugging a custom async runtime into NAPI-RS.
///
/// When the `async-runtime` feature is enabled, napi no longer drives JS-facing futures on
/// its built-in tokio runtime. The futures produced by `#[napi]` async functions — together
/// with `#[napi(async_runtime)]` entry points — are routed through the single backend
/// registered with [`create_custom_async_runtime`]. Implement this trait to back napi with
/// your own scheduler (e.g. a single-threaded or WASI-friendly runtime) and register exactly
/// one instance, once, at module init.
///
/// Under the `noop` feature this SPI is inert: [`create_custom_async_runtime`] does nothing and
/// the routed entry points are stubbed out (e.g. `block_on` panics), so the notes below about
/// routing apply only to non-`noop` builds.
///
/// The explicit `spawn_on_custom_runtime` and `spawn_blocking_on_custom_runtime` helpers
/// are part of this routing contract in every `async-runtime` build. napi manufactures its
/// own joinable handle around [`spawn`](AsyncRuntime::spawn), while the blocking helper
/// completes that handle as cancelled when the backend declines. The established free
/// `spawn` and `spawn_blocking` names remain Tokio-only compatibility APIs whenever
/// `tokio_rt` is enabled, so Cargo feature unification cannot change either API's signature
/// or routing. Generated JavaScript-facing futures always use this backend. Tokio helpers
/// reject external work while the combined runtime is starting, stopping, or stopped, so
/// callers cannot observe a half-transitioned pair. Runtime hooks may still use Tokio
/// synchronously on the transition thread. Synchronous custom-runtime operations are gated
/// for their full duration as well: shutdown waits for them to return, and external calls are
/// rejected before startup, during lifecycle transitions, and after shutdown. Lifecycle
/// hooks may still use those operations synchronously on the transition thread.
///
/// The implementation is stored once per linked addon image and shared across its threads,
/// hence the `Send + Sync + 'static` bound. See [`create_custom_async_runtime`] for duplicate
/// registration behavior.
#[cfg(feature = "async-runtime")]
pub trait AsyncRuntime: Send + Sync + 'static {
  /// Submit a task to run to completion in the background.
  ///
  /// Return `Ok(())` only after taking ownership of the task. Return `Err(task)` when the
  /// runtime is stopped, saturated, or otherwise unable to accept it. Dropping an accepted
  /// task invokes its cancellation callback, so shutdown implementations may cancel queued
  /// work by dropping it without leaving Rust joins or JavaScript promises pending forever.
  /// Generated promises distinguish an immediate `Err(task)` submission rejection from a
  /// task dropped later during runtime shutdown. Never forget an accepted task: retain it
  /// until completion or drop it on cancellation.
  ///
  /// Panic handling is already done by napi. Poll the task directly and do not bypass its
  /// `Drop` implementation.
  fn spawn(&self, task: AsyncRuntimeTask) -> std::result::Result<(), AsyncRuntimeTask>;

  /// Block the current thread, fully driving the pinned future to completion before
  /// returning.
  ///
  /// In a pure `async-runtime` build this backs napi's synchronous [`block_on`] and
  /// `try_block_on`. Combined `async-runtime` + `tokio_rt` builds retain the established
  /// Tokio implementation for those free helpers. napi stores the future's result through a
  /// side effect and verifies that it is present when this method returns. `try_block_on`
  /// reports an early return as an error; the compatibility [`block_on`] wrapper panics on
  /// that error. napi holds the runtime lifecycle open until this method returns, so a
  /// concurrent shutdown waits rather than tearing the backend down underneath it. Run the
  /// future to completion rather than returning on the first pending poll.
  fn block_on(&self, future: Pin<&mut dyn Future<Output = ()>>);

  /// Enter the runtime context and return a guard that establishes it for the calling
  /// thread.
  ///
  /// napi calls this for `#[napi(async_runtime)]` functions and from
  /// [`within_runtime_if_available`] in pure `async-runtime` builds: it enters, runs a
  /// synchronous closure, then drops the guard. The returned guard MUST keep the runtime
  /// context active for the whole duration of the closure and tear it down on drop. The
  /// runtime lifecycle remains open through guard destruction, so shutdown cannot overlap the
  /// entered context. The default implementation returns a no-op guard, which is correct for
  /// backends that do not need an ambient context.
  fn enter(&self) -> Box<dyn AsyncRuntimeGuard + '_> {
    Box::new(())
  }

  /// Start (or restart) the runtime.
  ///
  /// napi calls this when the first live Node environment for the addon starts. Worker
  /// isolates and Electron renderer reloads can take the live environment count from zero
  /// to one repeatedly, so this may run more than once over the backend's lifetime.
  /// Implement it idempotently. Return success only after the backend can accept tasks. A
  /// successful restart must not overlap worker resources from a retiring generation; wait
  /// for retirement or return an error and let the caller retry. Do not call napi's runtime
  /// registration or lifecycle functions recursively from this hook. If this returns an error
  /// or panics, napi calls [`shutdown`](AsyncRuntime::shutdown) to roll back resources created
  /// by the partial start. The default is a no-op.
  fn start(&self) -> Result<()> {
    Ok(())
  }

  /// Shut the runtime down.
  ///
  /// napi installs cleanup ownership for every Node environment and calls this after the last
  /// live environment exits. On wasm, host finalization still determines when the exports
  /// finalizer runs. An explicit `shutdown_async_runtime` call can also invoke this while
  /// environments remain live. Stop accepting work before returning and drop queued
  /// [`AsyncRuntimeTask`] values so their promises are cancelled. If already-running blocking
  /// work cannot be interrupted, keep that scheduler generation in a retiring state and do
  /// not allow a later successful [`start`](AsyncRuntime::start) to overlap its worker
  /// resources. Do not wait for JavaScript callbacks triggered by cancellation, and do not
  /// call napi's runtime registration or lifecycle functions recursively from this hook. The
  /// hook must be idempotent and tolerate being called after a partial failed `start`. The
  /// default is a no-op. If this returns an error, napi keeps submissions closed and rejects
  /// restart until shutdown is retried successfully, preventing scheduler generations from
  /// overlapping.
  fn shutdown(&self) -> Result<()> {
    Ok(())
  }

  /// Optional hook: run `work` on the backend's blocking-capable lane.
  ///
  /// This backs `spawn_blocking_on_custom_runtime`. Return `Ok(())` once the work is
  /// accepted; the backend should run the closure exactly once on a thread where blocking is
  /// acceptable. Dropping accepted work, for example while shutting down, safely cancels the
  /// caller's join handle. Return `Err(work)` to decline; the join handle completes as
  /// cancelled and napi does not create an unbounded fallback thread. Never forget accepted
  /// work: run it exactly once or drop it during cancellation. The default implementation
  /// declines.
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
const DUPLICATE_RUNTIME_ERROR: &str =
  "create_custom_async_runtime was called more than once for the same addon image";

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum RuntimeLifecycleState {
  Stopped,
  Starting,
  Running,
  Stopping,
  ShutdownFailed,
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
struct RuntimeLifecycle {
  active_envs: usize,
  state: RuntimeLifecycleState,
  registration_error: Option<String>,
  startup_error: Option<String>,
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
static RUNTIME_LIFECYCLE: (Mutex<RuntimeLifecycle>, Condvar) = (
  Mutex::new(RuntimeLifecycle {
    active_envs: 0,
    state: RuntimeLifecycleState::Stopped,
    registration_error: None,
    startup_error: None,
  }),
  Condvar::new(),
);

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
#[derive(Clone, Copy, PartialEq, Eq)]
enum RuntimeSubmissionState {
  NeverStarted,
  Open,
  Closed,
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
struct RuntimeSubmissions {
  state: RuntimeSubmissionState,
  in_flight: usize,
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
static RUNTIME_SUBMISSIONS: (Mutex<RuntimeSubmissions>, Condvar) = (
  Mutex::new(RuntimeSubmissions {
    state: RuntimeSubmissionState::NeverStarted,
    in_flight: 0,
  }),
  Condvar::new(),
);

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
thread_local! {
  static RUNTIME_SUBMISSION_DEPTH: Cell<usize> = const { Cell::new(0) };
  static RUNTIME_TRANSITION_DEPTH: Cell<usize> = const { Cell::new(0) };
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
/// Keeps a call into the custom backend from overlapping a lifecycle transition. Submission
/// hooks hold it only while ownership is transferred; synchronous operations hold it until the
/// future or entered callback and its guard have finished.
struct RuntimeUsePermit;

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
impl RuntimeUsePermit {
  fn acquire() -> Option<Self> {
    let mut submissions = RUNTIME_SUBMISSIONS
      .0
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner);
    if submissions.state == RuntimeSubmissionState::Closed {
      return None;
    }
    submissions.in_flight += 1;
    RUNTIME_SUBMISSION_DEPTH.with(|depth| depth.set(depth.get() + 1));
    Some(Self)
  }

  fn acquire_synchronous() -> Option<Self> {
    let hook_local_transition = RUNTIME_TRANSITION_DEPTH.with(Cell::get) != 0;
    let lifecycle = runtime_lifecycle();
    let mut submissions = RUNTIME_SUBMISSIONS
      .0
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner);
    if !hook_local_transition
      && (submissions.state != RuntimeSubmissionState::Open
        || lifecycle.state != RuntimeLifecycleState::Running)
    {
      return None;
    }
    submissions.in_flight += 1;
    RUNTIME_SUBMISSION_DEPTH.with(|depth| depth.set(depth.get() + 1));
    Some(Self)
  }
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
impl Drop for RuntimeUsePermit {
  fn drop(&mut self) {
    RUNTIME_SUBMISSION_DEPTH.with(|depth| depth.set(depth.get() - 1));
    let mut submissions = RUNTIME_SUBMISSIONS
      .0
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner);
    submissions.in_flight -= 1;
    if submissions.in_flight == 0 {
      RUNTIME_SUBMISSIONS.1.notify_all();
    }
  }
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
fn open_runtime_submissions() {
  RUNTIME_SUBMISSIONS
    .0
    .lock()
    .unwrap_or_else(std::sync::PoisonError::into_inner)
    .state = RuntimeSubmissionState::Open;
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
fn close_runtime_submissions() -> Result<()> {
  if RUNTIME_SUBMISSION_DEPTH.with(Cell::get) != 0 {
    return Err(Error::new(
      crate::Status::GenericFailure,
      "Cannot transition the async runtime from inside an AsyncRuntime operation",
    ));
  }
  let mut submissions = RUNTIME_SUBMISSIONS
    .0
    .lock()
    .unwrap_or_else(std::sync::PoisonError::into_inner);
  submissions.state = RuntimeSubmissionState::Closed;
  while submissions.in_flight != 0 {
    submissions = RUNTIME_SUBMISSIONS
      .1
      .wait(submissions)
      .unwrap_or_else(std::sync::PoisonError::into_inner);
  }
  Ok(())
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
fn runtime_lifecycle() -> std::sync::MutexGuard<'static, RuntimeLifecycle> {
  RUNTIME_LIFECYCLE
    .0
    .lock()
    .unwrap_or_else(std::sync::PoisonError::into_inner)
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
fn wait_for_runtime_transition(
  mut lifecycle: std::sync::MutexGuard<'static, RuntimeLifecycle>,
) -> Result<std::sync::MutexGuard<'static, RuntimeLifecycle>> {
  while matches!(
    lifecycle.state,
    RuntimeLifecycleState::Starting | RuntimeLifecycleState::Stopping
  ) {
    if RUNTIME_TRANSITION_DEPTH.with(Cell::get) != 0
      || RUNTIME_SUBMISSION_DEPTH.with(Cell::get) != 0
    {
      return Err(Error::new(
        crate::Status::GenericFailure,
        "Async runtime lifecycle functions cannot wait recursively from a runtime hook",
      ));
    }
    lifecycle = RUNTIME_LIFECYCLE
      .1
      .wait(lifecycle)
      .unwrap_or_else(std::sync::PoisonError::into_inner);
  }
  Ok(lifecycle)
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
struct RuntimeTransitionGuard;

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
impl RuntimeTransitionGuard {
  fn enter() -> Self {
    RUNTIME_TRANSITION_DEPTH.with(|depth| depth.set(depth.get() + 1));
    Self
  }
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
impl Drop for RuntimeTransitionGuard {
  fn drop(&mut self) {
    RUNTIME_TRANSITION_DEPTH.with(|depth| depth.set(depth.get() - 1));
  }
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
fn custom_async_runtime() -> Result<&'static dyn AsyncRuntime> {
  CUSTOM_ASYNC_RUNTIME.get().map(Box::as_ref).ok_or_else(|| {
    Error::new(
      crate::Status::GenericFailure,
      "No AsyncRuntime backend is registered. Call \
       napi::bindgen_prelude::create_custom_async_runtime(...) from a module_init hook",
    )
  })
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
fn acquire_synchronous_runtime_use() -> Result<RuntimeUsePermit> {
  RuntimeUsePermit::acquire_synchronous().ok_or_else(|| {
    Error::new(
      crate::Status::GenericFailure,
      "The async runtime is not running",
    )
  })
}

/// Register the custom [`AsyncRuntime`] backend for this linked addon image.
///
/// Call this once, at module init, before any async entry point runs.
///
/// Registration is once per linked addon image. Duplicate registration records a module-load
/// error that napi throws from `napi_register_module_v1`; it never unwinds from a library
/// constructor.
/// ### Example
/// ```no_run
/// use std::future::Future;
/// use std::pin::Pin;
/// use napi::bindgen_prelude::{create_custom_async_runtime, AsyncRuntime, AsyncRuntimeTask};
///
/// struct MyRuntime;
/// impl AsyncRuntime for MyRuntime {
///   fn spawn(
///     &self,
///     _task: AsyncRuntimeTask,
///   ) -> std::result::Result<(), AsyncRuntimeTask> { todo!() }
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
  if let Err(error) = try_create_custom_async_runtime(runtime) {
    let mut lifecycle = runtime_lifecycle();
    if error.reason == DUPLICATE_RUNTIME_ERROR {
      lifecycle.registration_error = Some(error.reason);
    } else {
      lifecycle.startup_error = Some(error.reason);
    }
  }
}

/// Try to register a custom async runtime without panicking.
///
/// Library constructors should normally use [`create_custom_async_runtime`], which defers
/// reporting until Node provides an environment where napi can throw a JavaScript exception.
#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
pub fn try_create_custom_async_runtime<R: AsyncRuntime>(runtime: R) -> Result<()> {
  if let Err(runtime) = CUSTOM_ASYNC_RUNTIME.set(Box::new(runtime)) {
    drop_safely(runtime);
    return Err(Error::new(
      crate::Status::GenericFailure,
      DUPLICATE_RUNTIME_ERROR,
    ));
  }

  let has_active_env = wait_for_runtime_transition(runtime_lifecycle())?.active_envs != 0;
  if has_active_env {
    try_start_custom_runtime()?;
  }
  Ok(())
}

#[cfg(all(feature = "async-runtime", feature = "noop"))]
pub fn create_custom_async_runtime<R: AsyncRuntime>(_: R) {}

#[cfg(all(feature = "async-runtime", feature = "noop"))]
pub fn try_create_custom_async_runtime<R: AsyncRuntime>(_: R) -> Result<()> {
  Ok(())
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
pub(crate) fn register_async_runtime_env() -> Result<()> {
  let should_start = {
    let mut lifecycle = wait_for_runtime_transition(runtime_lifecycle())?;
    lifecycle.active_envs += 1;
    CUSTOM_ASYNC_RUNTIME.get().is_some() && lifecycle.state != RuntimeLifecycleState::Running
  };
  if should_start {
    try_start_custom_runtime()?;
  }
  Ok(())
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
pub(crate) fn ensure_async_runtime_ready() -> Result<()> {
  let lifecycle = wait_for_runtime_transition(runtime_lifecycle())?;
  if let Some(message) = &lifecycle.registration_error {
    return Err(Error::new(crate::Status::GenericFailure, message.clone()));
  }
  if let Some(message) = &lifecycle.startup_error {
    return Err(Error::new(crate::Status::GenericFailure, message.clone()));
  }
  if CUSTOM_ASYNC_RUNTIME.get().is_none() {
    return Err(Error::new(
      crate::Status::GenericFailure,
      "The async-runtime feature is enabled, but no AsyncRuntime backend was registered",
    ));
  }
  if lifecycle.state != RuntimeLifecycleState::Running {
    return Err(Error::new(
      crate::Status::GenericFailure,
      "The registered AsyncRuntime backend did not start",
    ));
  }
  Ok(())
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
pub(crate) fn unregister_async_runtime_env() -> Result<()> {
  let should_shutdown = {
    let mut lifecycle = wait_for_runtime_transition(runtime_lifecycle())?;
    if lifecycle.active_envs == 0 {
      return Ok(());
    }
    lifecycle.active_envs -= 1;
    if lifecycle.active_envs != 0
      || !matches!(
        lifecycle.state,
        RuntimeLifecycleState::Running | RuntimeLifecycleState::ShutdownFailed
      )
    {
      false
    } else {
      lifecycle.state = RuntimeLifecycleState::Stopping;
      true
    }
  };
  if !should_shutdown {
    return Ok(());
  }
  finish_custom_runtime_shutdown(true)
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
struct EnvTasks {
  closed: AtomicBool,
  next_id: AtomicUsize,
  abort_handles: Mutex<HashMap<usize, AbortHandle>>,
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
impl EnvTasks {
  fn new() -> Self {
    Self {
      closed: AtomicBool::new(false),
      next_id: AtomicUsize::new(1),
      abort_handles: Mutex::new(HashMap::new()),
    }
  }

  fn register(&self, abort_handle: AbortHandle) -> Option<usize> {
    if self.closed.load(Ordering::Acquire) {
      abort_safely(abort_handle);
      return None;
    }
    let id = self.next_id.fetch_add(1, Ordering::Relaxed);
    self
      .abort_handles
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner)
      .insert(id, abort_handle);
    if self.closed.load(Ordering::Acquire) {
      if let Some(abort_handle) = self.take_abort_handle(id) {
        abort_safely(abort_handle);
        return None;
      }
    }
    Some(id)
  }

  fn remove(&self, id: usize) {
    drop(self.take_abort_handle(id));
  }

  fn take_abort_handle(&self, id: usize) -> Option<AbortHandle> {
    // Return an owned handle so aborting and its synchronous wake cannot run under this lock.
    self
      .abort_handles
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner)
      .remove(&id)
  }

  fn cancel_all(&self, close_env: bool) {
    if close_env {
      self.closed.store(true, Ordering::Release);
    }
    let handles = std::mem::take(
      &mut *self
        .abort_handles
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner),
    );
    for (_, handle) in handles {
      abort_safely(handle);
    }
  }
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
fn abort_safely(handle: AbortHandle) {
  crate::bindgen_runtime::catch_unwind_safely(|| handle.abort());
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
struct EnvTaskRegistration {
  tasks: Arc<EnvTasks>,
  id: Option<usize>,
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
impl Drop for EnvTaskRegistration {
  fn drop(&mut self) {
    if let Some(id) = self.id.take() {
      self.tasks.remove(id);
    }
  }
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
static ENV_TASKS: LazyLock<Mutex<HashMap<usize, Arc<EnvTasks>>>> =
  LazyLock::new(|| Mutex::new(HashMap::new()));

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
pub(crate) fn register_async_runtime_env_tasks(env: sys::napi_env) {
  let previous = ENV_TASKS
    .lock()
    .unwrap_or_else(std::sync::PoisonError::into_inner)
    .insert(env as usize, Arc::new(EnvTasks::new()));
  if let Some(previous) = previous {
    previous.cancel_all(true);
  }
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
pub(crate) fn cancel_async_runtime_env_tasks(env: sys::napi_env) {
  let tasks = ENV_TASKS
    .lock()
    .unwrap_or_else(std::sync::PoisonError::into_inner)
    .remove(&(env as usize));
  if let Some(tasks) = tasks {
    tasks.cancel_all(true);
  }
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
fn cancel_all_env_tasks() {
  let envs: Vec<_> = ENV_TASKS
    .lock()
    .unwrap_or_else(std::sync::PoisonError::into_inner)
    .values()
    .cloned()
    .collect();
  for tasks in envs {
    tasks.cancel_all(false);
  }
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
fn env_async_task(
  env: sys::napi_env,
  future: impl Future<Output = ()> + Send + 'static,
  cancel: impl FnOnce(bool, Option<Error>) + Send + 'static,
) -> AsyncRuntimeTask {
  let tasks = ENV_TASKS
    .lock()
    .unwrap_or_else(std::sync::PoisonError::into_inner)
    .get(&(env as usize))
    .cloned();
  let Some(tasks) = tasks else {
    return AsyncRuntimeTask::new(async { AsyncTaskOutcome::Cancelled }, move |error| {
      cancel(false, error);
    });
  };

  let cancel_tasks = Arc::clone(&tasks);
  let (abort_handle, abort_registration) = AbortHandle::new_pair();
  let id = tasks.register(abort_handle);
  let registration = EnvTaskRegistration { tasks, id };
  AsyncRuntimeTask::new(
    async move {
      let result = Abortable::new(future, abort_registration).await;
      drop(registration);
      if result.is_ok() {
        AsyncTaskOutcome::Completed
      } else {
        AsyncTaskOutcome::Cancelled
      }
    },
    move |error| {
      cancel(!cancel_tasks.closed.load(Ordering::Acquire), error);
    },
  )
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
fn async_runtime_task_rejected_error() -> Error {
  Error::new(
    crate::Status::Cancelled,
    "The AsyncRuntime backend rejected the task submission because it is stopped or saturated",
  )
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
fn submit_async_task(task: AsyncRuntimeTask) {
  let Some(_submission) = RuntimeUsePermit::acquire() else {
    drop(task);
    return;
  };
  let runtime = match custom_async_runtime() {
    Ok(runtime) => runtime,
    Err(error) => {
      task.reject(error);
      return;
    }
  };
  match std::panic::catch_unwind(AssertUnwindSafe(|| runtime.spawn(task))) {
    Ok(Ok(())) => {}
    Ok(Err(task)) => task.reject(async_runtime_task_rejected_error()),
    Err(reason) => {
      // The task is dropped while unwinding through the backend call, so its cancellation
      // callback has already run by the time the panic payload reaches this boundary.
      drop(crate::bindgen_runtime::panic_to_error(reason));
    }
  }
}

#[cfg(all(not(feature = "noop"), feature = "tokio_rt"))]
fn create_runtime() -> Runtime {
  // Check if we're supposed to use a user-defined runtime
  if let Some(user_defined_rt) = USER_DEFINED_RT
    .get()
    .and_then(|rt| rt.write().ok().and_then(|mut rt| rt.take()))
  {
    return user_defined_rt;
  }
  // If no user-defined runtime was installed, or it was already consumed by a previous
  // generation, fall back to creating a default runtime.

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

// Combined `async-runtime` + `tokio_rt` builds retain this runtime for the established free
// Tokio helper APIs. Generated JavaScript-facing futures use the registered custom backend.
#[cfg(all(not(feature = "noop"), feature = "tokio_rt"))]
struct SharedTokioRuntime {
  runtime: Option<Runtime>,
  retirement: Option<Arc<()>>,
}

#[cfg(all(
  not(feature = "noop"),
  feature = "tokio_rt",
  any(
    not(target_family = "wasm"),
    all(target_family = "wasm", tokio_unstable)
  )
))]
struct TokioRuntimeRetirement {
  runtime: Option<Runtime>,
  retirement: Option<Arc<()>>,
}

#[cfg(all(
  not(feature = "noop"),
  feature = "tokio_rt",
  any(
    not(target_family = "wasm"),
    all(target_family = "wasm", tokio_unstable)
  )
))]
impl Drop for TokioRuntimeRetirement {
  fn drop(&mut self) {
    if let Some(runtime) = self.runtime.take() {
      if let Err(payload) = std::panic::catch_unwind(AssertUnwindSafe(|| drop(runtime))) {
        drop(crate::bindgen_runtime::panic_to_error(payload));
        if let Some(retirement) = self.retirement.take() {
          std::mem::forget(retirement);
        }
        return;
      }
    }
    drop(self.retirement.take());
  }
}

#[cfg(all(
  not(feature = "noop"),
  feature = "tokio_rt",
  any(
    not(target_family = "wasm"),
    all(target_family = "wasm", tokio_unstable)
  )
))]
fn launch_tokio_runtime_retirement(runtime: Runtime, retirement: Option<Arc<()>>) {
  let retirement = TokioRuntimeRetirement {
    runtime: Some(runtime),
    retirement,
  };
  launch_background_drop(retirement, |worker| {
    std::thread::Builder::new()
      .name("napi-tokio-runtime-retirement".to_owned())
      .spawn(worker)
      .map(drop)
  });
}

#[cfg(all(
  not(feature = "noop"),
  feature = "tokio_rt",
  any(
    not(target_family = "wasm"),
    all(target_family = "wasm", tokio_unstable)
  )
))]
fn launch_background_drop<T: Send + 'static>(
  value: T,
  spawn: impl FnOnce(Box<dyn FnOnce() + Send + 'static>) -> std::io::Result<()>,
) {
  let state = Arc::new(std::sync::Mutex::new(Some(value)));
  let worker_state = Arc::clone(&state);
  let worker: Box<dyn FnOnce() + Send + 'static> = Box::new(move || {
    let retirement = worker_state
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner)
      .take();
    drop(retirement);
  });
  if spawn(worker).is_err() {
    // `Builder::spawn` drops the worker closure on the calling thread when thread creation
    // fails. Keep this second owner leaked so neither Runtime::drop nor the generation token
    // can run synchronously during Node teardown. Restart remains safely blocked.
    std::mem::forget(state);
  }
}

#[cfg(all(not(feature = "noop"), feature = "tokio_rt"))]
impl std::ops::Deref for SharedTokioRuntime {
  type Target = Runtime;

  fn deref(&self) -> &Self::Target {
    self
      .runtime
      .as_ref()
      .expect("Tokio runtime is present until drop")
  }
}

#[cfg(all(not(feature = "noop"), feature = "tokio_rt"))]
impl Drop for SharedTokioRuntime {
  fn drop(&mut self) {
    let Some(runtime) = self.runtime.take() else {
      return;
    };
    let retirement = self.retirement.take();
    #[cfg(any(
      not(target_family = "wasm"),
      all(target_family = "wasm", tokio_unstable)
    ))]
    {
      launch_tokio_runtime_retirement(runtime, retirement);
    }
    #[cfg(all(target_family = "wasm", not(tokio_unstable)))]
    {
      crate::bindgen_runtime::catch_unwind_safely(|| runtime.shutdown_background());
      drop(retirement);
    }
  }
}

#[cfg(all(not(feature = "noop"), feature = "tokio_rt"))]
struct TokioRuntimeGeneration {
  runtime: Arc<SharedTokioRuntime>,
  retirement: Arc<()>,
}

#[cfg(all(not(feature = "noop"), feature = "tokio_rt"))]
struct TokioRuntimeLease {
  runtime: Arc<SharedTokioRuntime>,
  retirement: Arc<()>,
}

#[cfg(all(not(feature = "noop"), feature = "tokio_rt"))]
impl std::ops::Deref for TokioRuntimeLease {
  type Target = Runtime;

  fn deref(&self) -> &Self::Target {
    &self.runtime
  }
}

#[cfg(all(not(feature = "noop"), feature = "tokio_rt"))]
impl TokioRuntimeLease {
  fn retirement_token(&self) -> Arc<()> {
    Arc::clone(&self.retirement)
  }
}

#[cfg(all(not(feature = "noop"), feature = "tokio_rt"))]
#[derive(Clone, Copy, PartialEq, Eq)]
enum TokioRuntimeLifecycle {
  Uninitialized,
  Running,
  Stopped,
}

#[cfg(all(not(feature = "noop"), feature = "tokio_rt"))]
struct TokioRuntimeState {
  lifecycle: TokioRuntimeLifecycle,
  generation: Option<TokioRuntimeGeneration>,
  retiring: Option<Weak<()>>,
}

#[cfg(all(not(feature = "noop"), feature = "tokio_rt"))]
static TOKIO_RUNTIME_STATE: std::sync::Mutex<TokioRuntimeState> =
  std::sync::Mutex::new(TokioRuntimeState {
    lifecycle: TokioRuntimeLifecycle::Uninitialized,
    generation: None,
    retiring: None,
  });

#[cfg(all(not(feature = "noop"), feature = "tokio_rt"))]
fn runtime() -> TokioRuntimeLease {
  try_runtime().unwrap_or_else(|error| panic!("{error}"))
}

#[cfg(all(not(feature = "noop"), feature = "tokio_rt"))]
fn try_runtime() -> Result<TokioRuntimeLease> {
  #[cfg(feature = "async-runtime")]
  {
    let lifecycle = runtime_lifecycle();
    let hook_local_transition = RUNTIME_TRANSITION_DEPTH.with(Cell::get) != 0
      && matches!(
        lifecycle.state,
        RuntimeLifecycleState::Starting | RuntimeLifecycleState::Stopping
      );
    if lifecycle.state != RuntimeLifecycleState::Running && !hook_local_transition {
      return Err(Error::new(
        crate::Status::GenericFailure,
        "The combined custom and Tokio runtimes are not running",
      ));
    }
  }
  acquire_tokio_runtime(false)
}

#[cfg(all(not(feature = "noop"), feature = "tokio_rt"))]
static USER_DEFINED_RT: OnceLock<RwLock<Option<Runtime>>> = OnceLock::new();

#[cfg(all(not(feature = "noop"), feature = "tokio_rt"))]
/// Configure the built-in Tokio runtime used by NAPI-RS, controlling its configuration yourself.
///
/// This affects the built-in Tokio path whenever `tokio_rt` is enabled. If `async-runtime` is
/// enabled as well, generated JavaScript-facing futures use the registered backend while the
/// established free Tokio helpers retain their original API and runtime.
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
  if let Err(runtime) = USER_DEFINED_RT.set(RwLock::new(Some(rt))) {
    let runtime = runtime
      .into_inner()
      .unwrap_or_else(std::sync::PoisonError::into_inner);
    if let Some(runtime) = runtime {
      crate::bindgen_runtime::catch_unwind_safely(|| runtime.shutdown_background());
    }
  }
}

#[cfg(all(
  not(feature = "noop"),
  feature = "async-runtime",
  feature = "tokio",
  not(feature = "tokio_rt")
))]
/// Compatibility shim for `async-runtime` builds that link Tokio without enabling NAPI-RS's
/// built-in `tokio_rt` executor.
///
/// Generated async work is owned by the registered [`AsyncRuntime`] backend in this build, so
/// the supplied Tokio runtime is not installed.
pub fn create_custom_tokio_runtime(runtime: Runtime) {
  crate::bindgen_runtime::catch_unwind_safely(|| runtime.shutdown_background());
}

#[cfg(all(feature = "noop", feature = "tokio"))]
pub fn create_custom_tokio_runtime(runtime: Runtime) {
  crate::bindgen_runtime::catch_unwind_safely(|| runtime.shutdown_background());
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
fn call_custom_runtime_start() -> Result<()> {
  std::panic::catch_unwind(AssertUnwindSafe(|| custom_async_runtime()?.start()))
    .map_err(crate::bindgen_runtime::panic_to_error)?
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
fn call_custom_runtime_shutdown() -> Result<()> {
  std::panic::catch_unwind(AssertUnwindSafe(|| custom_async_runtime()?.shutdown()))
    .map_err(crate::bindgen_runtime::panic_to_error)?
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
fn lifecycle_error(primary: Error, cleanup: Error) -> Error {
  Error::new(
    crate::Status::GenericFailure,
    format!(
      "{}; additionally, lifecycle cleanup failed: {}",
      primary.reason, cleanup.reason
    ),
  )
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
fn rollback_failed_custom_runtime_start() -> Result<()> {
  let custom_result = call_custom_runtime_shutdown();
  #[cfg(feature = "tokio_rt")]
  let tokio_result = shutdown_tokio_runtime();
  #[cfg(not(feature = "tokio_rt"))]
  let tokio_result = Ok(());

  match (custom_result, tokio_result) {
    (Ok(()), Ok(())) => Ok(()),
    (Err(error), Ok(())) | (Ok(()), Err(error)) => Err(error),
    (Err(custom_error), Err(tokio_error)) => Err(lifecycle_error(custom_error, tokio_error)),
  }
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
fn finish_runtime_transition(result: &Result<()>, shutdown_failed: bool) {
  let mut lifecycle = runtime_lifecycle();
  match result {
    Ok(()) => {
      lifecycle.state = RuntimeLifecycleState::Running;
      lifecycle.startup_error = None;
    }
    Err(error) => {
      lifecycle.state = if shutdown_failed {
        RuntimeLifecycleState::ShutdownFailed
      } else {
        RuntimeLifecycleState::Stopped
      };
      lifecycle.startup_error = Some(error.reason.clone());
    }
  }
  RUNTIME_LIFECYCLE.1.notify_all();
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
fn try_start_custom_runtime() -> Result<()> {
  custom_async_runtime()?;
  {
    let mut lifecycle = wait_for_runtime_transition(runtime_lifecycle())?;
    match lifecycle.state {
      RuntimeLifecycleState::Running => return Ok(()),
      RuntimeLifecycleState::ShutdownFailed => {
        return Err(Error::new(
          crate::Status::GenericFailure,
          lifecycle.startup_error.clone().unwrap_or_else(|| {
            "The previous async runtime shutdown failed; retry shutdown before starting".to_owned()
          }),
        ));
      }
      RuntimeLifecycleState::Stopped => {
        lifecycle.state = RuntimeLifecycleState::Starting;
        lifecycle.startup_error = None;
      }
      RuntimeLifecycleState::Starting | RuntimeLifecycleState::Stopping => unreachable!(),
    }
  }

  let _transition = RuntimeTransitionGuard::enter();
  let mut shutdown_failed = false;
  let result = (|| {
    close_runtime_submissions()?;

    #[cfg(feature = "tokio_rt")]
    start_tokio_runtime()?;

    if let Err(error) = call_custom_runtime_start() {
      if let Err(cleanup) = rollback_failed_custom_runtime_start() {
        shutdown_failed = true;
        return Err(lifecycle_error(error, cleanup));
      }
      return Err(error);
    }

    open_runtime_submissions();
    Ok(())
  })();
  finish_runtime_transition(&result, shutdown_failed);
  result
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
fn finish_custom_runtime_shutdown(call_custom_shutdown: bool) -> Result<()> {
  let _transition = RuntimeTransitionGuard::enter();
  let result = (|| {
    close_runtime_submissions()?;
    cancel_all_env_tasks();

    let custom_result = if call_custom_shutdown {
      call_custom_runtime_shutdown()
    } else {
      Ok(())
    };
    #[cfg(feature = "tokio_rt")]
    let tokio_result = shutdown_tokio_runtime();
    #[cfg(not(feature = "tokio_rt"))]
    let tokio_result = Ok(());

    match (custom_result, tokio_result) {
      (Ok(()), Ok(())) => Ok(()),
      (Err(error), Ok(())) | (Ok(()), Err(error)) => Err(error),
      (Err(custom_error), Err(tokio_error)) => Err(lifecycle_error(custom_error, tokio_error)),
    }
  })();

  let mut lifecycle = runtime_lifecycle();
  lifecycle.state = if result.is_ok() {
    RuntimeLifecycleState::Stopped
  } else {
    RuntimeLifecycleState::ShutdownFailed
  };
  lifecycle.startup_error = result.as_ref().err().map(|error| error.reason.clone());
  RUNTIME_LIFECYCLE.1.notify_all();
  result
}

#[cfg(not(feature = "noop"))]
/// Start the async runtime.
///
/// With the `async-runtime` feature this delegates to the registered `AsyncRuntime` backend's
/// `start`. When `tokio_rt` is also enabled by Cargo feature unification, this starts both the
/// custom backend used by generated JavaScript-facing futures and the built-in Tokio runtime
/// retained by the free Tokio helper APIs. Without `async-runtime`, it starts only Tokio.
///
/// In Node.js native targets the async runtime will be dropped when Node env exits.
/// But in Electron renderer process, the Node env will exits and recreate when the window reloads.
/// So we need to ensure that the async runtime is initialized when the Node env is created.
///
/// On wasm, shutdown is not tied to the Node env cleanup hook: depending on host finalization
/// it may be triggered by the exports `napi_wrap` finalizer when the module count reaches zero,
/// or you can call `shutdown_async_runtime` explicitly. A custom `async-runtime` backend
/// controls its own lifetime. In some scenarios you may want to start the runtime again, e.g.
/// in tests. This compatibility wrapper reports startup failures to stderr; use
/// [`try_start_async_runtime`] when the caller must know that restart succeeded.
pub fn start_async_runtime() {
  if let Err(error) = try_start_async_runtime() {
    crate::bindgen_runtime::catch_unwind_safely(|| {
      eprintln!("Failed to start async runtime: {error}");
    });
  }
}

/// Fallible form of [`start_async_runtime`].
///
/// In a `tokio_rt` build, restart returns an error while worker resources from the previous
/// generation are still shutting down. Retry after that retirement completes; napi never starts
/// a new Tokio generation that overlaps the old one.
#[cfg(not(feature = "noop"))]
pub fn try_start_async_runtime() -> Result<()> {
  #[cfg(feature = "async-runtime")]
  {
    try_start_custom_runtime()
  }
  #[cfg(all(feature = "tokio_rt", not(feature = "async-runtime")))]
  {
    start_tokio_runtime()
  }
  #[cfg(not(any(feature = "async-runtime", feature = "tokio_rt")))]
  {
    Ok(())
  }
}

#[cfg(not(feature = "noop"))]
/// Shut the async runtime down.
///
/// With the `async-runtime` feature this delegates to the registered `AsyncRuntime` backend's
/// `shutdown`. When `tokio_rt` is also enabled by Cargo feature unification, this shuts down
/// both the custom backend and the built-in Tokio runtime retained by the free Tokio helper
/// APIs. Without `async-runtime`, it takes down only Tokio.
pub fn shutdown_async_runtime() {
  if let Err(error) = try_shutdown_async_runtime() {
    crate::bindgen_runtime::catch_unwind_safely(|| {
      eprintln!("Failed to shut down async runtime: {error}");
    });
  }
}

/// Fallible form of [`shutdown_async_runtime`].
#[cfg(not(feature = "noop"))]
pub fn try_shutdown_async_runtime() -> Result<()> {
  #[cfg(feature = "async-runtime")]
  {
    if RUNTIME_SUBMISSION_DEPTH.with(Cell::get) != 0 {
      return Err(Error::new(
        crate::Status::GenericFailure,
        "Cannot transition the async runtime from inside an AsyncRuntime operation",
      ));
    }
    let call_custom_shutdown = {
      let mut lifecycle = wait_for_runtime_transition(runtime_lifecycle())?;
      let call_custom_shutdown = CUSTOM_ASYNC_RUNTIME.get().is_some()
        && matches!(
          lifecycle.state,
          RuntimeLifecycleState::Stopped
            | RuntimeLifecycleState::Running
            | RuntimeLifecycleState::ShutdownFailed
        );
      lifecycle.state = RuntimeLifecycleState::Stopping;
      call_custom_shutdown
    };
    finish_custom_runtime_shutdown(call_custom_shutdown)
  }
  #[cfg(all(feature = "tokio_rt", not(feature = "async-runtime")))]
  {
    shutdown_tokio_runtime()
  }
  #[cfg(not(any(feature = "async-runtime", feature = "tokio_rt")))]
  {
    Ok(())
  }
}

#[cfg(all(not(feature = "noop"), feature = "tokio_rt"))]
pub(crate) fn start_tokio_runtime() -> Result<()> {
  start_tokio_runtime_impl(true)
}

#[cfg(all(not(feature = "noop"), feature = "tokio_rt"))]
fn start_tokio_runtime_impl(allow_restart: bool) -> Result<()> {
  acquire_tokio_runtime(allow_restart).map(drop)
}

#[cfg(all(not(feature = "noop"), feature = "tokio_rt"))]
fn acquire_tokio_runtime(allow_restart: bool) -> Result<TokioRuntimeLease> {
  std::panic::catch_unwind(AssertUnwindSafe(|| -> Result<TokioRuntimeLease> {
    let mut state = TOKIO_RUNTIME_STATE
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner);
    match state.lifecycle {
      TokioRuntimeLifecycle::Running => {
        let generation = state
          .generation
          .as_ref()
          .expect("running Tokio lifecycle must own a generation");
        return Ok(TokioRuntimeLease {
          runtime: Arc::clone(&generation.runtime),
          retirement: Arc::clone(&generation.retirement),
        });
      }
      TokioRuntimeLifecycle::Stopped if !allow_restart => {
        return Err(Error::new(
          crate::Status::GenericFailure,
          "Tokio runtime is stopped; call start_async_runtime before using it again",
        ));
      }
      TokioRuntimeLifecycle::Uninitialized | TokioRuntimeLifecycle::Stopped => {}
    }
    if state.retiring.as_ref().and_then(Weak::upgrade).is_some() {
      return Err(Error::new(
        crate::Status::GenericFailure,
        "Tokio runtime is still shutting down",
      ));
    }
    state.retiring = None;
    let rt = create_runtime();
    let retirement = Arc::new(());
    let runtime = Arc::new(SharedTokioRuntime {
      runtime: Some(rt),
      retirement: Some(Arc::clone(&retirement)),
    });
    state.generation = Some(TokioRuntimeGeneration {
      runtime: Arc::clone(&runtime),
      retirement: Arc::clone(&retirement),
    });
    state.lifecycle = TokioRuntimeLifecycle::Running;
    Ok(TokioRuntimeLease {
      runtime,
      retirement,
    })
  }))
  .map_err(crate::bindgen_runtime::panic_to_error)
  .and_then(|result| result)
}

#[cfg(all(not(feature = "noop"), feature = "tokio_rt"))]
pub(crate) fn shutdown_tokio_runtime() -> Result<()> {
  let rt = std::panic::catch_unwind(AssertUnwindSafe(
    || -> Result<Option<TokioRuntimeGeneration>> {
      let mut state = TOKIO_RUNTIME_STATE
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
      match state.lifecycle {
        TokioRuntimeLifecycle::Uninitialized => {
          state.lifecycle = TokioRuntimeLifecycle::Stopped;
          return Ok(None);
        }
        TokioRuntimeLifecycle::Stopped => return Ok(None),
        TokioRuntimeLifecycle::Running => {}
      }
      let generation = state.generation.take();
      if let Some(generation) = &generation {
        state.retiring = Some(Arc::downgrade(&generation.retirement));
      }
      state.lifecycle = TokioRuntimeLifecycle::Stopped;
      Ok(generation)
    },
  ))
  .map_err(crate::bindgen_runtime::panic_to_error)
  .and_then(|result| result)?;

  drop(rt);
  let mut state = TOKIO_RUNTIME_STATE
    .lock()
    .unwrap_or_else(std::sync::PoisonError::into_inner);
  if state
    .retiring
    .as_ref()
    .is_some_and(|runtime| runtime.strong_count() == 0)
  {
    state.retiring = None;
  }
  Ok(())
}

/// The error returned when joining a [`JoinHandle`] whose task panicked or was cancelled.
///
/// This is napi's runtime-agnostic analogue of `tokio::task::JoinError`, produced by the
/// explicit [`spawn_on_custom_runtime`]/[`spawn_blocking_on_custom_runtime`] helpers.
#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
enum JoinErrorKind {
  Panic(SafeDrop<Box<dyn Any + Send + 'static>>),
  Cancelled,
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
pub struct JoinError {
  kind: JoinErrorKind,
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
impl JoinError {
  fn new_panic(panic_payload: Box<dyn Any + Send + 'static>) -> Self {
    Self {
      kind: JoinErrorKind::Panic(SafeDrop::new(panic_payload)),
    }
  }

  fn cancelled() -> Self {
    Self {
      kind: JoinErrorKind::Cancelled,
    }
  }

  /// Whether the task failed because it panicked.
  pub fn is_panic(&self) -> bool {
    matches!(self.kind, JoinErrorKind::Panic(_))
  }

  /// Whether the task was rejected or cancelled by the runtime.
  pub fn is_cancelled(&self) -> bool {
    matches!(self.kind, JoinErrorKind::Cancelled)
  }

  /// Consume the error, returning the panic payload the task panicked with.
  pub fn into_panic(self) -> Box<dyn Any + Send + 'static> {
    self
      .try_into_panic()
      .expect("JoinError does not contain a panic")
  }

  /// Consume the error, returning the panic payload when this error represents a panic.
  pub fn try_into_panic(self) -> std::result::Result<Box<dyn Any + Send + 'static>, Self> {
    match self.kind {
      JoinErrorKind::Panic(mut payload) => Ok(payload.take()),
      JoinErrorKind::Cancelled => Err(Self::cancelled()),
    }
  }
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
impl std::fmt::Debug for JoinError {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    match self.kind {
      JoinErrorKind::Panic(_) => f.write_str("JoinError::Panic(...)"),
      JoinErrorKind::Cancelled => f.write_str("JoinError::Cancelled"),
    }
  }
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
impl std::fmt::Display for JoinError {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    match self.kind {
      JoinErrorKind::Panic(_) => f.write_str("task panicked"),
      JoinErrorKind::Cancelled => f.write_str("task was cancelled"),
    }
  }
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
impl std::error::Error for JoinError {}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
struct JoinStateInner<T> {
  completed: bool,
  result: Option<std::result::Result<SafeDrop<T>, JoinError>>,
  waker: Option<Waker>,
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
impl<T> Drop for JoinStateInner<T> {
  fn drop(&mut self) {
    if let Some(waker) = self.waker.take() {
      drop_safely(waker);
    }
  }
}

/// Shared completion slot between a spawned task and its [`JoinHandle`]. The task wrapper
/// stores its output, panic payload, or cancellation here and wakes the handle.
#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
struct JoinState<T> {
  inner: Mutex<JoinStateInner<T>>,
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
impl<T> JoinState<T> {
  fn new() -> Self {
    Self {
      inner: Mutex::new(JoinStateInner {
        completed: false,
        result: None,
        waker: None,
      }),
    }
  }

  fn complete(&self, result: std::result::Result<T, JoinError>) {
    let result = result.map(SafeDrop::new);
    let waker = {
      let mut inner = self
        .inner
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
      if inner.completed {
        return;
      }
      inner.completed = true;
      inner.result = Some(result);
      inner.waker.take()
    };
    if let Some(waker) = waker {
      crate::bindgen_runtime::catch_unwind_safely(|| waker.wake());
    }
  }
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
struct CancelJoinOnDrop<T> {
  state: Arc<JoinState<T>>,
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
impl<T> Drop for CancelJoinOnDrop<T> {
  fn drop(&mut self) {
    self.state.complete(Err(JoinError::cancelled()));
  }
}

/// A napi-owned handle to a task spawned via [`spawn_on_custom_runtime`] or
/// [`spawn_blocking_on_custom_runtime`].
///
/// Await it to join the task: it resolves to the task's output, or to a [`JoinError`]
/// carrying the panic payload if the task panicked. Unlike `tokio::task::JoinHandle` it is
/// join-only — there is no `abort`; detach the task by dropping the handle. If the backend
/// rejects or drops the task, the handle resolves with a cancellation error.
#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
pub struct JoinHandle<T> {
  state: Arc<JoinState<T>>,
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
impl<T> Future for JoinHandle<T> {
  type Output = std::result::Result<T, JoinError>;

  fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output> {
    let new_waker = match std::panic::catch_unwind(AssertUnwindSafe(|| cx.waker().clone())) {
      Ok(waker) => waker,
      Err(reason) => {
        drop_safely(reason);
        let (result, replaced_waker) = {
          let mut inner = self
            .state
            .inner
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
          let result = if let Some(result) = inner.result.take() {
            result
          } else {
            inner.completed = true;
            Err(JoinError::cancelled())
          };
          (result, inner.waker.take())
        };
        if let Some(waker) = replaced_waker {
          drop_safely(waker);
        }
        return Poll::Ready(result.map(|mut value| value.take()));
      }
    };
    let (result, replaced_waker) = {
      let mut inner = self
        .state
        .inner
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
      if let Some(result) = inner.result.take() {
        (Some(result), Some(new_waker))
      } else {
        (None, inner.waker.replace(new_waker))
      }
    };
    if let Some(waker) = replaced_waker {
      drop_safely(waker);
    }
    match result {
      Some(result) => Poll::Ready(result.map(|mut value| value.take())),
      None => Poll::Pending,
    }
  }
}

#[cfg(all(not(feature = "noop"), feature = "tokio_rt"))]
/// Spawns a future onto the Tokio runtime.
///
/// Depending on where you use it, you should await or abort the future in your drop function.
/// To avoid undefined behavior and memory corruptions.
///
/// This remains Tokio-backed when `async-runtime` is also enabled. Use
/// `spawn_on_custom_runtime` for the registered custom backend.
pub fn spawn<F>(fut: F) -> tokio::task::JoinHandle<F::Output>
where
  F: 'static + Send + Future<Output = ()>,
{
  let mut fut = SafeDrop::new(fut);
  #[cfg(feature = "async-runtime")]
  let _runtime_use = acquire_synchronous_runtime_use().unwrap_or_else(|error| panic!("{error}"));
  let runtime = runtime();
  let retirement = runtime.retirement_token();
  runtime.spawn(async move {
    let _retirement = retirement;
    fut.take().await
  })
}

#[cfg(all(not(feature = "noop"), feature = "async-runtime"))]
/// Spawn a future onto the registered [`AsyncRuntime`] backend, returning a joinable
/// [`JoinHandle`].
///
/// The joinable-ness is manufactured by napi over [`spawn`](AsyncRuntime::spawn): the future
/// is wrapped so that its output — or, if it panics, the caught panic payload as a
/// [`JoinError`] — is handed to the returned handle. This name and routing are unchanged when
/// `tokio_rt` is also enabled; the Tokio-backed compatibility helper remains `spawn`.
pub fn spawn_on_custom_runtime<F>(fut: F) -> JoinHandle<F::Output>
where
  F: 'static + Send + Future,
  F::Output: 'static + Send,
{
  let state = Arc::new(JoinState::new());
  let task_state = state.clone();
  let cancellation_state = state.clone();
  let task = AsyncRuntimeTask::new(
    async move {
      let result = AssertUnwindSafe(fut).catch_unwind().await;
      task_state.complete(result.map_err(JoinError::new_panic));
      AsyncTaskOutcome::Completed
    },
    move |_error| cancellation_state.complete(Err(JoinError::cancelled())),
  );
  let Some(_submission) = RuntimeUsePermit::acquire() else {
    drop(task);
    return JoinHandle { state };
  };
  let runtime = match custom_async_runtime() {
    Ok(runtime) => runtime,
    Err(error) => {
      task.reject(error);
      return JoinHandle { state };
    }
  };
  match std::panic::catch_unwind(AssertUnwindSafe(|| runtime.spawn(task))) {
    Ok(Ok(())) => {}
    Ok(Err(task)) => task.reject(async_runtime_task_rejected_error()),
    Err(reason) => {
      drop(crate::bindgen_runtime::panic_to_error(reason));
    }
  }
  JoinHandle { state }
}

#[cfg(not(feature = "noop"))]
/// Runs a future to completion
/// This is blocking, meaning that it pauses other execution until the future is complete,
/// only use it when it is absolutely necessary, in other places use async functions instead.
/// This compatibility wrapper panics on runtime errors; exported N-API callbacks should prefer
/// [`try_block_on`] so the error can become a JavaScript exception.
pub fn block_on<F: Future>(fut: F) -> F::Output {
  try_block_on(fut).unwrap_or_else(|error| panic!("{error}"))
}

#[cfg(not(feature = "noop"))]
fn try_block_on_safely<F: Future>(
  fut: F,
  block_on: impl FnOnce(Pin<&mut dyn Future<Output = ()>>),
) -> Result<F::Output> {
  let mut future = SafeDrop::new(Box::pin(fut));
  let mut output = SafeDrop::new(None);
  std::panic::catch_unwind(AssertUnwindSafe(|| {
    let mut driver = std::pin::pin!(std::future::poll_fn(|cx| {
      if output.get_mut().is_some() {
        return Poll::Ready(());
      }
      match future.get_mut().as_mut().poll(cx) {
        Poll::Ready(value) => {
          *output.get_mut() = Some(value);
          Poll::Ready(())
        }
        Poll::Pending => Poll::Pending,
      }
    }));
    block_on(driver.as_mut());
  }))
  .map_err(crate::bindgen_runtime::panic_to_error)?;
  output.take().ok_or_else(|| {
    Error::new(
      crate::Status::GenericFailure,
      "Async runtime returned before the future completed",
    )
  })
}

#[cfg(not(feature = "noop"))]
/// Fallible form of [`block_on`].
///
/// This reports a missing backend, a backend panic, or a backend that returned before polling
/// the future to completion as a napi error. When `async-runtime` is enabled it also rejects calls
/// before startup, during lifecycle transitions, and after shutdown, and prevents shutdown from
/// overlapping the synchronous drive.
pub fn try_block_on<F: Future>(fut: F) -> Result<F::Output> {
  let mut fut = SafeDrop::new(fut);
  #[cfg(all(feature = "async-runtime", not(feature = "tokio_rt")))]
  {
    let runtime = custom_async_runtime()?;
    let _runtime_use = acquire_synchronous_runtime_use()?;
    try_block_on_safely(fut.take(), |future| runtime.block_on(future))
  }
  #[cfg(feature = "tokio_rt")]
  {
    #[cfg(feature = "async-runtime")]
    let _runtime_use = acquire_synchronous_runtime_use()?;
    let runtime = try_runtime()?;
    try_block_on_safely(fut.take(), |future| {
      runtime.block_on(future);
    })
  }
}

#[cfg(feature = "noop")]
/// Unavailable under the `noop` feature: calling this panics. (Other builds run the future to
/// completion, blocking the current thread until it resolves.)
pub fn block_on<F: Future>(_: F) -> F::Output {
  unreachable!("noop feature is enabled, block_on is not available")
}

#[cfg(all(not(feature = "noop"), feature = "tokio_rt"))]
/// spawn_blocking on the current Tokio runtime.
///
/// This remains Tokio-backed when `async-runtime` is also enabled. Use
/// `spawn_blocking_on_custom_runtime` for the registered custom backend.
pub fn spawn_blocking<F, R>(func: F) -> tokio::task::JoinHandle<R>
where
  F: FnOnce() -> R + Send + 'static,
  R: Send + 'static,
{
  let mut func = SafeDrop::new(func);
  #[cfg(feature = "async-runtime")]
  let _runtime_use = acquire_synchronous_runtime_use().unwrap_or_else(|error| panic!("{error}"));
  let runtime = runtime();
  let retirement = runtime.retirement_token();
  runtime.spawn_blocking(move || {
    let _retirement = retirement;
    func.take()()
  })
}

#[cfg(all(not(feature = "noop"), feature = "async-runtime"))]
/// Run blocking work through the registered [`AsyncRuntime`] backend, returning a joinable
/// [`JoinHandle`].
///
/// The closure — wrapped so that its output, or the caught panic payload as a [`JoinError`],
/// is handed to the returned handle — is offered to the backend's
/// [`spawn_blocking`](AsyncRuntime::spawn_blocking) hook. If the backend declines, the returned
/// handle completes with a cancellation error. napi never creates an unbounded fallback thread,
/// which keeps this API valid on threadless WebAssembly. This name and routing are unchanged
/// when `tokio_rt` is also enabled; the Tokio-backed compatibility helper remains
/// `spawn_blocking`.
pub fn spawn_blocking_on_custom_runtime<F, R>(func: F) -> JoinHandle<R>
where
  F: FnOnce() -> R + Send + 'static,
  R: Send + 'static,
{
  let state = Arc::new(JoinState::new());
  let task_state = state.clone();
  let rejection_state = state.clone();
  let cancel_on_drop = CancelJoinOnDrop {
    state: state.clone(),
  };
  let mut func = SafeDrop::new(func);
  let work: Box<dyn FnOnce() + Send + 'static> = Box::new(move || {
    let _cancel_on_drop = cancel_on_drop;
    let func = func.take();
    let result = std::panic::catch_unwind(AssertUnwindSafe(func));
    task_state.complete(result.map_err(JoinError::new_panic));
  });
  let Some(_submission) = RuntimeUsePermit::acquire() else {
    drop(work);
    return JoinHandle { state };
  };
  let result = custom_async_runtime().and_then(|runtime| {
    std::panic::catch_unwind(AssertUnwindSafe(|| runtime.spawn_blocking(work)))
      .map_err(crate::bindgen_runtime::panic_to_error)
      .and_then(|result| {
        result.map_err(|_| {
          Error::new(
            crate::Status::Cancelled,
            "The AsyncRuntime backend rejected a blocking task",
          )
        })
      })
  });
  match result {
    Ok(()) => {}
    Err(_) => rejection_state.complete(Err(JoinError::cancelled())),
  }
  JoinHandle { state }
}

// This function's signature must be kept in sync with the one in lib.rs, otherwise napi
// will fail to compile with the `tokio_rt` feature.
#[cfg(not(feature = "noop"))]
/// Enter the async runtime context for the duration of the provided closure, then call it.
///
/// A pure `async-runtime` build enters the registered backend. If `tokio_rt` is enabled,
/// including through feature unification, this established public helper enters Tokio.
/// Generated `#[napi(async_runtime)]` callbacks use the custom backend independently. With
/// `async-runtime` enabled, both entry paths hold the lifecycle open through guard destruction
/// and reject calls before startup, during lifecycle transitions, and after shutdown.
pub fn within_runtime_if_available<F: FnOnce() -> T, T>(f: F) -> T {
  try_within_runtime_if_available(f).unwrap_or_else(|error| panic!("{error}"))
}

#[cfg(not(feature = "noop"))]
/// Fallible form of [`within_runtime_if_available`].
pub fn try_within_runtime_if_available<F: FnOnce() -> T, T>(f: F) -> Result<T> {
  let mut f = SafeDrop::new(f);
  #[cfg(feature = "tokio_rt")]
  {
    #[cfg(feature = "async-runtime")]
    let _runtime_use = acquire_synchronous_runtime_use()?;
    let runtime = try_runtime()?;
    let runtime_guard = runtime.enter();
    call_with_runtime_guard(runtime_guard, f.take())
  }
  #[cfg(all(feature = "async-runtime", not(feature = "tokio_rt")))]
  {
    let runtime = custom_async_runtime()?;
    let _runtime_use = acquire_synchronous_runtime_use()?;
    let runtime_guard = std::panic::catch_unwind(AssertUnwindSafe(|| runtime.enter()))
      .map_err(crate::bindgen_runtime::panic_to_error)?;
    call_with_runtime_guard(runtime_guard, f.take())
  }
}

#[cfg(not(feature = "noop"))]
fn call_with_runtime_guard<G, F: FnOnce() -> T, T>(guard: G, f: F) -> Result<T> {
  let call_result = std::panic::catch_unwind(AssertUnwindSafe(f));
  let drop_result = std::panic::catch_unwind(AssertUnwindSafe(|| drop(guard)))
    .map_err(crate::bindgen_runtime::panic_to_error);
  match call_result {
    Ok(value) => match drop_result {
      Ok(()) => Ok(value),
      Err(error) => {
        crate::bindgen_runtime::catch_unwind_safely(|| drop(value));
        Err(error)
      }
    },
    Err(reason) => Err(crate::bindgen_runtime::panic_to_error(reason)),
  }
}

#[cfg(all(not(feature = "noop"), feature = "async-runtime"))]
#[doc(hidden)]
pub fn within_custom_runtime_if_available<F: FnOnce() -> Result<T>, T>(f: F) -> Result<T> {
  let mut f = SafeDrop::new(f);
  let runtime = custom_async_runtime()?;
  let _runtime_use = acquire_synchronous_runtime_use()?;
  let runtime_guard = std::panic::catch_unwind(AssertUnwindSafe(|| runtime.enter()))
    .map_err(crate::bindgen_runtime::panic_to_error)?;
  call_with_runtime_guard(runtime_guard, f.take()).and_then(|result| result)
}

#[cfg(all(not(feature = "noop"), not(feature = "async-runtime")))]
#[doc(hidden)]
pub fn within_custom_runtime_if_available<F: FnOnce() -> Result<T>, T>(f: F) -> Result<T> {
  let mut f = SafeDrop::new(f);
  #[cfg(feature = "tokio_rt")]
  {
    let runtime = try_runtime()?;
    let runtime_guard = runtime.enter();
    call_with_runtime_guard(runtime_guard, f.take()).and_then(|result| result)
  }
  #[cfg(not(feature = "tokio_rt"))]
  {
    f.take()()
  }
}

#[cfg(feature = "noop")]
pub fn within_runtime_if_available<F: FnOnce() -> T, T>(f: F) -> T {
  f()
}

#[cfg(feature = "noop")]
#[doc(hidden)]
pub fn within_custom_runtime_if_available<F: FnOnce() -> Result<T>, T>(f: F) -> Result<T> {
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
  let raw_env = env;
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
  let sendable_resolver = SendableResolver::new_for_env(raw_env, resolver);
  #[cfg(all(
    not(feature = "async-runtime"),
    any(
      all(target_family = "wasm", tokio_unstable),
      not(target_family = "wasm")
    )
  ))]
  let resolver_for_panic = sendable_resolver.clone_handle();

  #[cfg(feature = "async-runtime")]
  {
    let cancellation_deferred = deferred.clone();
    let cancellation_resolver = sendable_resolver.clone_handle();
    let task = env_async_task(
      raw_env,
      async move {
        match AssertUnwindSafe(fut).catch_unwind().await {
          Ok(Ok(v)) => deferred.resolve(move |env| {
            sendable_resolver
              .resolve(env.raw(), v)
              .map(|v| unsafe { Unknown::from_raw_unchecked(env.raw(), v) })
          }),
          Ok(Err(e)) => deferred.reject_with_cleanup(e.into(), move || {
            let _ = sendable_resolver.discard();
          }),
          Err(reason) => {
            let error = crate::bindgen_runtime::panic_to_error(reason);
            deferred.reject_with_cleanup(error, move || {
              let _ = sendable_resolver.discard();
            });
          }
        }
      },
      move |env_open, cancellation_error| {
        if env_open {
          cancellation_deferred.reject_with_cleanup(
            cancellation_error.unwrap_or_else(|| {
              Error::new(
                crate::Status::Cancelled,
                "Async task was cancelled because its runtime stopped",
              )
            }),
            move || {
              let _ = cancellation_resolver.discard();
            },
          );
        }
      },
    );
    submit_async_task(task);
  }

  #[cfg(not(feature = "async-runtime"))]
  let inner = async move {
    match fut.await {
      Ok(v) => deferred.resolve(move |env| {
        sendable_resolver
          .resolve(env.raw(), v)
          .map(|v| unsafe { Unknown::from_raw_unchecked(env.raw(), v) })
      }),
      Err(e) => deferred.reject_with_cleanup(e.into(), move || {
        let _ = sendable_resolver.discard();
      }),
    }
  };

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
        deferred_for_panic.reject_with_cleanup(
          crate::bindgen_runtime::panic_to_error(reason),
          move || {
            let _ = resolver_for_panic.discard();
          },
        );
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
  let raw_env = env;
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
  let sendable_resolver = SendableResolver::new_for_env(raw_env, resolver);
  #[cfg(all(
    not(feature = "async-runtime"),
    any(
      all(target_family = "wasm", tokio_unstable),
      not(target_family = "wasm")
    )
  ))]
  let resolver_for_panic = sendable_resolver.clone_handle();

  #[cfg(feature = "async-runtime")]
  {
    let cancellation_deferred = deferred.clone();
    let cancellation_resolver = sendable_resolver.clone_handle();
    let task = env_async_task(
      raw_env,
      async move {
        match AssertUnwindSafe(fut).catch_unwind().await {
          Ok(Ok(v)) => deferred.resolve(move |env| {
            sendable_resolver
              .resolve(env.raw(), v)
              .map(|v| unsafe { Unknown::from_raw_unchecked(env.raw(), v) })
          }),
          Ok(Err(e)) => deferred.reject_with_cleanup(e.into(), move || {
            let _ = sendable_resolver.discard();
          }),
          Err(reason) => {
            let error = crate::bindgen_runtime::panic_to_error(reason);
            deferred.reject_with_cleanup(error, move || {
              let _ = sendable_resolver.discard();
            });
          }
        }
      },
      move |env_open, cancellation_error| {
        if env_open {
          cancellation_deferred.reject_with_cleanup(
            cancellation_error.unwrap_or_else(|| {
              Error::new(
                crate::Status::Cancelled,
                "Async task was cancelled because its runtime stopped",
              )
            }),
            move || {
              let _ = cancellation_resolver.discard();
            },
          );
        }
      },
    );
    submit_async_task(task);
  }

  #[cfg(not(feature = "async-runtime"))]
  let inner = async move {
    match fut.await {
      Ok(v) => deferred.resolve(move |env| {
        sendable_resolver
          .resolve(env.raw(), v)
          .map(|v| unsafe { Unknown::from_raw_unchecked(env.raw(), v) })
      }),
      Err(e) => deferred.reject_with_cleanup(e.into(), move || {
        let _ = sendable_resolver.discard();
      }),
    }
  };

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
        deferred_for_panic.reject_with_cleanup(
          crate::bindgen_runtime::panic_to_error(reason),
          move || {
            let _ = resolver_for_panic.discard();
          },
        );
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

// These tests cover the explicit custom-runtime helpers in a pure `async-runtime` build.
#[cfg(all(
  test,
  not(feature = "noop"),
  feature = "async-runtime",
  not(feature = "tokio_rt")
))]
mod tests {
  use std::sync::{
    atomic::{AtomicBool, AtomicUsize, Ordering},
    mpsc, Arc, Mutex, MutexGuard,
  };
  use std::task::{RawWaker, RawWakerVTable};
  use std::time::Duration;

  use futures::task::ArcWake;

  use super::{
    spawn_blocking_on_custom_runtime as spawn_blocking, spawn_on_custom_runtime as spawn, *,
  };

  const BACKEND_WORKER_THREAD: &str = "inline-runtime-worker";
  const BACKEND_BLOCKING_THREAD: &str = "inline-runtime-blocking";

  static BACKEND_SPAWN_CALLS: AtomicUsize = AtomicUsize::new(0);
  static BACKEND_BLOCKING_CALLS: AtomicUsize = AtomicUsize::new(0);
  static BACKEND_START_CALLS: AtomicUsize = AtomicUsize::new(0);
  static BACKEND_SHUTDOWN_CALLS: AtomicUsize = AtomicUsize::new(0);
  static DECLINE_SPAWN: AtomicBool = AtomicBool::new(false);
  static DROP_SPAWN_TASK: AtomicBool = AtomicBool::new(false);
  static DECLINE_SPAWN_BLOCKING: AtomicBool = AtomicBool::new(false);
  static PANIC_SPAWN: AtomicBool = AtomicBool::new(false);
  static PANIC_ENTER: AtomicBool = AtomicBool::new(false);
  static PANIC_GUARD_DROP: AtomicBool = AtomicBool::new(false);
  static PANIC_BLOCK_ON: AtomicBool = AtomicBool::new(false);
  static PANIC_BLOCK_ON_AFTER_COMPLETION: AtomicBool = AtomicBool::new(false);
  static RETURN_BLOCK_ON_EARLY: AtomicBool = AtomicBool::new(false);
  static DROP_BLOCKING_WORK: AtomicBool = AtomicBool::new(false);
  static SHUTDOWN_DURING_SPAWN: AtomicBool = AtomicBool::new(false);
  static START_DURING_SHUTDOWN: AtomicBool = AtomicBool::new(false);
  static USE_SYNCHRONOUS_LIFECYCLE_HOOKS: AtomicBool = AtomicBool::new(false);
  static LIFECYCLE_REENTRY_ERROR: Mutex<Option<String>> = Mutex::new(None);
  static RUNTIME_STATE_TEST_LOCK: Mutex<()> = Mutex::new(());
  fn runtime_state_test_guard() -> MutexGuard<'static, ()> {
    let guard = RUNTIME_STATE_TEST_LOCK
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner);
    DECLINE_SPAWN.store(false, Ordering::SeqCst);
    DROP_SPAWN_TASK.store(false, Ordering::SeqCst);
    DECLINE_SPAWN_BLOCKING.store(false, Ordering::SeqCst);
    PANIC_SPAWN.store(false, Ordering::SeqCst);
    PANIC_ENTER.store(false, Ordering::SeqCst);
    PANIC_GUARD_DROP.store(false, Ordering::SeqCst);
    PANIC_BLOCK_ON.store(false, Ordering::SeqCst);
    PANIC_BLOCK_ON_AFTER_COMPLETION.store(false, Ordering::SeqCst);
    RETURN_BLOCK_ON_EARLY.store(false, Ordering::SeqCst);
    DROP_BLOCKING_WORK.store(false, Ordering::SeqCst);
    SHUTDOWN_DURING_SPAWN.store(false, Ordering::SeqCst);
    START_DURING_SHUTDOWN.store(false, Ordering::SeqCst);
    USE_SYNCHRONOUS_LIFECYCLE_HOOKS.store(false, Ordering::SeqCst);
    *LIFECYCLE_REENTRY_ERROR
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner) = None;
    open_runtime_submissions();
    if CUSTOM_ASYNC_RUNTIME.get().is_some() {
      try_start_async_runtime().unwrap();
    }
    guard
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

  struct InlineRuntimeGuard;

  impl AsyncRuntimeGuard for InlineRuntimeGuard {}

  impl Drop for InlineRuntimeGuard {
    fn drop(&mut self) {
      if PANIC_GUARD_DROP.load(Ordering::SeqCst) {
        panic!("backend guard drop panic");
      }
    }
  }

  impl AsyncRuntime for InlineRuntime {
    fn spawn(&self, task: AsyncRuntimeTask) -> std::result::Result<(), AsyncRuntimeTask> {
      if SHUTDOWN_DURING_SPAWN.load(Ordering::SeqCst) {
        let error = try_shutdown_async_runtime()
          .expect_err("shutdown from a submission hook must fail instead of deadlocking");
        *LIFECYCLE_REENTRY_ERROR
          .lock()
          .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(error.reason);
      }
      if PANIC_SPAWN.load(Ordering::SeqCst) {
        panic!("backend spawn panic");
      }
      if DECLINE_SPAWN.load(Ordering::SeqCst) {
        return Err(task);
      }
      if DROP_SPAWN_TASK.load(Ordering::SeqCst) {
        drop(task);
        return Ok(());
      }
      BACKEND_SPAWN_CALLS.fetch_add(1, Ordering::SeqCst);
      std::thread::Builder::new()
        .name(BACKEND_WORKER_THREAD.to_owned())
        .spawn(move || futures::executor::block_on(task))
        .expect("failed to spawn the InlineRuntime worker thread");
      Ok(())
    }

    fn start(&self) -> Result<()> {
      BACKEND_START_CALLS.fetch_add(1, Ordering::SeqCst);
      if USE_SYNCHRONOUS_LIFECYCLE_HOOKS.load(Ordering::SeqCst) {
        try_block_on(async {})?;
        within_custom_runtime_if_available(|| Ok(()))?;
      }
      Ok(())
    }

    fn shutdown(&self) -> Result<()> {
      BACKEND_SHUTDOWN_CALLS.fetch_add(1, Ordering::SeqCst);
      if START_DURING_SHUTDOWN.load(Ordering::SeqCst) {
        let error = try_start_async_runtime()
          .expect_err("start from a shutdown hook must fail instead of deadlocking");
        *LIFECYCLE_REENTRY_ERROR
          .lock()
          .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(error.reason);
      }
      if USE_SYNCHRONOUS_LIFECYCLE_HOOKS.load(Ordering::SeqCst) {
        try_block_on(async {})?;
        within_custom_runtime_if_available(|| Ok(()))?;
      }
      Ok(())
    }

    fn block_on(&self, future: Pin<&mut dyn Future<Output = ()>>) {
      if PANIC_BLOCK_ON.load(Ordering::SeqCst) {
        panic!("backend block_on panic");
      }
      if RETURN_BLOCK_ON_EARLY.load(Ordering::SeqCst) {
        return;
      }
      futures::executor::block_on(future);
      if PANIC_BLOCK_ON_AFTER_COMPLETION.load(Ordering::SeqCst) {
        panic!("backend block_on panic after completion");
      }
    }

    fn enter(&self) -> Box<dyn AsyncRuntimeGuard + '_> {
      if PANIC_ENTER.load(Ordering::SeqCst) {
        panic!("backend enter panic");
      }
      Box::new(InlineRuntimeGuard)
    }

    fn spawn_blocking(
      &self,
      work: Box<dyn FnOnce() + Send + 'static>,
    ) -> std::result::Result<(), Box<dyn FnOnce() + Send + 'static>> {
      if DECLINE_SPAWN_BLOCKING.load(Ordering::SeqCst) {
        return Err(work);
      }
      if DROP_BLOCKING_WORK.load(Ordering::SeqCst) {
        drop(work);
        return Ok(());
      }
      BACKEND_BLOCKING_CALLS.fetch_add(1, Ordering::SeqCst);
      std::thread::Builder::new()
        .name(BACKEND_BLOCKING_THREAD.to_owned())
        .spawn(work)
        .expect("failed to spawn the InlineRuntime blocking thread");
      Ok(())
    }
  }

  /// Registers `InlineRuntime` exactly once for the linked test image.
  fn ensure_runtime() {
    static REGISTER: std::sync::Once = std::sync::Once::new();
    REGISTER.call_once(|| create_custom_async_runtime(InlineRuntime));
  }

  #[test]
  fn custom_runtime_spawn_returns_joinable_handle() {
    ensure_runtime();
    let _guard = runtime_state_test_guard();
    let calls_before = BACKEND_SPAWN_CALLS.load(Ordering::SeqCst);

    let handle = spawn(async { 41 + 1 });
    let value = futures::executor::block_on(handle)
      .expect("the spawned task completed, so joining its handle must succeed");

    assert_eq!(value, 42);
    assert!(
      BACKEND_SPAWN_CALLS.load(Ordering::SeqCst) > calls_before,
      "`spawn_on_custom_runtime` must route through `AsyncRuntime::spawn`"
    );
  }

  #[test]
  fn custom_runtime_spawn_blocking_routes_to_backend() {
    ensure_runtime();
    let _guard = runtime_state_test_guard();
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
      "`spawn_blocking_on_custom_runtime` must route through `AsyncRuntime::spawn_blocking`"
    );
  }

  #[test]
  fn declined_spawn_blocking_completes_with_cancellation() {
    ensure_runtime();
    let _guard = runtime_state_test_guard();
    let calls_before = BACKEND_BLOCKING_CALLS.load(Ordering::SeqCst);
    let _decline = DeclineNextSpawnBlocking::arm();

    let handle = spawn_blocking(|| std::thread::current().name().map(str::to_owned));
    let error = futures::executor::block_on(handle)
      .expect_err("work declined by the backend must be reported as cancelled");

    assert!(error.is_cancelled());
    assert_eq!(
      BACKEND_BLOCKING_CALLS.load(Ordering::SeqCst),
      calls_before,
      "a declining backend must hand the closure back instead of running it"
    );
  }

  #[test]
  fn dropped_spawn_blocking_work_completes_with_cancellation() {
    ensure_runtime();
    let _guard = runtime_state_test_guard();
    DROP_BLOCKING_WORK.store(true, Ordering::SeqCst);
    let handle = spawn_blocking(|| 42);
    DROP_BLOCKING_WORK.store(false, Ordering::SeqCst);

    let error = futures::executor::block_on(handle)
      .expect_err("dropping accepted blocking work must cancel its join handle");
    assert!(error.is_cancelled());
  }

  #[test]
  fn spawn_join_error_carries_panic_payload() {
    ensure_runtime();
    let _guard = runtime_state_test_guard();

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
  fn rejected_spawn_completes_with_cancellation() {
    ensure_runtime();
    let _guard = runtime_state_test_guard();
    DECLINE_SPAWN.store(true, Ordering::SeqCst);
    let handle = spawn(async { 42 });
    DECLINE_SPAWN.store(false, Ordering::SeqCst);

    let error = futures::executor::block_on(handle)
      .expect_err("a rejected task must complete its join handle");
    assert!(error.is_cancelled());
  }

  #[test]
  fn rejected_generated_task_preserves_the_submission_error() {
    ensure_runtime();
    let _guard = runtime_state_test_guard();
    let env = 0x9876usize as sys::napi_env;
    register_async_runtime_env_tasks(env);
    let cancellation: Arc<Mutex<Option<(bool, Option<Error>)>>> = Arc::new(Mutex::new(None));
    let cancellation_result = Arc::clone(&cancellation);
    let task = env_async_task(env, std::future::pending(), move |env_open, error| {
      *cancellation_result
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner) = Some((env_open, error));
    });

    DECLINE_SPAWN.store(true, Ordering::SeqCst);
    submit_async_task(task);
    DECLINE_SPAWN.store(false, Ordering::SeqCst);

    let cancellation = cancellation
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner);
    let (env_open, error) = cancellation
      .as_ref()
      .expect("backend rejection must cancel the generated task");
    assert!(*env_open);
    assert!(
      error
        .as_ref()
        .is_some_and(|error| error.reason.contains("stopped or saturated")),
      "backend rejection must survive the cancellation path"
    );
    drop(cancellation);
    cancel_async_runtime_env_tasks(env);
  }

  #[test]
  fn panicking_spawn_backend_completes_with_cancellation() {
    ensure_runtime();
    let _guard = runtime_state_test_guard();
    PANIC_SPAWN.store(true, Ordering::SeqCst);
    let handle = spawn(async { 42 });
    PANIC_SPAWN.store(false, Ordering::SeqCst);

    let error = futures::executor::block_on(handle)
      .expect_err("a backend panic must cancel the submitted task");
    assert!(error.is_cancelled());
  }

  #[test]
  fn async_runtime_task_contains_unexpected_poll_panics() {
    let cancelled = Arc::new(AtomicBool::new(false));
    let cancelled_on_drop = Arc::clone(&cancelled);
    let task = AsyncRuntimeTask::new(
      std::future::poll_fn(|_| -> Poll<AsyncTaskOutcome> {
        panic!("unexpected task poll panic");
      }),
      move |_error| cancelled_on_drop.store(true, Ordering::SeqCst),
    );
    let mut task = Box::pin(task);
    let waker = futures::task::noop_waker();
    let mut context = Context::from_waker(&waker);

    assert_eq!(task.as_mut().poll(&mut context), Poll::Ready(()));
    assert!(cancelled.load(Ordering::SeqCst));
  }

  #[test]
  fn panicking_enter_backend_returns_an_error() {
    ensure_runtime();
    let _guard = runtime_state_test_guard();
    PANIC_ENTER.store(true, Ordering::SeqCst);
    let error = within_custom_runtime_if_available(|| Ok::<_, Error>(42))
      .expect_err("a backend enter panic must become a napi error");
    PANIC_ENTER.store(false, Ordering::SeqCst);

    assert!(error.reason.contains("backend enter panic"));
  }

  #[test]
  fn panicking_runtime_guard_drop_returns_an_error() {
    ensure_runtime();
    let _guard = runtime_state_test_guard();
    PANIC_GUARD_DROP.store(true, Ordering::SeqCst);
    let error = within_custom_runtime_if_available(|| Ok::<_, Error>(42))
      .expect_err("a guard destructor panic must become a napi error");
    PANIC_GUARD_DROP.store(false, Ordering::SeqCst);

    assert!(error.reason.contains("backend guard drop panic"));
  }

  #[test]
  fn closure_and_guard_panics_are_both_contained() {
    ensure_runtime();
    let _guard = runtime_state_test_guard();
    PANIC_GUARD_DROP.store(true, Ordering::SeqCst);
    let error = within_custom_runtime_if_available(|| -> Result<()> {
      panic!("runtime closure panic");
    })
    .expect_err("callback and guard panics must not escape");
    PANIC_GUARD_DROP.store(false, Ordering::SeqCst);

    assert!(error.reason.contains("runtime closure panic"));
  }

  #[test]
  fn panicking_block_on_backend_returns_an_error() {
    ensure_runtime();
    let _guard = runtime_state_test_guard();
    PANIC_BLOCK_ON.store(true, Ordering::SeqCst);
    let error = try_block_on(async { 42 }).expect_err("a backend panic must become a napi error");
    PANIC_BLOCK_ON.store(false, Ordering::SeqCst);

    assert!(error.reason.contains("backend block_on panic"));
  }

  #[test]
  fn early_block_on_return_is_an_error() {
    ensure_runtime();
    let _guard = runtime_state_test_guard();
    RETURN_BLOCK_ON_EARLY.store(true, Ordering::SeqCst);
    let error = try_block_on(async { 42 })
      .expect_err("returning before future completion must become a napi error");
    RETURN_BLOCK_ON_EARLY.store(false, Ordering::SeqCst);

    assert!(error.reason.contains("before the future completed"));
  }

  #[test]
  fn block_on_failure_contains_future_and_output_destructor_panics() {
    ensure_runtime();
    let _guard = runtime_state_test_guard();

    let panic_drops = Arc::new(AtomicUsize::new(0));
    let captured = PanicOnDrop {
      drops: Arc::clone(&panic_drops),
    };
    PANIC_BLOCK_ON.store(true, Ordering::SeqCst);
    let error = try_block_on(async move {
      drop(captured);
    })
    .expect_err("a backend panic must be reported");
    PANIC_BLOCK_ON.store(false, Ordering::SeqCst);
    assert!(error.reason.contains("backend block_on panic"));
    assert_eq!(panic_drops.load(Ordering::SeqCst), 1);

    let early_drops = Arc::new(AtomicUsize::new(0));
    let captured = PanicOnDrop {
      drops: Arc::clone(&early_drops),
    };
    RETURN_BLOCK_ON_EARLY.store(true, Ordering::SeqCst);
    let error = try_block_on(async move {
      drop(captured);
    })
    .expect_err("an early backend return must be reported");
    RETURN_BLOCK_ON_EARLY.store(false, Ordering::SeqCst);
    assert!(error.reason.contains("before the future completed"));
    assert_eq!(early_drops.load(Ordering::SeqCst), 1);

    let output_drops = Arc::new(AtomicUsize::new(0));
    PANIC_BLOCK_ON_AFTER_COMPLETION.store(true, Ordering::SeqCst);
    let error = try_block_on({
      let drops = Arc::clone(&output_drops);
      async move { PanicOnDrop { drops } }
    })
    .expect_err("a backend panic after completion must discard the output safely");
    PANIC_BLOCK_ON_AFTER_COMPLETION.store(false, Ordering::SeqCst);
    assert!(error.reason.contains("after completion"));
    assert_eq!(output_drops.load(Ordering::SeqCst), 1);

    try_shutdown_async_runtime().unwrap();
    let rejected_future_drops = Arc::new(AtomicUsize::new(0));
    let captured = PanicOnDrop {
      drops: Arc::clone(&rejected_future_drops),
    };
    let result = std::panic::catch_unwind(AssertUnwindSafe(|| {
      try_block_on(async move {
        drop(captured);
      })
    }));
    let error = result
      .expect("rejecting block_on must contain future destructor panics")
      .expect_err("a stopped runtime must reject block_on");
    assert!(error.reason.contains("not running"));
    assert_eq!(rejected_future_drops.load(Ordering::SeqCst), 1);

    let rejected_closure_drops = Arc::new(AtomicUsize::new(0));
    let captured = PanicOnDrop {
      drops: Arc::clone(&rejected_closure_drops),
    };
    let result = std::panic::catch_unwind(AssertUnwindSafe(|| {
      within_custom_runtime_if_available(move || {
        drop(captured);
        Ok(())
      })
    }));
    let error = result
      .expect("rejecting runtime entry must contain closure destructor panics")
      .expect_err("a stopped runtime must reject runtime entry");
    assert!(error.reason.contains("not running"));
    assert_eq!(rejected_closure_drops.load(Ordering::SeqCst), 1);
    try_start_async_runtime().unwrap();
  }

  #[test]
  fn join_completion_is_idempotent() {
    let state = Arc::new(JoinState::new());
    state.complete(Ok(42));
    state.complete(Err(JoinError::cancelled()));

    let value =
      futures::executor::block_on(JoinHandle { state }).expect("the first completion must win");
    assert_eq!(value, 42);
  }

  #[derive(Debug)]
  struct PanicOnDrop {
    drops: Arc<AtomicUsize>,
  }

  impl Drop for PanicOnDrop {
    fn drop(&mut self) {
      self.drops.fetch_add(1, Ordering::SeqCst);
      panic!("panic-on-drop");
    }
  }

  #[test]
  fn rejected_async_task_contains_captured_destructor_panics() {
    ensure_runtime();
    let _guard = runtime_state_test_guard();
    let drops = Arc::new(AtomicUsize::new(0));
    let captured = PanicOnDrop {
      drops: Arc::clone(&drops),
    };
    DECLINE_SPAWN.store(true, Ordering::SeqCst);

    let result = std::panic::catch_unwind(AssertUnwindSafe(|| {
      spawn(async move {
        drop(captured);
      })
    }));
    DECLINE_SPAWN.store(false, Ordering::SeqCst);

    let handle = result.expect("dropping a rejected task must contain destructor panics");
    let error = futures::executor::block_on(handle)
      .expect_err("the rejected task must complete as cancelled");
    assert!(error.is_cancelled());
    assert_eq!(drops.load(Ordering::SeqCst), 1);
  }

  #[test]
  fn dropped_accepted_async_task_contains_captured_destructor_panics() {
    ensure_runtime();
    let _guard = runtime_state_test_guard();
    let drops = Arc::new(AtomicUsize::new(0));
    let captured = PanicOnDrop {
      drops: Arc::clone(&drops),
    };
    DROP_SPAWN_TASK.store(true, Ordering::SeqCst);

    let result = std::panic::catch_unwind(AssertUnwindSafe(|| {
      spawn(async move {
        drop(captured);
      })
    }));
    DROP_SPAWN_TASK.store(false, Ordering::SeqCst);

    let handle = result.expect("dropping an accepted task must contain destructor panics");
    let error =
      futures::executor::block_on(handle).expect_err("the dropped task must complete as cancelled");
    assert!(error.is_cancelled());
    assert_eq!(drops.load(Ordering::SeqCst), 1);
  }

  #[test]
  fn dropped_blocking_work_contains_captured_destructor_panics() {
    ensure_runtime();
    let _guard = runtime_state_test_guard();
    let drops = Arc::new(AtomicUsize::new(0));
    let captured = PanicOnDrop {
      drops: Arc::clone(&drops),
    };
    DROP_BLOCKING_WORK.store(true, Ordering::SeqCst);

    let result = std::panic::catch_unwind(AssertUnwindSafe(|| {
      spawn_blocking(move || {
        drop(captured);
      })
    }));
    DROP_BLOCKING_WORK.store(false, Ordering::SeqCst);

    let handle = result.expect("dropping blocking work must contain destructor panics");
    let error = futures::executor::block_on(handle)
      .expect_err("the dropped blocking work must complete as cancelled");
    assert!(error.is_cancelled());
    assert_eq!(drops.load(Ordering::SeqCst), 1);
  }

  #[test]
  fn unawaited_join_output_contains_destructor_panics() {
    let drops = Arc::new(AtomicUsize::new(0));
    let state = Arc::new(JoinState::new());
    state.complete(Ok(PanicOnDrop {
      drops: Arc::clone(&drops),
    }));

    let result = std::panic::catch_unwind(AssertUnwindSafe(|| drop(JoinHandle { state })));

    result.expect("dropping an unawaited join output must contain destructor panics");
    assert_eq!(drops.load(Ordering::SeqCst), 1);
  }

  #[test]
  fn dropped_join_panic_payload_contains_destructor_panics() {
    let drops = Arc::new(AtomicUsize::new(0));
    let error = JoinError::new_panic(Box::new(PanicOnDrop {
      drops: Arc::clone(&drops),
    }));

    let result = std::panic::catch_unwind(AssertUnwindSafe(|| drop(error)));

    result.expect("dropping a panic payload must contain destructor panics");
    assert_eq!(drops.load(Ordering::SeqCst), 1);
  }

  #[test]
  fn custom_runtime_helpers_are_allowed_before_start_and_rejected_after_shutdown() {
    ensure_runtime();
    let _guard = runtime_state_test_guard();
    try_shutdown_async_runtime().unwrap();
    {
      let mut submissions = RUNTIME_SUBMISSIONS
        .0
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
      assert_eq!(submissions.in_flight, 0);
      submissions.state = RuntimeSubmissionState::NeverStarted;
    }
    let spawn_calls = BACKEND_SPAWN_CALLS.load(Ordering::SeqCst);
    let blocking_calls = BACKEND_BLOCKING_CALLS.load(Ordering::SeqCst);
    let shutdown_calls = BACKEND_SHUTDOWN_CALLS.load(Ordering::SeqCst);

    assert_eq!(
      futures::executor::block_on(spawn(async { 42 })).unwrap(),
      42
    );
    assert_eq!(
      futures::executor::block_on(spawn_blocking(|| 43)).unwrap(),
      43
    );
    assert_eq!(BACKEND_SPAWN_CALLS.load(Ordering::SeqCst), spawn_calls + 1);
    assert_eq!(
      BACKEND_BLOCKING_CALLS.load(Ordering::SeqCst),
      blocking_calls + 1
    );
    assert!(
      try_block_on(async {}).is_err(),
      "synchronous block_on must wait until the backend has started"
    );
    assert!(
      within_custom_runtime_if_available(|| Ok::<_, Error>(())).is_err(),
      "custom runtime entry must wait until the backend has started"
    );

    try_shutdown_async_runtime().unwrap();
    assert_eq!(
      BACKEND_SHUTDOWN_CALLS.load(Ordering::SeqCst),
      shutdown_calls + 1,
      "explicit shutdown must clean up work accepted before the backend starts"
    );
    assert!(futures::executor::block_on(spawn(async { 44 }))
      .unwrap_err()
      .is_cancelled());
    assert!(futures::executor::block_on(spawn_blocking(|| 45))
      .unwrap_err()
      .is_cancelled());
    assert_eq!(BACKEND_SPAWN_CALLS.load(Ordering::SeqCst), spawn_calls + 1);
    assert_eq!(
      BACKEND_BLOCKING_CALLS.load(Ordering::SeqCst),
      blocking_calls + 1
    );
    try_start_async_runtime().unwrap();
  }

  #[test]
  fn guard_drop_failure_contains_the_success_value_destructor() {
    let _guard = runtime_state_test_guard();
    let drops = Arc::new(AtomicUsize::new(0));
    PANIC_GUARD_DROP.store(true, Ordering::SeqCst);

    let error = call_with_runtime_guard(InlineRuntimeGuard, || PanicOnDrop {
      drops: Arc::clone(&drops),
    })
    .expect_err("a guard destructor panic must discard the callback result safely");

    PANIC_GUARD_DROP.store(false, Ordering::SeqCst);
    assert!(error.reason.contains("backend guard drop panic"));
    assert_eq!(drops.load(Ordering::SeqCst), 1);
  }

  #[test]
  fn environment_lifecycle_is_reference_counted() {
    ensure_runtime();
    let _guard = runtime_state_test_guard();
    try_shutdown_async_runtime().unwrap();
    let starts_before = BACKEND_START_CALLS.load(Ordering::SeqCst);
    let shutdowns_before = BACKEND_SHUTDOWN_CALLS.load(Ordering::SeqCst);

    register_async_runtime_env().unwrap();
    register_async_runtime_env().unwrap();
    assert_eq!(
      BACKEND_START_CALLS.load(Ordering::SeqCst),
      starts_before + 1
    );

    unregister_async_runtime_env().unwrap();
    assert_eq!(
      BACKEND_SHUTDOWN_CALLS.load(Ordering::SeqCst),
      shutdowns_before
    );

    unregister_async_runtime_env().unwrap();
    assert_eq!(
      BACKEND_SHUTDOWN_CALLS.load(Ordering::SeqCst),
      shutdowns_before + 1
    );
    open_runtime_submissions();
  }

  #[test]
  fn shutdown_waits_for_in_flight_task_submission() {
    let _guard = runtime_state_test_guard();
    let submission =
      RuntimeUsePermit::acquire().expect("submission gate must be open for the test");
    let (started_tx, started_rx) = mpsc::channel();
    let (done_tx, done_rx) = mpsc::channel();
    let shutdown = std::thread::spawn(move || {
      started_tx.send(()).unwrap();
      let result = close_runtime_submissions();
      done_tx.send(result).unwrap();
    });
    started_rx.recv().unwrap();

    assert!(
      done_rx.recv_timeout(Duration::from_millis(50)).is_err(),
      "shutdown must wait until the backend has returned from task acceptance"
    );
    drop(submission);
    done_rx
      .recv_timeout(Duration::from_secs(1))
      .expect("shutdown must resume after task acceptance finishes")
      .unwrap();
    shutdown.join().unwrap();
    open_runtime_submissions();
  }

  #[test]
  fn shutdown_waits_for_synchronous_custom_runtime_use() {
    ensure_runtime();
    let _guard = runtime_state_test_guard();
    try_start_async_runtime().unwrap();
    let (entered_tx, entered_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel();
    let runtime_use = std::thread::spawn(move || {
      within_custom_runtime_if_available(|| {
        entered_tx.send(()).unwrap();
        release_rx.recv().unwrap();
        Ok(())
      })
    });
    entered_rx
      .recv_timeout(Duration::from_secs(1))
      .expect("the synchronous runtime operation must start");

    let (done_tx, done_rx) = mpsc::channel();
    let shutdown = std::thread::spawn(move || {
      done_tx.send(try_shutdown_async_runtime()).unwrap();
    });
    assert!(
      done_rx.recv_timeout(Duration::from_millis(50)).is_err(),
      "shutdown must wait for the runtime guard and callback to finish"
    );

    release_tx.send(()).unwrap();
    runtime_use.join().unwrap().unwrap();
    done_rx
      .recv_timeout(Duration::from_secs(1))
      .expect("shutdown must resume after synchronous runtime use finishes")
      .unwrap();
    shutdown.join().unwrap();
    try_start_async_runtime().unwrap();
  }

  #[test]
  fn synchronous_custom_runtime_use_rejects_reentrant_shutdown_and_stopped_access() {
    ensure_runtime();
    let _guard = runtime_state_test_guard();
    try_start_async_runtime().unwrap();

    let error = within_custom_runtime_if_available(|| {
      Ok::<_, Error>(
        try_shutdown_async_runtime()
          .expect_err("shutdown from an entered runtime context must not tear down its guard")
          .reason,
      )
    })
    .unwrap();
    assert!(error.contains("inside an AsyncRuntime operation"));

    try_shutdown_async_runtime().unwrap();
    let error =
      try_block_on(async {}).expect_err("block_on must not drive a stopped custom runtime");
    assert!(error.reason.contains("not running"));
    let error = within_custom_runtime_if_available(|| Ok::<_, Error>(()))
      .expect_err("runtime entry must not call a stopped custom backend");
    assert!(error.reason.contains("not running"));
    try_start_async_runtime().unwrap();
  }

  #[test]
  fn lifecycle_hooks_can_use_synchronous_custom_runtime_operations() {
    ensure_runtime();
    let _guard = runtime_state_test_guard();
    try_start_async_runtime().unwrap();
    USE_SYNCHRONOUS_LIFECYCLE_HOOKS.store(true, Ordering::SeqCst);

    try_shutdown_async_runtime().unwrap();
    try_start_async_runtime().unwrap();

    USE_SYNCHRONOUS_LIFECYCLE_HOOKS.store(false, Ordering::SeqCst);
  }

  #[test]
  fn reentrant_shutdown_during_task_submission_returns_an_error() {
    let _guard = runtime_state_test_guard();
    let submission =
      RuntimeUsePermit::acquire().expect("submission gate must be open for the test");

    let error =
      close_runtime_submissions().expect_err("reentrant shutdown must fail instead of deadlocking");

    assert!(error.reason.contains("inside an AsyncRuntime operation"));
    drop(submission);
    close_runtime_submissions().unwrap();
    open_runtime_submissions();
  }

  #[test]
  fn backend_submission_cannot_deadlock_runtime_shutdown() {
    ensure_runtime();
    let _guard = runtime_state_test_guard();
    try_start_async_runtime().unwrap();
    SHUTDOWN_DURING_SPAWN.store(true, Ordering::SeqCst);

    futures::executor::block_on(spawn(async {})).unwrap();

    let error = LIFECYCLE_REENTRY_ERROR
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner)
      .take()
      .expect("the backend must observe a lifecycle error");
    assert!(error.contains("inside an AsyncRuntime operation"));
    try_shutdown_async_runtime().unwrap();
    open_runtime_submissions();
  }

  #[test]
  fn backend_lifecycle_hook_cannot_reenter_lifecycle_transition() {
    ensure_runtime();
    let _guard = runtime_state_test_guard();
    try_start_async_runtime().unwrap();
    START_DURING_SHUTDOWN.store(true, Ordering::SeqCst);

    try_shutdown_async_runtime().unwrap();

    let error = LIFECYCLE_REENTRY_ERROR
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner)
      .take()
      .expect("the backend must observe a lifecycle error");
    assert!(error.contains("cannot wait recursively"));
    open_runtime_submissions();
  }

  #[test]
  fn submission_hook_does_not_wait_for_concurrent_lifecycle_transition() {
    let _guard = runtime_state_test_guard();
    let submission =
      RuntimeUsePermit::acquire().expect("submission gate must be open for the test");
    let previous_state = {
      let mut lifecycle = runtime_lifecycle();
      let previous = lifecycle.state;
      lifecycle.state = RuntimeLifecycleState::Stopping;
      previous
    };

    let error = match wait_for_runtime_transition(runtime_lifecycle()) {
      Ok(_) => panic!("a submission hook must not wait on the transition that is waiting for it"),
      Err(error) => error,
    };

    {
      let mut lifecycle = runtime_lifecycle();
      lifecycle.state = previous_state;
      RUNTIME_LIFECYCLE.1.notify_all();
    }
    drop(submission);
    assert!(error.reason.contains("runtime hook"));
  }

  #[test]
  fn synchronous_runtime_use_rejects_a_transition_before_the_gate_closes() {
    let _guard = runtime_state_test_guard();
    let previous_state = {
      let mut lifecycle = runtime_lifecycle();
      let previous = lifecycle.state;
      lifecycle.state = RuntimeLifecycleState::Starting;
      previous
    };

    let rejected = RuntimeUsePermit::acquire_synchronous().is_none();

    let mut lifecycle = runtime_lifecycle();
    lifecycle.state = previous_state;
    RUNTIME_LIFECYCLE.1.notify_all();
    drop(lifecycle);
    assert!(
      rejected,
      "external synchronous work must reject as soon as a transition starts"
    );
  }

  struct EnvTasksLockProbe {
    lock_was_available: AtomicBool,
  }

  impl ArcWake for EnvTasksLockProbe {
    fn wake_by_ref(arc_self: &Arc<Self>) {
      arc_self.lock_was_available.store(
        ENV_TASKS.try_lock().is_ok(),
        std::sync::atomic::Ordering::SeqCst,
      );
    }
  }

  struct AbortHandlesLockProbe {
    tasks: Arc<EnvTasks>,
    lock_was_available: AtomicBool,
  }

  impl ArcWake for AbortHandlesLockProbe {
    fn wake_by_ref(arc_self: &Arc<Self>) {
      arc_self.lock_was_available.store(
        arc_self.tasks.abort_handles.try_lock().is_ok(),
        std::sync::atomic::Ordering::SeqCst,
      );
    }
  }

  fn poll_pending_env_task(
    env: sys::napi_env,
    probe: &Arc<EnvTasksLockProbe>,
  ) -> Pin<Box<AsyncRuntimeTask>> {
    let mut task = Box::pin(env_async_task(env, std::future::pending(), |_, _| {}));
    let waker = futures::task::waker(Arc::clone(probe));
    let mut context = Context::from_waker(&waker);
    assert!(task.as_mut().poll(&mut context).is_pending());
    task
  }

  #[test]
  fn environment_task_cancellation_wakes_without_global_registry_lock() {
    let _guard = runtime_state_test_guard();

    let replacement_env = 0x1111usize as sys::napi_env;
    register_async_runtime_env_tasks(replacement_env);
    let replacement_probe = Arc::new(EnvTasksLockProbe {
      lock_was_available: AtomicBool::new(false),
    });
    let replacement_task = poll_pending_env_task(replacement_env, &replacement_probe);
    register_async_runtime_env_tasks(replacement_env);
    assert!(replacement_probe.lock_was_available.load(Ordering::SeqCst));
    drop(replacement_task);
    cancel_async_runtime_env_tasks(replacement_env);

    let removed_env = 0x2222usize as sys::napi_env;
    register_async_runtime_env_tasks(removed_env);
    let removed_probe = Arc::new(EnvTasksLockProbe {
      lock_was_available: AtomicBool::new(false),
    });
    let removed_task = poll_pending_env_task(removed_env, &removed_probe);
    cancel_async_runtime_env_tasks(removed_env);
    assert!(removed_probe.lock_was_available.load(Ordering::SeqCst));
    drop(removed_task);

    let shutdown_env = 0x3333usize as sys::napi_env;
    register_async_runtime_env_tasks(shutdown_env);
    let shutdown_probe = Arc::new(EnvTasksLockProbe {
      lock_was_available: AtomicBool::new(false),
    });
    let shutdown_task = poll_pending_env_task(shutdown_env, &shutdown_probe);
    cancel_all_env_tasks();
    assert!(shutdown_probe.lock_was_available.load(Ordering::SeqCst));
    drop(shutdown_task);
    cancel_async_runtime_env_tasks(shutdown_env);
  }

  #[test]
  fn close_race_aborts_without_environment_task_lock() {
    let tasks = Arc::new(EnvTasks::new());
    let (abort_handle, abort_registration) = AbortHandle::new_pair();
    let id = tasks.next_id.fetch_add(1, Ordering::Relaxed);
    tasks
      .abort_handles
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner)
      .insert(id, abort_handle);

    let probe = Arc::new(AbortHandlesLockProbe {
      tasks: Arc::clone(&tasks),
      lock_was_available: AtomicBool::new(false),
    });
    let mut future = Box::pin(Abortable::new(
      std::future::pending::<()>(),
      abort_registration,
    ));
    let waker = futures::task::waker(Arc::clone(&probe));
    let mut context = Context::from_waker(&waker);
    assert!(future.as_mut().poll(&mut context).is_pending());

    if let Some(abort_handle) = tasks.take_abort_handle(id) {
      abort_safely(abort_handle);
    }

    assert!(probe.lock_was_available.load(Ordering::SeqCst));
    assert!(future.as_mut().poll(&mut context).is_ready());
  }

  #[test]
  fn environment_cancellation_wakes_pending_tasks_without_js_callback() {
    let env = 0x1234usize as sys::napi_env;
    register_async_runtime_env_tasks(env);
    let cancellation = Arc::new(Mutex::new(None));
    let cancellation_result = Arc::clone(&cancellation);
    let mut task = Box::pin(env_async_task(
      env,
      std::future::pending(),
      move |env_open, error| {
        *cancellation_result.lock().unwrap() = Some((env_open, error));
      },
    ));
    let waker = futures::task::noop_waker();
    let mut context = Context::from_waker(&waker);

    assert!(task.as_mut().poll(&mut context).is_pending());
    cancel_async_runtime_env_tasks(env);
    assert!(task.as_mut().poll(&mut context).is_ready());
    let cancellation = cancellation.lock().unwrap();
    assert_eq!(
      cancellation.as_ref().map(|(env_open, _)| *env_open),
      Some(false)
    );
    assert!(cancellation.as_ref().unwrap().1.is_none());
  }

  #[test]
  fn runtime_shutdown_cancels_pending_tasks_with_environment_still_open() {
    let env = 0x5678usize as sys::napi_env;
    register_async_runtime_env_tasks(env);
    let cancellation = Arc::new(Mutex::new(None));
    let cancellation_result = Arc::clone(&cancellation);
    let mut task = Box::pin(env_async_task(
      env,
      std::future::pending(),
      move |env_open, error| {
        *cancellation_result.lock().unwrap() = Some((env_open, error));
      },
    ));
    let waker = futures::task::noop_waker();
    let mut context = Context::from_waker(&waker);

    assert!(task.as_mut().poll(&mut context).is_pending());
    cancel_all_env_tasks();
    assert!(task.as_mut().poll(&mut context).is_ready());
    let cancellation = cancellation.lock().unwrap();
    assert_eq!(
      cancellation.as_ref().map(|(env_open, _)| *env_open),
      Some(true)
    );
    assert!(cancellation.as_ref().unwrap().1.is_none());
    drop(cancellation);
    cancel_async_runtime_env_tasks(env);
  }

  struct PanickingWaker;

  impl ArcWake for PanickingWaker {
    fn wake_by_ref(_arc_self: &Arc<Self>) {
      panic!("backend waker panic");
    }
  }

  #[test]
  fn task_abort_contains_backend_waker_panics() {
    let (abort_handle, abort_registration) = AbortHandle::new_pair();
    let mut future = Box::pin(Abortable::new(
      std::future::pending::<()>(),
      abort_registration,
    ));
    let waker = futures::task::waker(Arc::new(PanickingWaker));
    let mut context = Context::from_waker(&waker);
    assert!(future.as_mut().poll(&mut context).is_pending());

    abort_safely(abort_handle);

    assert!(future.as_mut().poll(&mut context).is_ready());
  }

  #[test]
  fn join_completion_contains_consumer_waker_panics() {
    let state = Arc::new(JoinState::new());
    let mut handle = Box::pin(JoinHandle {
      state: Arc::clone(&state),
    });
    let waker = futures::task::waker(Arc::new(PanickingWaker));
    let mut context = Context::from_waker(&waker);
    assert!(handle.as_mut().poll(&mut context).is_pending());

    state.complete(Ok(42));

    let waker = futures::task::noop_waker();
    let mut context = Context::from_waker(&waker);
    match handle.as_mut().poll(&mut context) {
      Poll::Ready(Ok(value)) => assert_eq!(value, 42),
      result => panic!("completed join returned an unexpected result: {result:?}"),
    }
  }

  unsafe fn clone_panics(_: *const ()) -> RawWaker {
    panic!("consumer waker clone panic");
  }

  unsafe fn clone_waker(data: *const ()) -> RawWaker {
    RawWaker::new(data, &DROP_PANICS_WAKER_VTABLE)
  }

  unsafe fn noop_waker(_: *const ()) {}

  unsafe fn drop_panics(_: *const ()) {
    panic!("consumer waker drop panic");
  }

  static CLONE_PANICS_WAKER_VTABLE: RawWakerVTable =
    RawWakerVTable::new(clone_panics, noop_waker, noop_waker, noop_waker);
  static DROP_PANICS_WAKER_VTABLE: RawWakerVTable =
    RawWakerVTable::new(clone_waker, noop_waker, noop_waker, drop_panics);

  #[test]
  fn join_poll_contains_consumer_waker_clone_panics() {
    let state = Arc::new(JoinState::<()>::new());
    let mut handle = Box::pin(JoinHandle { state });
    let waker =
      unsafe { Waker::from_raw(RawWaker::new(std::ptr::null(), &CLONE_PANICS_WAKER_VTABLE)) };
    let mut context = Context::from_waker(&waker);

    let result = handle.as_mut().poll(&mut context);

    assert!(matches!(result, Poll::Ready(Err(error)) if error.is_cancelled()));
  }

  #[test]
  fn join_poll_contains_replaced_consumer_waker_drop_panics() {
    let state = Arc::new(JoinState::<()>::new());
    let mut handle = Box::pin(JoinHandle { state });
    let waker = std::mem::ManuallyDrop::new(unsafe {
      Waker::from_raw(RawWaker::new(std::ptr::null(), &DROP_PANICS_WAKER_VTABLE))
    });
    let mut context = Context::from_waker(&waker);
    assert!(handle.as_mut().poll(&mut context).is_pending());

    let replacement = futures::task::noop_waker();
    let mut replacement_context = Context::from_waker(&replacement);
    assert!(handle.as_mut().poll(&mut replacement_context).is_pending());
  }

  #[test]
  fn dropping_a_pending_join_contains_consumer_waker_drop_panics() {
    let state = Arc::new(JoinState::<()>::new());
    let mut handle = Box::pin(JoinHandle { state });
    let waker = std::mem::ManuallyDrop::new(unsafe {
      Waker::from_raw(RawWaker::new(std::ptr::null(), &DROP_PANICS_WAKER_VTABLE))
    });
    let mut context = Context::from_waker(&waker);
    assert!(handle.as_mut().poll(&mut context).is_pending());

    drop(handle);
  }

  #[test]
  fn spawn_blocking_join_error_carries_panic_payload() {
    ensure_runtime();
    let _guard = runtime_state_test_guard();

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

#[cfg(all(
  test,
  not(feature = "noop"),
  feature = "async-runtime",
  feature = "tokio_rt"
))]
mod combined_feature_tests {
  use std::sync::{
    atomic::{AtomicBool, AtomicUsize, Ordering},
    mpsc, Arc, Condvar, Mutex, Once,
  };
  use std::time::Duration;

  use super::*;

  struct CombinedRuntime;

  static CUSTOM_RUNNING: AtomicBool = AtomicBool::new(false);
  static FAIL_CUSTOM_START: AtomicBool = AtomicBool::new(false);
  static CUSTOM_STARTS: AtomicUsize = AtomicUsize::new(0);
  static CUSTOM_SHUTDOWNS: AtomicUsize = AtomicUsize::new(0);
  static START_BLOCK: (Mutex<(bool, bool, bool)>, Condvar) =
    (Mutex::new((false, false, false)), Condvar::new());
  static SHUTDOWN_BLOCK: (Mutex<(bool, bool, bool)>, Condvar) =
    (Mutex::new((false, false, false)), Condvar::new());

  struct DropProbe(Arc<AtomicBool>);

  impl Drop for DropProbe {
    fn drop(&mut self) {
      self.0.store(true, Ordering::SeqCst);
    }
  }

  struct PanicOnDropProbe(Arc<AtomicUsize>);

  impl Drop for PanicOnDropProbe {
    fn drop(&mut self) {
      self.0.fetch_add(1, Ordering::SeqCst);
      panic!("combined helper captured destructor panic");
    }
  }

  #[test]
  fn retirement_spawn_failure_does_not_drop_on_the_teardown_thread() {
    let dropped = Arc::new(AtomicBool::new(false));
    let probe = DropProbe(Arc::clone(&dropped));

    launch_background_drop(probe, |worker| {
      drop(worker);
      Err(std::io::Error::other("injected thread creation failure"))
    });

    assert!(!dropped.load(Ordering::SeqCst));
  }

  impl AsyncRuntime for CombinedRuntime {
    fn spawn(&self, task: AsyncRuntimeTask) -> std::result::Result<(), AsyncRuntimeTask> {
      std::thread::spawn(move || futures::executor::block_on(task));
      Ok(())
    }

    fn spawn_blocking(
      &self,
      work: Box<dyn FnOnce() + Send + 'static>,
    ) -> std::result::Result<(), Box<dyn FnOnce() + Send + 'static>> {
      std::thread::Builder::new()
        .name("combined-custom-runtime-blocking".to_owned())
        .spawn(work)
        .expect("failed to spawn the combined custom runtime blocking thread");
      Ok(())
    }

    fn block_on(&self, future: Pin<&mut dyn Future<Output = ()>>) {
      futures::executor::block_on(future);
    }

    fn start(&self) -> Result<()> {
      CUSTOM_STARTS.fetch_add(1, Ordering::SeqCst);
      if FAIL_CUSTOM_START.load(Ordering::SeqCst) {
        return Err(Error::new(
          crate::Status::GenericFailure,
          "injected custom runtime start failure",
        ));
      }
      let mut block = START_BLOCK
        .0
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
      if block.0 {
        block.1 = true;
        START_BLOCK.1.notify_all();
        while !block.2 {
          block = START_BLOCK
            .1
            .wait(block)
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        }
        *block = (false, false, false);
      }
      try_block_on(async {}).expect("custom start hook must be able to use its Tokio peer");
      CUSTOM_RUNNING.store(true, Ordering::SeqCst);
      Ok(())
    }

    fn shutdown(&self) -> Result<()> {
      CUSTOM_SHUTDOWNS.fetch_add(1, Ordering::SeqCst);
      let mut block = SHUTDOWN_BLOCK
        .0
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
      if block.0 {
        block.1 = true;
        SHUTDOWN_BLOCK.1.notify_all();
        while !block.2 {
          block = SHUTDOWN_BLOCK
            .1
            .wait(block)
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        }
        *block = (false, false, false);
      }
      try_within_runtime_if_available(|| ())
        .expect("custom shutdown hook must be able to use its Tokio peer");
      CUSTOM_RUNNING.store(false, Ordering::SeqCst);
      Ok(())
    }
  }

  fn ensure_runtime() {
    static REGISTER: Once = Once::new();
    REGISTER.call_once(|| try_create_custom_async_runtime(CombinedRuntime).unwrap());
  }

  fn run_with_timeout(f: impl FnOnce() -> Result<()> + Send + 'static) -> Result<()> {
    let (done_tx, done_rx) = mpsc::channel();
    let thread = std::thread::spawn(move || {
      done_tx.send(f()).unwrap();
    });
    let result = done_rx
      .recv_timeout(Duration::from_secs(5))
      .expect("runtime operation deadlocked");
    thread.join().unwrap();
    result
  }

  fn start_after_retirement() {
    let deadline = std::time::Instant::now() + Duration::from_secs(5);
    loop {
      match try_start_async_runtime() {
        Ok(()) => return,
        Err(error)
          if error.reason.contains("still shutting down")
            && std::time::Instant::now() < deadline =>
        {
          std::thread::sleep(Duration::from_millis(10));
        }
        Err(error) => panic!("runtime did not retire cleanly: {error}"),
      }
    }
  }

  fn wait_for_retirement() {
    let deadline = std::time::Instant::now() + Duration::from_secs(5);
    loop {
      let retired = TOKIO_RUNTIME_STATE
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .retiring
        .as_ref()
        .and_then(Weak::upgrade)
        .is_none();
      if retired {
        return;
      }
      assert!(
        std::time::Instant::now() < deadline,
        "Tokio runtime did not retire cleanly"
      );
      std::thread::sleep(Duration::from_millis(10));
    }
  }

  #[test]
  fn combined_runtime_lifecycle_is_atomic_and_does_not_hold_tokio_locks_over_user_code() {
    ensure_runtime();
    try_start_async_runtime().unwrap();
    assert!(CUSTOM_RUNNING.load(Ordering::SeqCst));

    let custom_handle: JoinHandle<u8> = spawn_on_custom_runtime(async { 42 });
    assert_eq!(futures::executor::block_on(custom_handle).unwrap(), 42);
    let custom_blocking_handle: JoinHandle<Option<String>> =
      spawn_blocking_on_custom_runtime(|| std::thread::current().name().map(str::to_owned));
    assert_eq!(
      futures::executor::block_on(custom_blocking_handle)
        .unwrap()
        .as_deref(),
      Some("combined-custom-runtime-blocking")
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
      .expect("combined synchronous runtime use must start");
    let (shutdown_done_tx, shutdown_done_rx) = mpsc::channel();
    let shutdown = std::thread::spawn(move || {
      shutdown_done_tx.send(try_shutdown_async_runtime()).unwrap();
    });
    assert!(
      shutdown_done_rx
        .recv_timeout(Duration::from_millis(50))
        .is_err(),
      "combined shutdown must wait for admitted synchronous Tokio use"
    );
    release_tx.send(()).unwrap();
    runtime_use.join().unwrap().unwrap();
    shutdown_done_rx
      .recv_timeout(Duration::from_secs(5))
      .expect("combined shutdown must resume after synchronous Tokio use")
      .unwrap();
    shutdown.join().unwrap();
    start_after_retirement();

    let handle: tokio::task::JoinHandle<()> = spawn(async {});
    block_on(async {
      handle.await.expect("Tokio task must complete");
    });

    let (blocking_started_tx, blocking_started_rx) = mpsc::channel();
    let (blocking_release_tx, blocking_release_rx) = mpsc::channel();
    let blocking = spawn_blocking(move || {
      blocking_started_tx.send(()).unwrap();
      blocking_release_rx.recv().unwrap();
    });
    blocking_started_rx
      .recv_timeout(Duration::from_secs(5))
      .expect("blocking task must start");
    try_shutdown_async_runtime().unwrap();
    let error =
      try_start_async_runtime().expect_err("restart must wait for old-generation blocking work");
    assert!(error.reason.contains("still shutting down"));
    blocking_release_tx.send(()).unwrap();
    futures::executor::block_on(blocking).unwrap();
    start_after_retirement();

    let (direct_started_tx, direct_started_rx) = mpsc::channel();
    let (direct_release_tx, direct_release_rx) = mpsc::channel();
    let direct = try_within_runtime_if_available(|| {
      tokio::task::spawn_blocking(move || {
        direct_started_tx.send(()).unwrap();
        direct_release_rx.recv().unwrap();
      })
    })
    .unwrap();
    direct_started_rx
      .recv_timeout(Duration::from_secs(5))
      .expect("direct Tokio blocking task must start");
    try_shutdown_async_runtime().unwrap();
    let error = try_start_async_runtime()
      .expect_err("direct Tokio work must keep its old generation retiring");
    assert!(error.reason.contains("still shutting down"));
    direct_release_tx.send(()).unwrap();
    futures::executor::block_on(direct).unwrap();
    start_after_retirement();

    try_shutdown_async_runtime().unwrap();
    wait_for_retirement();
    FAIL_CUSTOM_START.store(true, Ordering::SeqCst);
    let shutdowns_before_failed_start = CUSTOM_SHUTDOWNS.load(Ordering::SeqCst);
    let error = try_start_async_runtime().expect_err("custom startup failure must be reported");
    assert!(error
      .reason
      .contains("injected custom runtime start failure"));
    assert_eq!(
      CUSTOM_SHUTDOWNS.load(Ordering::SeqCst),
      shutdowns_before_failed_start + 1,
      "a failed custom start must be rolled back through the shutdown hook"
    );
    assert!(!CUSTOM_RUNNING.load(Ordering::SeqCst));
    let error = std::panic::catch_unwind(|| spawn(async {}))
      .expect_err("failed combined startup must roll Tokio back to stopped");
    assert!(crate::bindgen_runtime::panic_to_error(error)
      .reason
      .contains("not running"));
    FAIL_CUSTOM_START.store(false, Ordering::SeqCst);
    wait_for_retirement();
    try_start_async_runtime().unwrap();

    {
      let mut block = SHUTDOWN_BLOCK
        .0
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
      *block = (true, false, false);
    }
    let shutdown = std::thread::spawn(try_shutdown_async_runtime);
    {
      let mut block = SHUTDOWN_BLOCK
        .0
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
      while !block.1 {
        block = SHUTDOWN_BLOCK
          .1
          .wait(block)
          .unwrap_or_else(std::sync::PoisonError::into_inner);
      }
    }
    assert!(try_block_on(async {}).is_err());
    assert!(
      within_custom_runtime_if_available(|| Ok::<_, Error>(())).is_err(),
      "generated custom-runtime entry must reject external work during shutdown"
    );
    assert!(
      std::panic::catch_unwind(|| spawn(async {})).is_err(),
      "infallible free helpers must reject external work during shutdown"
    );
    let starts_before = CUSTOM_STARTS.load(Ordering::SeqCst);
    let (start_tx, start_rx) = mpsc::channel();
    let start = std::thread::spawn(move || {
      start_after_retirement();
      start_tx.send(Ok::<_, Error>(())).unwrap();
    });
    assert!(
      start_rx.recv_timeout(Duration::from_millis(50)).is_err(),
      "start must wait for the combined shutdown transition"
    );
    assert_eq!(CUSTOM_STARTS.load(Ordering::SeqCst), starts_before);
    {
      let mut block = SHUTDOWN_BLOCK
        .0
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
      block.2 = true;
      SHUTDOWN_BLOCK.1.notify_all();
    }
    shutdown.join().unwrap().unwrap();
    start_rx
      .recv_timeout(Duration::from_secs(5))
      .expect("start must resume after shutdown")
      .unwrap();
    start.join().unwrap();
    assert!(CUSTOM_RUNNING.load(Ordering::SeqCst));

    try_shutdown_async_runtime().unwrap();
    {
      let mut block = START_BLOCK
        .0
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
      *block = (true, false, false);
    }
    let (start_tx, start_rx) = mpsc::channel();
    let start = std::thread::spawn(move || {
      start_after_retirement();
      start_tx.send(Ok::<_, Error>(())).unwrap();
    });
    {
      let mut block = START_BLOCK
        .0
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
      while !block.1 {
        block = START_BLOCK
          .1
          .wait(block)
          .unwrap_or_else(std::sync::PoisonError::into_inner);
      }
    }
    assert!(try_block_on(async {}).is_err());
    assert!(
      within_custom_runtime_if_available(|| Ok::<_, Error>(())).is_err(),
      "generated custom-runtime entry must reject external work during startup"
    );
    assert!(
      std::panic::catch_unwind(|| spawn(async {})).is_err(),
      "infallible free helpers must reject external work during startup"
    );
    {
      let mut block = START_BLOCK
        .0
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
      block.2 = true;
      START_BLOCK.1.notify_all();
    }
    start_rx
      .recv_timeout(Duration::from_secs(5))
      .expect("startup must complete after release")
      .unwrap();
    start.join().unwrap();

    let error = run_with_timeout(|| try_within_runtime_if_available(try_shutdown_async_runtime)?)
      .expect_err("shutdown from within a combined runtime guard must be rejected");
    assert!(error.reason.contains("inside an AsyncRuntime operation"));
    try_shutdown_async_runtime().unwrap();
    start_after_retirement();

    let error = run_with_timeout(|| try_block_on(async { try_shutdown_async_runtime() })?)
      .expect_err("shutdown from combined block_on must be rejected");
    assert!(error.reason.contains("inside an AsyncRuntime operation"));
    try_shutdown_async_runtime().unwrap();

    let spawn_drops = Arc::new(AtomicUsize::new(0));
    let captured = PanicOnDropProbe(Arc::clone(&spawn_drops));
    let error = std::panic::catch_unwind(AssertUnwindSafe(|| {
      spawn(async move {
        drop(captured);
      })
    }))
    .expect_err("free helpers must not implicitly restart Tokio after shutdown");
    assert!(crate::bindgen_runtime::panic_to_error(error)
      .reason
      .contains("not running"));
    assert_eq!(spawn_drops.load(Ordering::SeqCst), 1);

    let blocking_drops = Arc::new(AtomicUsize::new(0));
    let captured = PanicOnDropProbe(Arc::clone(&blocking_drops));
    let error =
      std::panic::catch_unwind(AssertUnwindSafe(|| spawn_blocking(move || drop(captured))))
        .expect_err("spawn_blocking must reject work after combined shutdown");
    assert!(crate::bindgen_runtime::panic_to_error(error)
      .reason
      .contains("not running"));
    assert_eq!(blocking_drops.load(Ordering::SeqCst), 1);
    start_after_retirement();
  }
}
