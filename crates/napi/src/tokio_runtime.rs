#[cfg(not(feature = "noop"))]
use std::sync::OnceLock;
#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
use std::sync::{
  atomic::{AtomicBool, Ordering},
  Mutex,
};
#[cfg(all(feature = "tokio_rt", not(feature = "noop")))]
use std::sync::{LazyLock, RwLock};
use std::{future::Future, marker::PhantomData};
#[cfg(feature = "async-runtime")]
use std::{
  panic::{catch_unwind, AssertUnwindSafe},
  pin::Pin,
  task::{Context, Poll},
};

#[cfg(feature = "tokio_rt")]
use tokio::runtime::Runtime;

use crate::{bindgen_runtime::ToNapiValue, sys, Env, Error, Result};
#[cfg(not(feature = "noop"))]
use crate::{JsDeferred, SendableResolver, Unknown};

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
const DUPLICATE_RUNTIME_ERROR: &str =
  "register_async_runtime was called more than once for the same addon image";
#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
const LATE_RUNTIME_REGISTRATION_ERROR: &str = "register_async_runtime must be called before the first Node-API environment begins activation or an earlier runtime-backed operation commits a backend choice";
#[cfg(all(
  feature = "async-runtime",
  not(feature = "tokio_rt"),
  not(feature = "noop")
))]
const MISSING_RUNTIME_BACKEND_ERROR: &str = "no AsyncRuntime backend is registered; call `register_async_runtime` from `#[module_init]` before invoking runtime-backed operations";
#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
const TASK_CANCELLED_ERROR: &str = "task was cancelled before completion";

/// Marker trait for the guard returned by [`AsyncRuntime::enter`].
///
/// The type-erased guard is deliberately not `Send`, so the entered runtime context cannot
/// migrate to another thread. The unit type `()` implements it as the no-op guard used by the
/// default [`AsyncRuntime::enter`] implementation.
#[cfg(feature = "async-runtime")]
pub trait AsyncRuntimeGuard {}

#[cfg(feature = "async-runtime")]
impl AsyncRuntimeGuard for () {}

/// Carrier for work an [`AsyncRuntime`] backend declined to accept.
///
/// The backend must hand the work back **untouched** together with a diagnostic [`Error`]; napi
/// then drops the recovered work through its cancellation path (settling the associated
/// JavaScript promise) instead of leaving it pending forever.
#[cfg(feature = "async-runtime")]
pub struct AsyncRuntimeRejection<T> {
  work: T,
  error: Error,
}

#[cfg(feature = "async-runtime")]
impl<T> AsyncRuntimeRejection<T> {
  /// Create a rejection from the declined work and a diagnostic error.
  pub fn new(work: T, error: Error) -> Self {
    Self { work, error }
  }

  /// The diagnostic error describing why the work was declined.
  pub fn error(&self) -> &Error {
    &self.error
  }

  /// Recover the declined work and the diagnostic error.
  pub fn into_parts(self) -> (T, Error) {
    (self.work, self.error)
  }
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
type AsyncRuntimeTaskCancelCallback = Box<dyn FnOnce(Error) + Send + 'static>;

/// An opaque unit of work napi submits to a custom [`AsyncRuntime`] backend.
///
/// There is no public constructor: tasks are built only inside napi (wrapping the future behind
/// a generated `#[napi] async fn`, [`crate::Env::spawn_future`], and friends together with the
/// promise-settling machinery).
///
/// Behavioral contract for backends:
/// - it is `Future<Output = ()> + Send + 'static`; poll it to completion,
/// - or drop it: dropping a task before completion fires its cancellation callback exactly once,
///   rejecting the associated JavaScript promise instead of leaving it pending,
/// - or hand it back untouched in an [`AsyncRuntimeRejection`] when declining the submission.
///
/// The first poll commits ownership and may run user code immediately. napi wraps every poll in
/// `catch_unwind` on unwind-enabled builds, so a panicking future settles its promise as rejected
/// instead of tearing down the backend's worker; do not add another panic-containment layer.
#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
pub struct AsyncRuntimeTask {
  fut: Pin<Box<dyn Future<Output = ()> + Send + 'static>>,
  on_cancel: Option<AsyncRuntimeTaskCancelCallback>,
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
impl AsyncRuntimeTask {
  fn new(
    fut: Pin<Box<dyn Future<Output = ()> + Send + 'static>>,
    on_cancel: AsyncRuntimeTaskCancelCallback,
  ) -> Self {
    Self {
      fut,
      on_cancel: Some(on_cancel),
    }
  }

  /// Settle the task's promise with the given diagnostic (used when a backend declines the
  /// submission), consuming the task without running its future. The regular cancellation
  /// callback is disarmed, so the subsequent drop is a no-op.
  fn reject_with(mut self, error: Error) {
    if let Some(on_cancel) = self.on_cancel.take() {
      on_cancel(error);
    }
  }
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
impl Future for AsyncRuntimeTask {
  type Output = ();

  fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output> {
    let this = self.get_mut();
    if this.on_cancel.is_none() {
      // Already completed, panicked, or rejected — never touch the inner future again.
      return Poll::Ready(());
    }
    match catch_unwind(AssertUnwindSafe(|| this.fut.as_mut().poll(cx))) {
      Ok(Poll::Pending) => Poll::Pending,
      Ok(Poll::Ready(())) => {
        // Completed: disarm the cancellation callback without invoking it.
        this.on_cancel = None;
        Poll::Ready(())
      }
      Err(panic_payload) => {
        // A panicking future settles its promise as rejected rather than aborting the
        // backend's worker thread. Exactly-once is guaranteed by taking the callback.
        if let Some(on_cancel) = this.on_cancel.take() {
          on_cancel(async_task_panic_error(panic_payload));
        }
        Poll::Ready(())
      }
    }
  }
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
impl Drop for AsyncRuntimeTask {
  fn drop(&mut self) {
    // Dropping an accepted task before completion (backend shutdown, queue teardown, …)
    // cancels it: the callback fires exactly once and rejects the associated promise.
    if let Some(on_cancel) = self.on_cancel.take() {
      on_cancel(Error::new(
        crate::Status::GenericFailure,
        TASK_CANCELLED_ERROR,
      ));
    }
  }
}

/// `noop` builds still need the type so the [`AsyncRuntime`] trait compiles; it is inert.
#[cfg(all(feature = "async-runtime", feature = "noop"))]
pub struct AsyncRuntimeTask {
  _private: (),
}

#[cfg(all(feature = "async-runtime", feature = "noop"))]
impl Future for AsyncRuntimeTask {
  type Output = ();

  fn poll(self: Pin<&mut Self>, _cx: &mut Context<'_>) -> Poll<Self::Output> {
    Poll::Ready(())
  }
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
fn async_task_panic_error(panic_payload: Box<dyn std::any::Any + Send>) -> Error {
  let reason = if let Some(reason) = panic_payload.downcast_ref::<&str>() {
    (*reason).to_string()
  } else if let Some(reason) = panic_payload.downcast_ref::<String>() {
    reason.clone()
  } else {
    "Panic in async function".to_owned()
  };
  Error::new(crate::Status::GenericFailure, reason)
}

/// Service-provider interface for plugging a custom async runtime into NAPI-RS.
///
/// The `async-runtime` feature exposes this SPI without by itself imposing a module-load
/// requirement. Implement this trait to back napi with your own scheduler (for example, a
/// single-threaded or WASI-friendly runtime) and register exactly one instance from
/// `#[module_init]`. A pure `async-runtime` addon with no registration can still load and expose
/// synchronous APIs; runtime-backed operations reject with a missing-backend error.
///
/// If no custom backend has been registered, the registration window closes when napi begins
/// activating the first Node-API environment, or earlier when a runtime-backed operation commits
/// a backend choice. In a combined `async-runtime` + `tokio_rt` build, that choice defaults
/// generated `#[napi]` futures to the built-in Tokio runtime. The established free `spawn`,
/// `spawn_blocking`, `block_on`, and `within_runtime_if_available` names remain Tokio
/// compatibility APIs whenever `tokio_rt` is enabled, so Cargo feature unification cannot
/// silently change their signatures or routing; generated `#[napi] async fn` futures follow the
/// *selection* (the custom backend if one was registered before the window closed, otherwise
/// Tokio). Selecting and starting a custom backend does not construct Tokio; the first Tokio
/// compatibility helper call constructs it lazily. In a pure `async-runtime` build there is no
/// Tokio at all, and a missing-backend error before any environment is activated leaves the
/// selection undecided and does not prevent later registration.
///
/// Under the `noop` feature this SPI cannot be installed: [`try_register_async_runtime`] safely
/// retires the supplied backend and reports [`crate::Status::InvalidArg`], while the infallible
/// [`register_async_runtime`] wrapper retires it and preserves its no-op result.
///
/// The implementation is stored once per linked addon image and shared across its threads, hence
/// the `Send + Sync + 'static` bound. The backend's [`Drop`] implementation is not guaranteed to
/// run; [`shutdown`](AsyncRuntime::shutdown) is the sole resource-release and quiescence hook.
/// Keep a newly constructed backend dormant, create active resources in
/// [`start`](AsyncRuntime::start), and release them in `shutdown`. See
/// [`register_async_runtime`] for duplicate registration behavior.
///
/// Panic containment described by this API requires a `panic = "unwind"` build. With
/// `panic = "abort"`, including Rust's currently shipped `wasm32-wasip1` and
/// `wasm32-wasip1-threads` targets, `catch_unwind` cannot intercept a panic: generated async
/// functions may trap or abort before their JavaScript promise is settled.
///
/// # Safety
///
/// Node may unload an addon's native image immediately after its last environment cleanup
/// returns. Implementations must ensure that, after [`shutdown`](AsyncRuntime::shutdown) returns,
/// no backend-owned thread, task, closure, destructor, cancellation callback, or future Node-API
/// callback can execute code or access data from that image. This includes externally retained
/// [`Waker`](std::task::Waker) or [`RawWaker`](std::task::RawWaker) clones and any other
/// task-owned callback, function pointer, or vtable reference whose later wake, clone, or drop
/// path could enter addon code. This requirement applies to both `Ok` and `Err` returns. A
/// backend that cannot prove those references inert must keep the native image loaded itself or
/// terminate the process rather than return.
#[cfg(feature = "async-runtime")]
pub unsafe trait AsyncRuntime: Send + Sync + 'static {
  /// Submit a task to run to completion in the background.
  ///
  /// Return `Ok(())` only after taking ownership of the task. Return
  /// `Err(AsyncRuntimeRejection::new(task, error))` when the runtime is stopped, saturated, or
  /// otherwise unable to accept it. The error is surfaced through the generated promise
  /// rejection. Dropping an accepted task invokes its cancellation callback, so shutdown
  /// implementations may cancel queued work by dropping it without leaving JavaScript promises
  /// pending forever. Never forget an accepted task: retain it until completion or drop it on
  /// cancellation.
  ///
  /// A backend may poll the task synchronously before this hook returns. The first poll commits
  /// ownership and may run user work immediately; after that point returning the task in an
  /// [`AsyncRuntimeRejection`] or panicking cannot roll back effects that already occurred. On
  /// unwind-enabled builds, napi already catches task panics. Poll the task directly and do not
  /// bypass its `Drop` implementation.
  fn spawn(
    &self,
    task: AsyncRuntimeTask,
  ) -> std::result::Result<(), AsyncRuntimeRejection<AsyncRuntimeTask>>;

  /// Block the current thread, fully driving the pinned future to completion before
  /// returning.
  ///
  /// Return a backend-specific error if the drive cannot be started or completed. Run the future
  /// to completion rather than returning on the first pending poll. The borrowed future must not
  /// be retained, moved to another thread, or accessed after this method returns. On either `Ok`
  /// or `Err`, the backend must stop accessing the borrowed future before returning.
  fn block_on(&self, future: Pin<&mut dyn Future<Output = ()>>) -> Result<()>;

  /// Enter the runtime context and return a guard that establishes it for the calling
  /// thread.
  ///
  /// In pure `async-runtime` builds `within_runtime_if_available` delegates here; combined
  /// `tokio_rt` builds retain its established Tokio routing. The returned guard MUST keep the
  /// runtime context active for the whole duration of the closure and tear it down on drop.
  /// Return a backend-specific error if the context cannot be entered. The default
  /// implementation returns a no-op guard, which is correct for backends that do not need an
  /// ambient context.
  fn enter(&self) -> Result<Box<dyn AsyncRuntimeGuard + '_>> {
    Ok(Box::new(()))
  }

  /// Start (or restart) the runtime.
  ///
  /// napi calls this when the first live Node environment for the addon starts. Worker
  /// isolates and Electron renderer reloads can take the live environment count from zero
  /// to one repeatedly, so this may run more than once over the backend's lifetime.
  /// Implement it idempotently. Return success only after the backend can accept tasks. Do not
  /// call napi's runtime registration or lifecycle functions recursively from this hook. If this
  /// returns an error, or panics on an unwind-enabled build, napi calls
  /// [`shutdown`](AsyncRuntime::shutdown) to roll back resources created by the partial start.
  /// With `panic = "abort"`, a panic traps or aborts before rollback can run. The default is a
  /// no-op.
  fn start(&self) -> Result<()> {
    Ok(())
  }

  /// Shut the runtime down.
  ///
  /// napi installs cleanup ownership for every Node environment, on native and wasm hosts, and
  /// calls this after the last live environment exits. An explicit `shutdown_async_runtime` call
  /// can also invoke this while environments remain live. Stop accepting work before returning
  /// and drop queued [`AsyncRuntimeTask`] values and queued
  /// [`spawn_blocking`](AsyncRuntime::spawn_blocking) closures so their promises are cancelled.
  /// Return `Ok(())` only after backend-owned worker threads, running tasks, and running
  /// blocking closures have fully quiesced: Node may unload a worker's addon image as soon as
  /// its environment cleanup returns. Do not wait for JavaScript callbacks triggered by
  /// cancellation, and do not call napi's runtime registration or lifecycle functions
  /// recursively from this hook. The hook must be idempotent and tolerate being called before
  /// `start`, after a partial failed `start`, and repeatedly without an intervening `start`. If
  /// this returns an error, the same quiescence guarantee still applies.
  fn shutdown(&self) -> Result<()>;

  /// Optional hook: run `work` on the backend's blocking-capable lane.
  ///
  /// Return `Ok(())` once the work is accepted; the backend should run the closure exactly once
  /// on a thread where blocking is acceptable. Dropping accepted work, for example while
  /// shutting down, safely cancels the caller's pending operation. Return
  /// `Err(AsyncRuntimeRejection::new(work, error))` to decline; napi surfaces that diagnostic
  /// and does not create an unbounded fallback thread. Never forget accepted work: run it
  /// exactly once or drop it during cancellation. The default implementation declines with
  /// [`crate::Status::GenericFailure`].
  ///
  /// The backend may invoke the closure synchronously before this hook returns. Invocation
  /// commits ownership, so a later hook panic cannot replace the closure's result.
  fn spawn_blocking(
    &self,
    work: Box<dyn FnOnce() + Send + 'static>,
  ) -> std::result::Result<(), AsyncRuntimeRejection<Box<dyn FnOnce() + Send + 'static>>> {
    Err(AsyncRuntimeRejection::new(
      work,
      Error::new(
        crate::Status::GenericFailure,
        "The AsyncRuntime backend does not support blocking work",
      ),
    ))
  }
}

/// Process-global (per addon image) registry holding the custom [`AsyncRuntime`] selection.
#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
struct AsyncRuntimeRegistry {
  backend: OnceLock<Box<dyn AsyncRuntime>>,
  /// Once `true`, the registration window is closed: either an environment began activation or
  /// a runtime-backed operation committed a backend choice.
  selection_frozen: AtomicBool,
  /// A duplicate/late registration error recorded by the infallible [`register_async_runtime`];
  /// surfaced by every later runtime-backed call.
  deferred_registration_error: Mutex<Option<&'static str>>,
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
impl AsyncRuntimeRegistry {
  const fn new() -> Self {
    Self {
      backend: OnceLock::new(),
      selection_frozen: AtomicBool::new(false),
      deferred_registration_error: Mutex::new(None),
    }
  }

  /// First-writer-wins registration. On rejection the backend is handed back to the caller for
  /// retirement together with the reason.
  fn try_register(
    &self,
    runtime: Box<dyn AsyncRuntime>,
  ) -> std::result::Result<(), (&'static str, Box<dyn AsyncRuntime>)> {
    if self.backend.get().is_some() {
      return Err((DUPLICATE_RUNTIME_ERROR, runtime));
    }
    if self.selection_frozen.load(Ordering::SeqCst) {
      return Err((LATE_RUNTIME_REGISTRATION_ERROR, runtime));
    }
    let mut candidate = Some(runtime);
    self.backend.get_or_init(|| {
      candidate
        .take()
        .expect("candidate backend is present until publication")
    });
    match candidate {
      None => Ok(()),
      // Lost the race against a concurrent registration.
      Some(rejected) => Err((DUPLICATE_RUNTIME_ERROR, rejected)),
    }
  }

  fn record_registration_error(&self, reason: &'static str) {
    if let Ok(mut slot) = self.deferred_registration_error.lock() {
      if slot.is_none() {
        *slot = Some(reason);
      }
    }
  }

  fn deferred_registration_error(&self) -> Option<&'static str> {
    self
      .deferred_registration_error
      .lock()
      .ok()
      .and_then(|slot| *slot)
  }

  /// Commit the backend selection for a runtime-backed operation and return the custom backend
  /// if one is selected. `fallback_commits` is `true` when a built-in Tokio fallback exists
  /// (combined builds): taking the fallback also commits a choice and closes the registration
  /// window. In pure `async-runtime` builds a missing backend leaves the selection undecided.
  fn commit_selection(&self, fallback_commits: bool) -> Option<&dyn AsyncRuntime> {
    let backend = self.backend.get().map(|backend| backend.as_ref());
    if backend.is_some() || fallback_commits {
      self.selection_frozen.store(true, Ordering::SeqCst);
    }
    backend
  }

  /// First-env-activation hook: close the registration window and start the custom backend if
  /// one is selected. Returns `true` when a custom backend owns the runtime lifecycle.
  fn activate(&self) -> bool {
    self.selection_frozen.store(true, Ordering::SeqCst);
    let Some(backend) = self.backend.get() else {
      return false;
    };
    match catch_unwind(AssertUnwindSafe(|| backend.start())) {
      Ok(Ok(())) => {}
      // A failed or panicking `start` is rolled back through `shutdown`.
      Ok(Err(_)) | Err(_) => {
        let _ = catch_unwind(AssertUnwindSafe(|| backend.shutdown()));
      }
    }
    true
  }

  /// Last-env-teardown hook. Returns `true` when a custom backend owned the lifecycle.
  fn deactivate(&self) -> bool {
    let Some(backend) = self.backend.get() else {
      return false;
    };
    let _ = catch_unwind(AssertUnwindSafe(|| backend.shutdown()));
    true
  }
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
static ASYNC_RUNTIME_REGISTRY: AsyncRuntimeRegistry = AsyncRuntimeRegistry::new();

/// Retire a backend that was rejected (duplicate/late registration or `noop` build): the unsafe
/// [`AsyncRuntime`] contract does not permit assuming that `Drop` quiesces backend work, so
/// [`AsyncRuntime::shutdown`] runs first. If shutdown or the destructor panics the process
/// aborts, because a half-torn-down backend cannot be proven quiescent.
#[cfg(feature = "async-runtime")]
fn retire_rejected_async_runtime(runtime: Box<dyn AsyncRuntime>) {
  if catch_unwind(AssertUnwindSafe(|| runtime.shutdown())).is_err() {
    std::mem::forget(runtime);
    std::process::abort();
  }
  if catch_unwind(AssertUnwindSafe(move || drop(runtime))).is_err() {
    std::process::abort();
  }
}

/// Register the custom [`AsyncRuntime`] backend for this linked addon image.
///
/// Call this once from `#[module_init]`. That hook is a library constructor and runs before napi
/// owns a Node-API environment, so registration only publishes a dormant backend. Runtime-backed
/// APIs become available after environment activation calls [`AsyncRuntime::start`].
///
/// Registration is once per linked addon image and first-writer-wins. `#[module_init]` runs as a
/// library constructor where panicking would abort the process before Node can see an exception,
/// so this infallible wrapper never panics: a duplicate or late registration records the error,
/// and every later runtime-backed operation (for example a generated `#[napi] async fn`)
/// surfaces it by rejecting its promise. The fallible [`try_register_async_runtime`] form
/// returns the error directly. napi invokes [`AsyncRuntime::shutdown`] before dropping a
/// rejected backend, because the unsafe [`AsyncRuntime`] contract does not permit assuming that
/// `Drop` quiesces backend work.
///
/// A successfully registered backend remains reusable across zero-environment shutdown/start
/// cycles, and its `Drop` implementation is not guaranteed to run. Construct it without starting
/// threads or other active resources; acquire those in [`AsyncRuntime::start`] and release them
/// in [`AsyncRuntime::shutdown`].
#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
pub fn register_async_runtime<R: AsyncRuntime>(runtime: R) {
  if let Err((reason, rejected)) = ASYNC_RUNTIME_REGISTRY.try_register(Box::new(runtime)) {
    retire_rejected_async_runtime(rejected);
    ASYNC_RUNTIME_REGISTRY.record_registration_error(reason);
  }
}

/// Try to register a custom async runtime without deferring errors.
///
/// Library constructors should normally use [`register_async_runtime`], which defers reporting
/// until Node provides an environment where napi can surface the failure. Registration after
/// napi begins activating an environment, or after an earlier runtime-backed operation commits a
/// backend choice, returns an error and safely retires the rejected backend through its own
/// [`AsyncRuntime::shutdown`]. A missing-backend error before any environment is activated does
/// not freeze registration.
#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
pub fn try_register_async_runtime<R: AsyncRuntime>(runtime: R) -> Result<()> {
  match ASYNC_RUNTIME_REGISTRY.try_register(Box::new(runtime)) {
    Ok(()) => Ok(()),
    Err((reason, rejected)) => {
      retire_rejected_async_runtime(rejected);
      Err(Error::new(crate::Status::GenericFailure, reason))
    }
  }
}

/// `noop` builds cannot install an async runtime backend; the supplied backend is retired
/// (shut down, then dropped) and the error is swallowed to preserve the no-op result.
#[cfg(all(feature = "async-runtime", feature = "noop"))]
pub fn register_async_runtime<R: AsyncRuntime>(runtime: R) {
  retire_rejected_async_runtime(Box::new(runtime));
}

/// `noop` builds cannot install an async runtime backend; the supplied backend is retired
/// (shut down, then dropped) and [`crate::Status::InvalidArg`] is reported.
#[cfg(all(feature = "async-runtime", feature = "noop"))]
pub fn try_register_async_runtime<R: AsyncRuntime>(runtime: R) -> Result<()> {
  retire_rejected_async_runtime(Box::new(runtime));
  Err(Error::new(
    crate::Status::InvalidArg,
    "The `noop` feature is enabled; no AsyncRuntime backend can be registered",
  ))
}

#[cfg(all(feature = "tokio_rt", not(feature = "noop")))]
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

#[cfg(all(feature = "tokio_rt", not(feature = "noop")))]
static RT: LazyLock<RwLock<Option<Runtime>>> =
  LazyLock::new(|| RwLock::new(Some(create_runtime())));

#[cfg(all(feature = "tokio_rt", not(feature = "noop")))]
static USER_DEFINED_RT: OnceLock<RwLock<Option<Runtime>>> = OnceLock::new();

#[cfg(all(feature = "tokio_rt", not(feature = "noop")))]
static IS_USER_DEFINED_RT: OnceLock<bool> = OnceLock::new();

#[cfg(all(feature = "tokio_rt", not(feature = "noop")))]
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

#[cfg(all(feature = "tokio_rt", feature = "noop"))]
pub fn create_custom_tokio_runtime(_: Runtime) {}

#[cfg(not(feature = "noop"))]
/// Start the async runtime.
///
/// When the `async-runtime` feature is enabled and a custom [`AsyncRuntime`] backend has been
/// registered through [`register_async_runtime`], this closes the registration window and calls
/// the backend's [`AsyncRuntime::start`] hook. If that hook returns an error or panics,
/// [`AsyncRuntime::shutdown`] is called to roll back the partial start. Selecting a custom
/// backend never constructs the built-in Tokio runtime.
///
/// Otherwise (the `tokio_rt` path):
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
  if ASYNC_RUNTIME_REGISTRY.activate() {
    // A custom backend owns the runtime lifecycle; do not construct Tokio.
    return;
  }
  #[cfg(feature = "tokio_rt")]
  if let Ok(mut rt) = RT.write() {
    if rt.is_none() {
      *rt = Some(create_runtime());
    }
  }
}

#[cfg(not(feature = "noop"))]
/// Shutdown the async runtime.
///
/// When a custom [`AsyncRuntime`] backend has been registered, this calls the backend's
/// [`AsyncRuntime::shutdown`] hook — the backend's sole resource-release and quiescence hook.
/// Otherwise the built-in Tokio runtime is shut down in the background.
pub fn shutdown_async_runtime() {
  #[cfg(feature = "async-runtime")]
  if ASYNC_RUNTIME_REGISTRY.deactivate() {
    return;
  }
  #[cfg(feature = "tokio_rt")]
  if let Some(rt) = RT.write().ok().and_then(|mut rt| rt.take()) {
    rt.shutdown_background();
  }
}

#[cfg(all(feature = "tokio_rt", not(feature = "noop")))]
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

#[cfg(all(feature = "tokio_rt", not(feature = "noop")))]
/// Runs a future to completion
/// This is blocking, meaning that it pauses other execution until the future is complete,
/// only use it when it is absolutely necessary, in other places use async functions instead.
pub fn block_on<F: Future>(fut: F) -> F::Output {
  RT.read()
    .ok()
    .and_then(|rt| rt.as_ref().map(|rt| rt.block_on(fut)))
    .expect("Access tokio runtime failed in block_on")
}

#[cfg(all(feature = "tokio_rt", feature = "noop"))]
/// Runs a future to completion
/// This is blocking, meaning that it pauses other execution until the future is complete,
/// only use it when it is absolutely necessary, in other places use async functions instead.
pub fn block_on<F: Future>(_: F) -> F::Output {
  unreachable!("noop feature is enabled, block_on is not available")
}

#[cfg(all(feature = "tokio_rt", not(feature = "noop")))]
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

// This function's signature must be kept in sync with the one in lib.rs, otherwise napi
// will fail to compile with the `tokio_rt` feature.
#[cfg(all(feature = "tokio_rt", not(feature = "noop")))]
/// If the feature `tokio_rt` has been enabled this will enter the runtime context and
/// then call the provided closure. Otherwise it will just call the provided closure.
///
/// In combined `tokio_rt` + `async-runtime` builds this established helper stays Tokio-backed,
/// so Cargo feature unification cannot silently change its routing.
pub fn within_runtime_if_available<F: FnOnce() -> T, T>(f: F) -> T {
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

// This function's signature must be kept in sync with the one in lib.rs, otherwise napi
// will fail to compile with the `async-runtime` feature.
#[cfg(all(
  feature = "async-runtime",
  not(feature = "tokio_rt"),
  not(feature = "noop")
))]
/// Enter the registered [`AsyncRuntime`] backend's context (via [`AsyncRuntime::enter`]) around
/// the provided closure. When no backend is registered, or entering the context fails, the
/// closure is called directly.
pub fn within_runtime_if_available<F: FnOnce() -> T, T>(f: F) -> T {
  if let Some(backend) = ASYNC_RUNTIME_REGISTRY.commit_selection(false) {
    let _guard = backend.enter().ok();
    return f();
  }
  f()
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
  execute_future_impl(env, fut, resolver, None)
}

/// Shared future → Promise bridge behind [`execute_tokio_future`] and
/// [`execute_tokio_future_with_finalize_callback`].
///
/// Routing:
/// 1. a deferred duplicate/late registration error rejects the promise (loud misconfiguration),
/// 2. a registered custom [`AsyncRuntime`] backend receives the work as an [`AsyncRuntimeTask`],
/// 3. otherwise the built-in Tokio runtime is used (combined and `tokio_rt`-only builds); in a
///    pure `async-runtime` build the promise rejects with a missing-backend error instead.
#[cfg(not(feature = "noop"))]
#[allow(clippy::not_unsafe_ptr_arg_deref)]
fn execute_future_impl<
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
  let promise_value = promise.0.value;

  #[cfg(feature = "async-runtime")]
  if let Some(reason) = ASYNC_RUNTIME_REGISTRY.deferred_registration_error() {
    deferred.reject(Error::new(crate::Status::GenericFailure, reason));
    return Ok(promise_value);
  }

  #[cfg(all(feature = "async-runtime", not(feature = "tokio_rt")))]
  if ASYNC_RUNTIME_REGISTRY.commit_selection(false).is_none() {
    // Pure `async-runtime` build with no registered backend: reject rather than hang. The
    // selection is deliberately NOT frozen, so a later registration can still succeed.
    deferred.reject(Error::new(
      crate::Status::GenericFailure,
      MISSING_RUNTIME_BACKEND_ERROR,
    ));
    return Ok(promise_value);
  }

  #[cfg(feature = "async-runtime")]
  let deferred_for_cancel = deferred.clone();
  #[cfg(all(
    feature = "tokio_rt",
    any(
      all(target_family = "wasm", tokio_unstable),
      not(target_family = "wasm")
    )
  ))]
  let deferred_for_panic = deferred.clone();
  let sendable_resolver = SendableResolver::new(resolver);

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
  if let Some(backend) = ASYNC_RUNTIME_REGISTRY.commit_selection(cfg!(feature = "tokio_rt")) {
    let task = AsyncRuntimeTask::new(
      Box::pin(inner),
      Box::new(move |error| deferred_for_cancel.reject(error)),
    );
    match catch_unwind(AssertUnwindSafe(|| backend.spawn(task))) {
      Ok(Ok(())) => {}
      Ok(Err(rejection)) => {
        // The backend declined and handed the task back untouched: settle the promise
        // with the diagnostic instead of leaving it pending.
        let (task, error) = rejection.into_parts();
        task.reject_with(error);
      }
      // The hook panicked. The task's `Drop` during unwinding already fired the
      // cancellation path unless the future had settled first (first poll commits
      // ownership), so there is nothing left to settle here.
      Err(_) => {}
    }
    return Ok(promise_value);
  }

  #[cfg(feature = "tokio_rt")]
  {
    #[cfg(any(
      all(target_family = "wasm", tokio_unstable),
      not(target_family = "wasm")
    ))]
    let jh = spawn(inner);

    #[cfg(any(
      all(target_family = "wasm", tokio_unstable),
      not(target_family = "wasm")
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

    #[cfg(all(target_family = "wasm", not(tokio_unstable)))]
    {
      std::thread::spawn(|| {
        block_on(inner);
      });
    }

    Ok(promise_value)
  }

  // Pure `async-runtime` build: unreachable in practice — the missing-backend check above
  // already returned, and a published backend cannot be unregistered. Kept for type checking.
  #[cfg(all(feature = "async-runtime", not(feature = "tokio_rt")))]
  {
    drop(inner);
    Ok(promise_value)
  }
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
  execute_future_impl(env, fut, resolver, finalize_callback)
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
