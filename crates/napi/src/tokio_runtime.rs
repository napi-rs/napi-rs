#[cfg(all(
  not(feature = "noop"),
  any(feature = "async-runtime", feature = "tokio_rt")
))]
use std::cell::Cell;
#[cfg(not(feature = "noop"))]
use std::collections::HashMap;
#[cfg(all(not(feature = "noop"), feature = "tokio_rt"))]
use std::collections::HashSet;
#[cfg(all(
  not(feature = "noop"),
  any(feature = "async-runtime", feature = "tokio_rt")
))]
use std::sync::Condvar;
#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
use std::sync::Weak;
#[cfg(not(feature = "noop"))]
use std::sync::{
  atomic::{AtomicBool, AtomicUsize, Ordering},
  LazyLock, OnceLock,
};
#[cfg(all(
  not(feature = "noop"),
  any(feature = "async-runtime", feature = "tokio_rt")
))]
use std::time::{Duration, Instant};
use std::{
  future::Future,
  marker::PhantomData,
  sync::{Arc, Mutex},
};

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
use std::task::Context;
#[cfg(not(feature = "noop"))]
use std::task::Poll;
#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
use std::task::Waker;

#[cfg(feature = "tokio")]
use tokio::runtime::Runtime;

#[cfg(not(feature = "noop"))]
use futures::future::{AbortHandle, Abortable};
#[cfg(not(feature = "noop"))]
use futures::FutureExt;

#[cfg(all(
  not(feature = "noop"),
  any(
    feature = "async-runtime",
    all(feature = "tokio_rt", target_family = "wasm", not(tokio_unstable))
  )
))]
use crate::check_status;
use crate::{bindgen_runtime::ToNapiValue, sys, Env, Error, Result};
#[cfg(not(feature = "noop"))]
use crate::{JsDeferred, SendableResolver, Unknown};

type AsyncBlockTerminalCallback = Box<dyn FnOnce() + Send + 'static>;

struct AsyncBlockTerminalFinalizerInner {
  callback: Mutex<Option<AsyncBlockTerminalCallback>>,
}

impl AsyncBlockTerminalFinalizerInner {
  fn take(&self) -> Option<AsyncBlockTerminalCallback> {
    self
      .callback
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner)
      .take()
  }
}

impl Drop for AsyncBlockTerminalFinalizerInner {
  fn drop(&mut self) {
    let callback = self
      .callback
      .get_mut()
      .unwrap_or_else(std::sync::PoisonError::into_inner)
      .take();
    run_async_block_terminal_callback(callback);
  }
}

#[derive(Clone)]
struct AsyncBlockTerminalFinalizer {
  inner: Arc<AsyncBlockTerminalFinalizerInner>,
}

impl AsyncBlockTerminalFinalizer {
  fn new(finalizer: impl FnOnce() + Send + 'static) -> Self {
    Self {
      inner: Arc::new(AsyncBlockTerminalFinalizerInner {
        callback: Mutex::new(Some(Box::new(finalizer))),
      }),
    }
  }

  fn run(&self) {
    run_async_block_terminal_callback(self.inner.take());
  }
}

#[cfg(not(feature = "noop"))]
struct AsyncBlockTerminalFinalizerGuard(AsyncBlockTerminalFinalizer);

#[cfg(not(feature = "noop"))]
impl Drop for AsyncBlockTerminalFinalizerGuard {
  fn drop(&mut self) {
    self.0.run();
  }
}

fn run_async_block_terminal_callback(callback: Option<AsyncBlockTerminalCallback>) {
  if let Some(callback) = callback {
    crate::bindgen_runtime::catch_unwind_safely(callback);
  }
}

#[cfg(not(feature = "noop"))]
fn run_async_block_terminal_finalizer(finalizer: &Option<AsyncBlockTerminalFinalizer>) {
  if let Some(finalizer) = finalizer {
    finalizer.run();
  }
}

#[cfg(all(
  test,
  not(feature = "noop"),
  any(feature = "async-runtime", feature = "tokio_rt")
))]
mod owner_thread_finalize_callback_tests {
  use std::{cell::Cell, rc::Rc};

  use super::*;

  #[test]
  fn dropped_setup_callback_runs_with_its_owner_environment() {
    let owner_env = 1usize as sys::napi_env;
    let called_with = Rc::new(Cell::new(None));
    let callback_called_with = Rc::clone(&called_with);
    let callback = OwnerThreadAsyncSetupCleanup::new(
      owner_env,
      (),
      (),
      Some(Box::new(move |env| {
        callback_called_with.set(Some(env as usize));
      })),
      None,
    );

    drop(callback);

    assert_eq!(called_with.get(), Some(owner_env as usize));
  }

  #[test]
  fn invoked_setup_callback_runs_once_with_the_settlement_environment() {
    let owner_env = 1usize as sys::napi_env;
    let settlement_env = 2usize as sys::napi_env;
    let calls = Rc::new(Cell::new(0));
    let called_with = Rc::new(Cell::new(None));
    let callback_calls = Rc::clone(&calls);
    let callback_called_with = Rc::clone(&called_with);
    let mut callback = OwnerThreadAsyncSetupCleanup::new(
      owner_env,
      (),
      (),
      Some(Box::new(move |env| {
        callback_calls.set(callback_calls.get() + 1);
        callback_called_with.set(Some(env as usize));
      })),
      None,
    );

    callback
      .take_finalize_callback()
      .expect("a provided finalize callback must remain present")(settlement_env);
    drop(callback);

    assert_eq!(calls.get(), 1);
    assert_eq!(called_with.get(), Some(settlement_env as usize));
  }
}

#[cfg(feature = "async-runtime")]
/// Opaque runtime-context guard returned by [`AsyncRuntime::enter`].
///
/// Implement this marker trait for a guard whose [`Drop`] implementation leaves the backend's
/// thread-local or executor context. napi keeps the guard on the calling thread and drops it after
/// the entered callback finishes. The erased guard object is intentionally not `Send`, so napi
/// cannot move an entered context to another thread.
pub trait AsyncRuntimeGuard {}

#[cfg(feature = "async-runtime")]
impl AsyncRuntimeGuard for () {}

/// Work returned by an [`AsyncRuntime`] submission hook together with the reason it was rejected.
///
/// Construct this only when the backend did not accept ownership of the supplied work, and return
/// the original work value unchanged. napi drops the returned work through its cancellation path
/// and preserves the [`Error`] for generated promises and `JoinHandle` consumers.
#[cfg(feature = "async-runtime")]
pub struct AsyncRuntimeRejection<T> {
  work: T,
  error: Error,
}

#[cfg(feature = "async-runtime")]
impl<T> AsyncRuntimeRejection<T> {
  /// Create a rejection from the unaccepted work and a backend-specific diagnostic.
  pub fn new(work: T, error: Error) -> Self {
    Self { work, error }
  }

  /// Borrow the backend-specific rejection diagnostic.
  pub fn error(&self) -> &Error {
    &self.error
  }

  /// Recover the unaccepted work and backend-specific rejection diagnostic.
  pub fn into_parts(self) -> (T, Error) {
    (self.work, self.error)
  }
}

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
  Completed(AsyncRuntimeCompletion),
  Cancelled,
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
/// Runs only after the task future has been fully destroyed.
type AsyncRuntimeCompletion = Box<dyn FnOnce() + Send + 'static>;

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
trait IntoAsyncRuntimeCompletion {
  fn into_async_runtime_completion(self) -> AsyncRuntimeCompletion;
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
impl IntoAsyncRuntimeCompletion for AsyncRuntimeCompletion {
  fn into_async_runtime_completion(self) -> AsyncRuntimeCompletion {
    self
  }
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
impl IntoAsyncRuntimeCompletion for () {
  fn into_async_runtime_completion(self) -> AsyncRuntimeCompletion {
    Box::new(|| {})
  }
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
type AsyncRuntimeTaskFuture = Pin<Box<dyn Future<Output = AsyncTaskOutcome> + Send + 'static>>;

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
type AsyncRuntimeAfterFutureDrop = Box<dyn FnOnce() + Send + 'static>;

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
#[derive(Default)]
struct AsyncRuntimeAfterFutureDropBatch {
  actions: Vec<AsyncRuntimeAfterFutureDrop>,
  env_task_registration: Option<EnvTaskRegistration>,
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
struct AsyncRuntimeTaskFutureSlotInner {
  // `busy` covers both polling and detached-future destruction. Terminal actions stay queued
  // until the busy owner has destroyed the future and cleared the flag.
  future: Option<AsyncRuntimeTaskFuture>,
  busy: bool,
  finished: bool,
  after_drop: Vec<AsyncRuntimeAfterFutureDrop>,
  env_task_registration: Option<EnvTaskRegistration>,
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
struct AsyncRuntimeTaskFutureSlot {
  inner: Mutex<AsyncRuntimeTaskFutureSlotInner>,
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
impl AsyncRuntimeTaskFutureSlot {
  fn new(future: impl Future<Output = AsyncTaskOutcome> + Send + 'static) -> Self {
    Self {
      inner: Mutex::new(AsyncRuntimeTaskFutureSlotInner {
        future: Some(Box::pin(future)),
        busy: false,
        finished: false,
        after_drop: Vec::new(),
        env_task_registration: None,
      }),
    }
  }

  fn bind_env_task_registration(&self, registration: EnvTaskRegistration) {
    let mut inner = self
      .inner
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner);
    debug_assert!(
      inner.env_task_registration.is_none(),
      "an async task may own only one environment registration"
    );
    inner.env_task_registration = Some(registration);
  }

  fn begin_poll(&self) -> Option<AsyncRuntimeTaskFuture> {
    let mut inner = self
      .inner
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner);
    if inner.finished || inner.busy {
      return None;
    }
    let future = inner.future.take();
    inner.busy = future.is_some();
    if future.is_none() {
      inner.finished = true;
    }
    future
  }

  fn finish_detached_future_drop(
    &self,
    future: AsyncRuntimeTaskFuture,
  ) -> AsyncRuntimeAfterFutureDropBatch {
    drop_safely(future);
    let mut inner = self
      .inner
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner);
    debug_assert!(
      inner.busy,
      "the slot must stay busy while its detached future is destroyed"
    );
    inner.busy = false;
    AsyncRuntimeAfterFutureDropBatch {
      actions: std::mem::take(&mut inner.after_drop),
      env_task_registration: inner.env_task_registration.take(),
    }
  }

  #[must_use]
  fn finish_pending_poll(&self, future: AsyncRuntimeTaskFuture) -> bool {
    {
      let mut inner = self
        .inner
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
      debug_assert!(inner.busy, "only the polling owner may finish a task poll");
      if !inner.finished {
        debug_assert!(
          inner.future.is_none(),
          "a polling task cannot retain another stored future"
        );
        debug_assert!(
          inner.after_drop.is_empty(),
          "a live task cannot have a queued terminal action"
        );
        inner.future = Some(future);
        inner.busy = false;
        return true;
      }
    }
    run_after_future_drop_actions(self.finish_detached_future_drop(future));
    false
  }

  fn finish_terminal_poll(
    &self,
    future: AsyncRuntimeTaskFuture,
    after_drop: Option<AsyncRuntimeAfterFutureDrop>,
  ) {
    {
      let mut inner = self
        .inner
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
      debug_assert!(inner.busy, "only the polling owner may finish a task poll");
      inner.finished = true;
      inner.after_drop.extend(after_drop);
    }
    let after_drop = self.finish_detached_future_drop(future);
    run_after_future_drop_actions(after_drop);
  }

  fn drop_future_then(&self, after_drop: Option<AsyncRuntimeAfterFutureDrop>) {
    let (future, after_drop) = {
      let mut inner = self
        .inner
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
      inner.finished = true;
      inner.after_drop.extend(after_drop);
      if inner.busy {
        return;
      }
      if let Some(future) = inner.future.take() {
        inner.busy = true;
        (Some(future), AsyncRuntimeAfterFutureDropBatch::default())
      } else {
        (
          None,
          AsyncRuntimeAfterFutureDropBatch {
            actions: std::mem::take(&mut inner.after_drop),
            env_task_registration: inner.env_task_registration.take(),
          },
        )
      }
    };
    if let Some(future) = future {
      run_after_future_drop_actions(self.finish_detached_future_drop(future));
    } else {
      run_after_future_drop_actions(after_drop);
    }
  }

  fn drop_future(&self) {
    self.drop_future_then(None);
  }
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
fn run_after_future_drop(after_drop: AsyncRuntimeAfterFutureDrop) {
  let _operation = RuntimeOperationGuard::enter();
  crate::bindgen_runtime::catch_unwind_safely(after_drop);
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
fn run_after_future_drop_actions(after_drop: AsyncRuntimeAfterFutureDropBatch) {
  for action in after_drop.actions {
    run_after_future_drop(action);
  }
  if let Some(registration) = after_drop.env_task_registration {
    drop_safely(registration);
  }
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
fn cancellation_after_future_drop(
  callback: AsyncRuntimeCancellation,
  reason: AsyncRuntimeCancellationReason,
) -> AsyncRuntimeAfterFutureDrop {
  Box::new(move || {
    crate::bindgen_runtime::catch_unwind_safely(|| callback(reason));
  })
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
fn discard_cancellation_after_future_drop(
  cancellation: AsyncRuntimeCancellation,
) -> AsyncRuntimeAfterFutureDrop {
  Box::new(move || drop_safely(cancellation))
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
fn run_task_completion(completion: AsyncRuntimeCompletion, cancellation: AsyncRuntimeCancellation) {
  if let Err(reason) = std::panic::catch_unwind(AssertUnwindSafe(completion)) {
    crate::bindgen_runtime::catch_unwind_safely(|| {
      cancellation(AsyncRuntimeCancellationReason::Failed(
        crate::bindgen_runtime::panic_to_error(reason),
      ));
    });
  } else {
    drop_safely(cancellation);
  }
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
fn drop_unclaimed_task_completion(completion: AsyncRuntimeCompletion) {
  drop_safely(completion);
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
fn drop_task_future_then(
  task_future: Option<&Weak<AsyncRuntimeTaskFutureSlot>>,
  after_drop: AsyncRuntimeAfterFutureDrop,
) {
  if let Some(future) = task_future.and_then(Weak::upgrade) {
    future.drop_future_then(Some(after_drop));
  } else {
    run_after_future_drop(after_drop);
  }
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
enum AsyncRuntimeCancellationReason {
  Cancelled,
  Rejected(Error),
  Failed(Error),
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
impl AsyncRuntimeCancellationReason {
  fn from_error(error: Option<Error>) -> Self {
    match error {
      Some(error) => Self::Failed(error),
      None => Self::Cancelled,
    }
  }

  fn into_error(self) -> Option<Error> {
    match self {
      Self::Cancelled => None,
      Self::Rejected(error) | Self::Failed(error) => Some(error),
    }
  }
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
type AsyncRuntimeCancellation = Box<dyn FnOnce(AsyncRuntimeCancellationReason) + Send + 'static>;

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
struct DeferredAsyncRuntimeCancellation {
  reason: AsyncRuntimeCancellationReason,
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
enum AsyncRuntimeSubmissionState {
  Submitting,
  Accepted,
  Started,
  Settled,
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
struct AsyncRuntimeSubmissionInner {
  state: AsyncRuntimeSubmissionState,
  cancellation: Option<AsyncRuntimeCancellation>,
  deferred_cancellation: Option<DeferredAsyncRuntimeCancellation>,
}

/// Keeps task cancellation pending until an [`AsyncRuntime`] submission hook has returned.
///
/// Rust drops arguments while unwinding through a panicking hook. Deferring cancellation until
/// the hook outcome is known preserves the panic diagnostic. The first task poll or blocking-work
/// invocation commits ownership so a backend may synchronously drive accepted work before its hook
/// returns. Settlement is owned independently of the submitted wrapper, so a hook failure can
/// immediately reject retained work that has not started and make the retained wrapper inert.
#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
struct AsyncRuntimeSubmission {
  inner: Mutex<AsyncRuntimeSubmissionInner>,
  task_future: Option<Weak<AsyncRuntimeTaskFutureSlot>>,
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
impl AsyncRuntimeSubmission {
  fn new_with_reason(cancellation: AsyncRuntimeCancellation) -> Self {
    Self::new_inner(cancellation, None)
  }

  fn new_task_with_reason(
    cancellation: AsyncRuntimeCancellation,
    future: &Arc<AsyncRuntimeTaskFutureSlot>,
  ) -> Self {
    Self::new_inner(cancellation, Some(Arc::downgrade(future)))
  }

  fn new_inner(
    cancellation: AsyncRuntimeCancellation,
    task_future: Option<Weak<AsyncRuntimeTaskFutureSlot>>,
  ) -> Self {
    Self {
      inner: Mutex::new(AsyncRuntimeSubmissionInner {
        state: AsyncRuntimeSubmissionState::Submitting,
        cancellation: Some(cancellation),
        deferred_cancellation: None,
      }),
      task_future,
    }
  }

  fn drop_task_future_then(&self, after_drop: AsyncRuntimeAfterFutureDrop) {
    // A submission hook can fail after retaining an unpolled task, so settlement cannot rely on
    // the retained wrapper reaching Drop first.
    drop_task_future_then(self.task_future.as_ref(), after_drop);
  }

  #[must_use]
  fn start(&self) -> bool {
    let mut inner = self
      .inner
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner);
    match inner.state {
      AsyncRuntimeSubmissionState::Submitting => {
        if inner.deferred_cancellation.is_some() {
          return false;
        }
        inner.state = AsyncRuntimeSubmissionState::Started;
        true
      }
      AsyncRuntimeSubmissionState::Accepted => {
        inner.state = AsyncRuntimeSubmissionState::Started;
        true
      }
      AsyncRuntimeSubmissionState::Started => true,
      AsyncRuntimeSubmissionState::Settled => false,
    }
  }

  fn claim_cancellation(&self, error: Option<Error>) -> Option<AsyncRuntimeAfterFutureDrop> {
    let reason = AsyncRuntimeCancellationReason::from_error(error);
    let callback = {
      let mut inner = self
        .inner
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
      match inner.state {
        AsyncRuntimeSubmissionState::Submitting => {
          if inner.deferred_cancellation.is_none() {
            inner.deferred_cancellation = Some(DeferredAsyncRuntimeCancellation { reason });
          }
          None
        }
        AsyncRuntimeSubmissionState::Accepted | AsyncRuntimeSubmissionState::Started => {
          inner.state = AsyncRuntimeSubmissionState::Settled;
          inner.cancellation.take().map(|callback| (callback, reason))
        }
        AsyncRuntimeSubmissionState::Settled => None,
      }
    };
    callback.map(|(callback, reason)| cancellation_after_future_drop(callback, reason))
  }

  fn cancel(&self, error: Option<Error>) {
    if let Some(after_drop) = self.claim_cancellation(error) {
      self.drop_task_future_then(after_drop);
    }
  }

  #[must_use]
  fn accept(&self) -> bool {
    let (accepted, cancellation) = {
      let mut inner = self
        .inner
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
      match inner.state {
        AsyncRuntimeSubmissionState::Submitting => {
          if let Some(deferred) = inner.deferred_cancellation.take() {
            inner.state = AsyncRuntimeSubmissionState::Settled;
            (
              true,
              inner
                .cancellation
                .take()
                .map(|callback| (callback, deferred.reason)),
            )
          } else {
            inner.state = AsyncRuntimeSubmissionState::Accepted;
            (true, None)
          }
        }
        AsyncRuntimeSubmissionState::Accepted | AsyncRuntimeSubmissionState::Started => {
          (true, None)
        }
        AsyncRuntimeSubmissionState::Settled => (false, None),
      }
    };
    if let Some((callback, reason)) = cancellation {
      self.drop_task_future_then(cancellation_after_future_drop(callback, reason));
    }
    accepted
  }

  fn fail(&self, error: Error) {
    self.fail_with_reason(AsyncRuntimeCancellationReason::Failed(error));
  }

  fn reject(&self, error: Error) {
    self.fail_with_reason(AsyncRuntimeCancellationReason::Rejected(error));
  }

  fn fail_with_reason(&self, reason: AsyncRuntimeCancellationReason) {
    let cancellation = {
      let mut inner = self
        .inner
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
      match inner.state {
        AsyncRuntimeSubmissionState::Submitting => {
          inner.state = AsyncRuntimeSubmissionState::Settled;
          inner.deferred_cancellation = None;
          inner.cancellation.take().map(|callback| (callback, reason))
        }
        AsyncRuntimeSubmissionState::Accepted
        | AsyncRuntimeSubmissionState::Started
        | AsyncRuntimeSubmissionState::Settled => None,
      }
    };
    if let Some((callback, reason)) = cancellation {
      self.drop_task_future_then(cancellation_after_future_drop(callback, reason));
    }
  }

  fn complete(&self) {
    let cancellation = {
      let mut inner = self
        .inner
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
      match inner.state {
        AsyncRuntimeSubmissionState::Started => {
          inner.state = AsyncRuntimeSubmissionState::Settled;
          inner.cancellation.take()
        }
        AsyncRuntimeSubmissionState::Submitting
        | AsyncRuntimeSubmissionState::Accepted
        | AsyncRuntimeSubmissionState::Settled => None,
      }
    };
    if let Some(cancellation) = cancellation {
      self.drop_task_future_then(discard_cancellation_after_future_drop(cancellation));
    }
  }

  fn claim_task_completion(
    &self,
    completion: AsyncRuntimeCompletion,
  ) -> std::result::Result<AsyncRuntimeAfterFutureDrop, AsyncRuntimeCompletion> {
    let cancellation = {
      let mut inner = self
        .inner
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
      match inner.state {
        AsyncRuntimeSubmissionState::Started => {
          inner.state = AsyncRuntimeSubmissionState::Settled;
          inner.cancellation.take()
        }
        AsyncRuntimeSubmissionState::Submitting
        | AsyncRuntimeSubmissionState::Accepted
        | AsyncRuntimeSubmissionState::Settled => None,
      }
    };
    if let Some(cancellation) = cancellation {
      Ok(Box::new(move || {
        run_task_completion(completion, cancellation);
      }))
    } else {
      Err(completion)
    }
  }
}

/// Runtime-owned task submitted through [`AsyncRuntime::spawn`].
///
/// The wrapper is intentionally opaque: it guarantees that rejection, environment teardown,
/// or backend-side task dropping runs the cancellation callback exactly once. Backends should
/// poll it like any other `Future<Output = ()>` and return it untouched when submission fails.
#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
pub struct AsyncRuntimeTask {
  future: Arc<AsyncRuntimeTaskFutureSlot>,
  cancel: Option<AsyncRuntimeCancellation>,
  submission: Option<Arc<AsyncRuntimeSubmission>>,
  env_task_registration: Option<EnvTaskRegistrationBinding>,
  submission_started: bool,
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
impl AsyncRuntimeTask {
  fn new(
    future: impl Future<Output = AsyncTaskOutcome> + Send + 'static,
    cancel: impl FnOnce(Option<Error>) + Send + 'static,
  ) -> Self {
    Self::new_with_cancellation_reason(future, move |reason| {
      cancel(reason.into_error());
    })
  }

  fn new_with_cancellation_reason(
    future: impl Future<Output = AsyncTaskOutcome> + Send + 'static,
    cancel: impl FnOnce(AsyncRuntimeCancellationReason) + Send + 'static,
  ) -> Self {
    Self {
      future: Arc::new(AsyncRuntimeTaskFutureSlot::new(future)),
      cancel: Some(Box::new(cancel)),
      submission: None,
      env_task_registration: None,
      submission_started: false,
    }
  }

  fn bind_env_task_registration(
    &mut self,
    registration: EnvTaskRegistration,
    binding: EnvTaskRegistrationBinding,
  ) {
    self.future.bind_env_task_registration(registration);
    binding.bind_future(&self.future);
    self.env_task_registration = Some(binding);
  }

  fn begin_submission(&mut self) -> Arc<AsyncRuntimeSubmission> {
    let cancellation = self
      .cancel
      .take()
      .expect("task cancellation is present until submission begins");
    let submission = Arc::new(AsyncRuntimeSubmission::new_task_with_reason(
      cancellation,
      &self.future,
    ));
    if let Some(registration) = &self.env_task_registration {
      registration.bind_submission(&submission);
    }
    self.submission = Some(Arc::clone(&submission));
    submission
  }

  fn cancel_and_drop(&mut self, error: Option<Error>) {
    let after_drop = self.claim_cancellation(error);
    self.future.drop_future_then(after_drop);
  }

  fn reject(mut self, error: Error) {
    self.cancel_and_drop(Some(error));
  }

  fn claim_completion(
    &mut self,
    completion: AsyncRuntimeCompletion,
  ) -> std::result::Result<AsyncRuntimeAfterFutureDrop, AsyncRuntimeCompletion> {
    let _operation = RuntimeOperationGuard::enter();
    self.submission_started = false;
    if let Some(submission) = self.submission.take() {
      submission.claim_task_completion(completion)
    } else if let Some(cancel) = self.cancel.take() {
      Ok(Box::new(move || {
        run_task_completion(completion, cancel);
      }))
    } else {
      Err(completion)
    }
  }

  fn claim_cancellation(&mut self, error: Option<Error>) -> Option<AsyncRuntimeAfterFutureDrop> {
    let _operation = RuntimeOperationGuard::enter();
    self.submission_started = false;
    if let Some(submission) = self.submission.take() {
      submission.claim_cancellation(error)
    } else {
      self.cancel.take().map(|cancel| {
        cancellation_after_future_drop(cancel, AsyncRuntimeCancellationReason::from_error(error))
      })
    }
  }
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
impl Future for AsyncRuntimeTask {
  type Output = ();

  fn poll(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output> {
    let _operation = RuntimeOperationGuard::enter();
    if !self.submission_started {
      let Some(submission) = self.submission.as_ref() else {
        return self.poll_inner(cx);
      };
      let start = std::panic::catch_unwind(AssertUnwindSafe(|| submission.start()));
      match start {
        Err(reason) => {
          submission.fail(crate::bindgen_runtime::panic_to_error(reason));
          self.cancel_and_drop(None);
          return Poll::Ready(());
        }
        Ok(false) => {
          self.cancel_and_drop(None);
          return Poll::Ready(());
        }
        Ok(true) => {
          self.submission_started = true;
        }
      }
    }
    self.poll_inner(cx)
  }
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
impl AsyncRuntimeTask {
  fn poll_inner(&mut self, cx: &mut Context<'_>) -> Poll<()> {
    let Some(mut future) = self.future.begin_poll() else {
      return Poll::Ready(());
    };
    let poll = std::panic::catch_unwind(AssertUnwindSafe(|| future.as_mut().poll(cx)));
    match poll {
      Err(reason) => {
        let after_drop =
          self.claim_cancellation(Some(crate::bindgen_runtime::panic_to_error(reason)));
        self.future.finish_terminal_poll(future, after_drop);
        Poll::Ready(())
      }
      Ok(Poll::Ready(AsyncTaskOutcome::Completed(completion))) => {
        let (after_drop, unclaimed_completion) = match self.claim_completion(completion) {
          Ok(after_drop) => (Some(after_drop), None),
          Err(completion) => (None, Some(completion)),
        };
        self.future.finish_terminal_poll(future, after_drop);
        if let Some(completion) = unclaimed_completion {
          drop_unclaimed_task_completion(completion);
        }
        Poll::Ready(())
      }
      Ok(Poll::Ready(AsyncTaskOutcome::Cancelled)) => {
        let after_drop = self.claim_cancellation(None);
        self.future.finish_terminal_poll(future, after_drop);
        Poll::Ready(())
      }
      Ok(Poll::Pending) if self.future.finish_pending_poll(future) => Poll::Pending,
      Ok(Poll::Pending) => {
        self.submission_started = false;
        Poll::Ready(())
      }
    }
  }
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
impl Drop for AsyncRuntimeTask {
  fn drop(&mut self) {
    self.cancel_and_drop(None);
  }
}

#[cfg(not(feature = "noop"))]
pub(crate) fn drop_safely<T>(value: T) {
  #[cfg(any(feature = "async-runtime", feature = "tokio_rt"))]
  let _operation = RuntimeOperationGuard::enter();
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

#[cfg(all(not(feature = "noop"), feature = "tokio_rt"))]
struct TokioFutureCancellation<F: FnOnce()>(Option<F>);

#[cfg(all(not(feature = "noop"), feature = "tokio_rt"))]
impl<F: FnOnce()> TokioFutureCancellation<F> {
  fn new(cancel: F) -> Self {
    Self(Some(cancel))
  }

  fn disarm(&mut self) {
    if let Some(cancel) = self.0.take() {
      drop_safely(cancel);
    }
  }
}

#[cfg(all(not(feature = "noop"), feature = "tokio_rt"))]
impl<F: FnOnce()> Drop for TokioFutureCancellation<F> {
  fn drop(&mut self) {
    if let Some(cancel) = self.0.take() {
      crate::bindgen_runtime::catch_unwind_safely(cancel);
    }
  }
}

#[cfg(all(not(feature = "noop"), feature = "tokio_rt"))]
fn settle_tokio_future<Cancel: FnOnce(), Settle: FnOnce()>(
  mut cancellation: TokioFutureCancellation<Cancel>,
  settle: Settle,
) {
  // Keep cancellation armed until JsDeferred has claimed and queued the terminal settlement.
  settle();
  cancellation.disarm();
}

#[cfg(all(not(feature = "noop"), feature = "tokio_rt"))]
fn tokio_generated_task(
  env: sys::napi_env,
  future: impl Future<Output = ()> + Send + 'static,
) -> impl Future<Output = ()> + Send + 'static {
  let (future, _) = registered_env_task_future(env, future);
  async move {
    let _ = future.await;
  }
}

#[cfg(all(
  test,
  not(feature = "noop"),
  feature = "tokio_rt",
  any(
    not(target_family = "wasm"),
    all(target_family = "wasm", tokio_unstable)
  )
))]
mod tokio_retirement_waiter_tests {
  use std::sync::{mpsc, Arc};
  use std::time::Duration;

  use super::*;

  thread_local! {
    static WORKER_TLS_RETIREMENT_PROBE:
      std::cell::RefCell<Option<WorkerTlsRetirementProbe>> = const {
        std::cell::RefCell::new(None)
      };
  }

  struct WorkerTlsRetirementProbe {
    waiter: TokioRuntimeRetirementWaiter,
    result: mpsc::Sender<Result<()>>,
  }

  impl Drop for WorkerTlsRetirementProbe {
    fn drop(&mut self) {
      let _ = self.result.send(self.waiter.wait());
    }
  }

  fn pending_waiter(
    generation: usize,
  ) -> (
    Arc<TokioRuntimeRetirementSignal>,
    TokioRuntimeRetirementWaiter,
  ) {
    let retirement = Arc::new(TokioRuntimeRetirementSignal::new(generation, None));
    let waiter = TokioRuntimeRetirementWaiter::new(Some(Arc::clone(&retirement)));
    (retirement, waiter)
  }

  #[test]
  fn retirement_waiter_blocks_without_holding_its_mutex_and_wakes_on_completion() {
    let (retirement, waiter) = pending_waiter(10_001);
    let (started_tx, started_rx) = mpsc::channel();
    let (result_tx, result_rx) = mpsc::channel();
    let thread = std::thread::spawn(move || {
      started_tx.send(()).unwrap();
      result_tx.send(waiter.wait()).unwrap();
    });

    started_rx.recv_timeout(Duration::from_secs(5)).unwrap();
    assert!(
      result_rx.recv_timeout(Duration::from_millis(50)).is_err(),
      "a pending retirement wait must block"
    );
    assert!(
      retirement.status.try_lock().is_ok(),
      "Condvar::wait must release the retirement mutex while blocked"
    );

    retirement.complete();
    result_rx
      .recv_timeout(Duration::from_secs(5))
      .expect("completion must wake the waiter")
      .unwrap();
    thread.join().unwrap();
  }

  #[test]
  fn supplied_runtime_waiter_never_blocks_while_retirement_is_pending() {
    let retirement = Arc::new(TokioRuntimeRetirementSignal::new_with_worker_tracking(
      10_018,
      None,
      Arc::new(TokioRuntimeWorkerTracker::default()),
      true,
    ));
    let waiter = TokioRuntimeRetirementWaiter::new(Some(Arc::clone(&retirement)));

    let error = waiter
      .wait()
      .expect_err("a supplied runtime waiter cannot safely classify the calling thread");
    assert_eq!(error.status, crate::Status::WouldDeadlock);
    assert!(error.reason.contains("untracked runtime threads"));

    let completion = Arc::clone(&retirement);
    let thread = std::thread::spawn(move || completion.complete());
    waiter
      .wait_for(Duration::from_secs(5))
      .expect("a bounded internal wait may observe supplied runtime retirement");
    thread.join().unwrap();
    waiter
      .wait()
      .expect("a completed supplied runtime retirement remains directly observable");
  }

  #[test]
  fn cancellation_through_a_clone_wakes_the_same_waiter() {
    let (_retirement, waiter) = pending_waiter(10_002);
    let cancellation = waiter.clone();
    let (started_tx, started_rx) = mpsc::channel();
    let (result_tx, result_rx) = mpsc::channel();
    let thread = std::thread::spawn(move || {
      started_tx.send(()).unwrap();
      result_tx.send(waiter.wait()).unwrap();
    });

    started_rx.recv_timeout(Duration::from_secs(5)).unwrap();
    assert!(
      result_rx.recv_timeout(Duration::from_millis(50)).is_err(),
      "the waiter must still be pending before cancellation"
    );
    cancellation.cancel();

    let error = result_rx
      .recv_timeout(Duration::from_secs(5))
      .expect("clone cancellation must wake the waiter")
      .expect_err("a cancelled waiter must return an error");
    assert_eq!(error.status, crate::Status::Cancelled);
    thread.join().unwrap();
  }

  #[test]
  fn cancellation_remains_effective_until_the_retirement_thread_is_joined() {
    let retirement = Arc::new(TokioRuntimeRetirementSignal::new(10_003, None));
    let waiter = TokioRuntimeRetirementWaiter::new(Some(Arc::clone(&retirement)));
    let cancellation = waiter.clone();
    let (retirement_complete_tx, retirement_complete_rx) = mpsc::channel();
    let (release_retirement_tx, release_retirement_rx) = mpsc::channel();

    retirement.begin_thread_spawn();
    let completion = Arc::clone(&retirement);
    let retirement_thread = std::thread::spawn(move || {
      completion.complete();
      retirement_complete_tx.send(()).unwrap();
      release_retirement_rx.recv().unwrap();
    });
    retirement.install_thread(retirement_thread);
    retirement_complete_rx
      .recv_timeout(Duration::from_secs(5))
      .expect("the retirement thread must publish completion");
    assert!(matches!(
      *retirement
        .status
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner),
      TokioRuntimeRetirementStatus::Complete
    ));

    let (started_tx, started_rx) = mpsc::channel();
    let (result_tx, result_rx) = mpsc::channel();
    let waiting_thread = std::thread::spawn(move || {
      started_tx.send(()).unwrap();
      result_tx.send(waiter.wait()).unwrap();
    });
    started_rx.recv_timeout(Duration::from_secs(5)).unwrap();
    assert!(
      result_rx.recv_timeout(Duration::from_millis(50)).is_err(),
      "completion alone must not let the waiter skip the blocked retirement thread"
    );

    cancellation.cancel();
    let error = result_rx
      .recv_timeout(Duration::from_secs(5))
      .expect("cancellation must wake a post-completion wait")
      .expect_err("the wait must remain cancellable until join");
    assert_eq!(error.status, crate::Status::Cancelled);
    waiting_thread.join().unwrap();

    release_retirement_tx.send(()).unwrap();
    let deadline = std::time::Instant::now() + Duration::from_secs(5);
    while !retirement.try_join_finished_thread().unwrap() {
      assert!(
        std::time::Instant::now() < deadline,
        "released retirement thread did not become joinable"
      );
      std::thread::yield_now();
    }
  }

  #[test]
  fn waiter_is_bound_to_one_generation_and_late_cancellation_is_a_noop() {
    let (first_retirement, waiter) = pending_waiter(10_004);
    let _later_retirement = TokioRuntimeRetirementSignal::new(10_005, None);

    first_retirement.complete();
    waiter.cancel();
    waiter.wait().unwrap();
    waiter.wait().unwrap();
  }

  #[test]
  fn retirement_wait_rejects_work_owned_by_the_same_generation() {
    let (_retirement, waiter) = pending_waiter(10_006);
    let _generation = TokioRuntimeGenerationGuard::enter(10_006);

    let error = waiter
      .wait()
      .expect_err("same-generation work must not wait for its own retirement");
    assert_eq!(error.status, crate::Status::WouldDeadlock);
  }

  #[test]
  fn retirement_wait_rejects_the_retirement_owner_thread() {
    let (retirement, waiter) = pending_waiter(10_007);
    retirement.mark_current_thread_as_retirement_owner();

    let error = waiter
      .wait()
      .expect_err("the retirement owner must not wait for itself to publish completion");
    assert_eq!(error.status, crate::Status::WouldDeadlock);
    assert!(error.reason.contains("retirement thread"));
  }

  #[test]
  fn terminal_retirement_wait_rejects_the_owner_even_while_another_waiter_is_joining() {
    for (generation, fail) in [(10_008, false), (10_009, true)] {
      let retirement = Arc::new(TokioRuntimeRetirementSignal::new(generation, None));
      retirement.mark_current_thread_as_retirement_owner();
      *retirement
        .thread
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner) = TokioRuntimeRetirementThread::Joining;
      if fail {
        retirement.fail("injected retirement failure".to_owned());
      } else {
        retirement.complete();
      }
      let waiter = TokioRuntimeRetirementWaiter::new(Some(Arc::clone(&retirement)));

      let error = waiter
        .wait()
        .expect_err("the retirement owner must reject terminal-state thread-exit waits");
      assert_eq!(error.status, crate::Status::WouldDeadlock);
      assert!(error.reason.contains("retirement thread"));

      *retirement
        .thread
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner) = TokioRuntimeRetirementThread::Joined;
    }
  }

  #[cfg(not(target_family = "wasm"))]
  #[test]
  fn current_thread_runtime_task_destructor_cannot_wait_on_its_retirement() {
    struct WaitOnDrop {
      waiter: TokioRuntimeRetirementWaiter,
      result: Option<mpsc::Sender<Result<()>>>,
    }

    impl Future for WaitOnDrop {
      type Output = ();

      fn poll(self: Pin<&mut Self>, _cx: &mut Context<'_>) -> Poll<Self::Output> {
        Poll::Pending
      }
    }

    impl Drop for WaitOnDrop {
      fn drop(&mut self) {
        if let Some(result) = self.result.take() {
          result.send(self.waiter.wait()).unwrap();
        }
      }
    }

    let retirement = Arc::new(TokioRuntimeRetirementSignal::new(10_010, None));
    let waiter = TokioRuntimeRetirementWaiter::new(Some(Arc::clone(&retirement)));
    let runtime = tokio::runtime::Builder::new_current_thread()
      .build()
      .unwrap();
    let (result_tx, result_rx) = mpsc::channel();
    drop(runtime.spawn(WaitOnDrop {
      waiter,
      result: Some(result_tx),
    }));

    let retirement_signal = Arc::clone(&retirement);
    let retirement_thread = std::thread::spawn(move || {
      drop(TokioRuntimeRetirement {
        runtime: Some(runtime),
        retirement: retirement_signal,
      });
    });

    let error = result_rx
      .recv_timeout(Duration::from_secs(5))
      .expect("the task destructor must not deadlock the retirement thread")
      .expect_err("the task destructor must reject a retirement self-wait");
    assert_eq!(error.status, crate::Status::WouldDeadlock);
    retirement_thread.join().unwrap();
    assert!(matches!(
      retirement.status(),
      TokioRuntimeRetirementStatus::Complete
    ));
  }

  #[cfg(not(target_family = "wasm"))]
  #[test]
  fn worker_registry_survives_until_tokio_worker_tls_destructors_finish() {
    let workers = Arc::new(TokioRuntimeWorkerTracker::default());
    let worker_start = Arc::clone(&workers);
    let runtime = tokio::runtime::Builder::new_multi_thread()
      .worker_threads(1)
      .on_thread_start(move || worker_start.register_current_thread())
      .build()
      .unwrap();
    let retirement = Arc::new(TokioRuntimeRetirementSignal::new_with_workers(
      10_011,
      Some(runtime.handle().id()),
      workers,
    ));
    let waiter = TokioRuntimeRetirementWaiter::new(Some(Arc::clone(&retirement)));
    let (armed_tx, armed_rx) = mpsc::channel();
    let (result_tx, result_rx) = mpsc::channel();

    drop(runtime.spawn(async move {
      WORKER_TLS_RETIREMENT_PROBE.with(|probe| {
        *probe.borrow_mut() = Some(WorkerTlsRetirementProbe {
          waiter,
          result: result_tx,
        });
      });
      armed_tx.send(()).unwrap();
      std::future::pending::<()>().await;
    }));
    armed_rx
      .recv_timeout(Duration::from_secs(5))
      .expect("the Tokio worker must arm its TLS destructor");

    let retirement_signal = Arc::clone(&retirement);
    let retirement_thread = std::thread::spawn(move || {
      drop(TokioRuntimeRetirement {
        runtime: Some(runtime),
        retirement: retirement_signal,
      });
    });
    let error = result_rx
      .recv_timeout(Duration::from_secs(5))
      .expect("the worker TLS destructor must not deadlock runtime retirement")
      .expect_err("a runtime worker must reject its own retirement wait");
    assert_eq!(error.status, crate::Status::WouldDeadlock);
    assert!(error.reason.contains("worker owned by that runtime"));
    retirement_thread.join().unwrap();
    assert!(matches!(
      retirement.status(),
      TokioRuntimeRetirementStatus::Complete
    ));
  }

  #[test]
  fn retirement_wait_rejects_unwrapped_work_on_the_same_tokio_runtime() {
    let runtime = tokio::runtime::Builder::new_current_thread()
      .build()
      .unwrap();
    let retirement = Arc::new(TokioRuntimeRetirementSignal::new(
      10_012,
      Some(runtime.handle().id()),
    ));
    let waiter = TokioRuntimeRetirementWaiter::new(Some(retirement));

    let error = runtime
      .block_on(async { waiter.wait() })
      .expect_err("same-runtime work must not wait for its own retirement");
    assert_eq!(error.status, crate::Status::WouldDeadlock);
  }

  #[test]
  fn retirement_wait_allows_an_unrelated_tokio_runtime() {
    let retiring_runtime = tokio::runtime::Builder::new_current_thread()
      .build()
      .unwrap();
    let caller_runtime = tokio::runtime::Builder::new_current_thread()
      .build()
      .unwrap();
    let retirement = Arc::new(TokioRuntimeRetirementSignal::new(
      10_013,
      Some(retiring_runtime.handle().id()),
    ));
    let waiter = TokioRuntimeRetirementWaiter::new(Some(Arc::clone(&retirement)));
    let completion = std::thread::spawn(move || {
      std::thread::sleep(Duration::from_millis(50));
      retirement.complete();
    });

    caller_runtime
      .block_on(async { waiter.wait() })
      .expect("an unrelated Tokio runtime cannot own the retiring generation");
    completion.join().unwrap();
  }

  #[test]
  fn retirement_thread_spawn_failure_is_terminal_and_does_not_drop_inline() {
    let retirement = Arc::new(TokioRuntimeRetirementSignal::new(10_013, None));
    let waiter = TokioRuntimeRetirementWaiter::new(Some(Arc::clone(&retirement)));
    let runtime = tokio::runtime::Builder::new_current_thread()
      .build()
      .unwrap();

    launch_tokio_runtime_retirement_with(runtime, retirement, |worker| {
      drop(worker);
      Err(std::io::Error::other("injected thread creation failure"))
    });

    let error = waiter
      .wait()
      .expect_err("thread creation failure must terminate the retirement wait");
    assert_eq!(error.status, crate::Status::GenericFailure);
    assert!(error.reason.contains("injected thread creation failure"));
  }

  #[test]
  fn runtime_drop_panic_is_a_terminal_retirement_failure() {
    let retirement = Arc::new(TokioRuntimeRetirementSignal::new(10_014, None));
    let waiter = TokioRuntimeRetirementWaiter::new(Some(Arc::clone(&retirement)));
    let runtime = tokio::runtime::Builder::new_current_thread()
      .build()
      .unwrap();
    let outer = tokio::runtime::Builder::new_current_thread()
      .build()
      .unwrap();

    std::thread::spawn(move || {
      outer.block_on(async move {
        drop(TokioRuntimeRetirement {
          runtime: Some(runtime),
          retirement,
        });
      });
    })
    .join()
    .unwrap();

    let error = waiter
      .wait()
      .expect_err("Runtime::drop panic must terminate the retirement wait");
    assert_eq!(error.status, crate::Status::GenericFailure);
    assert!(error.reason.contains("panicked while dropping"));
  }

  #[test]
  fn finished_retirement_thread_can_be_joined_without_blocking_restart() {
    let retirement = Arc::new(TokioRuntimeRetirementSignal::new(10_015, None));
    retirement.begin_thread_spawn();
    let completion = Arc::clone(&retirement);
    let thread = std::thread::spawn(move || completion.complete());
    retirement.install_thread(thread);

    let deadline = std::time::Instant::now() + Duration::from_secs(5);
    while !retirement.try_join_finished_thread().unwrap() {
      assert!(
        std::time::Instant::now() < deadline,
        "finished retirement thread did not become joinable"
      );
      std::thread::yield_now();
    }

    assert!(matches!(
      retirement.status(),
      TokioRuntimeRetirementStatus::Complete
    ));
  }

  #[test]
  fn pending_retirement_without_a_thread_is_not_ready_for_restart() {
    let retirement = TokioRuntimeRetirementSignal::new(10_016, None);

    assert!(!retirement.try_join_finished_thread().unwrap());
  }

  #[test]
  fn nonblocking_retirement_join_records_thread_panics() {
    let retirement = Arc::new(TokioRuntimeRetirementSignal::new(10_017, None));
    retirement.begin_thread_spawn();
    let completion = Arc::clone(&retirement);
    let thread = std::thread::spawn(move || {
      completion.complete();
      panic!("injected retirement thread panic");
    });
    retirement.install_thread(thread);

    let deadline = std::time::Instant::now() + Duration::from_secs(5);
    let error = loop {
      match retirement.try_join_finished_thread() {
        Ok(false) => {
          assert!(
            std::time::Instant::now() < deadline,
            "panicking retirement thread did not become joinable"
          );
          std::thread::yield_now();
        }
        Ok(true) => panic!("panicking retirement thread unexpectedly joined cleanly"),
        Err(error) => break error,
      }
    };

    assert!(error.reason.contains("injected retirement thread panic"));
    assert!(matches!(
      retirement.status(),
      TokioRuntimeRetirementStatus::Failed(_)
    ));
  }
}

#[cfg(all(
  test,
  not(feature = "noop"),
  feature = "tokio_rt",
  not(feature = "async-runtime")
))]
mod tokio_future_cancellation_tests {
  use std::sync::{
    atomic::{AtomicBool, AtomicUsize, Ordering},
    mpsc, Arc, Mutex,
  };
  use std::task::Context;
  use std::time::Duration;

  use super::*;
  use futures::task::ArcWake;

  static ENV_TASKS_TEST_LOCK: Mutex<()> = Mutex::new(());

  struct RuntimeSubmissionDrainObserverGuard;

  impl Drop for RuntimeSubmissionDrainObserverGuard {
    fn drop(&mut self) {
      RUNTIME_SUBMISSION_DRAIN_OBSERVER
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .take();
    }
  }

  fn observe_runtime_submission_drain() -> (mpsc::Receiver<()>, RuntimeSubmissionDrainObserverGuard)
  {
    let (entered_tx, entered_rx) = mpsc::channel();
    let mut observer = RUNTIME_SUBMISSION_DRAIN_OBSERVER
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner);
    assert!(
      observer.is_none(),
      "runtime submission drain observer must be installed by only one test"
    );
    *observer = Some(entered_tx);
    (entered_rx, RuntimeSubmissionDrainObserverGuard)
  }

  struct DropFlag(Arc<AtomicBool>);

  impl Drop for DropFlag {
    fn drop(&mut self) {
      self.0.store(true, Ordering::SeqCst);
    }
  }

  #[test]
  fn settlement_panic_runs_cancellation_once() {
    let cancellation_calls = Arc::new(AtomicUsize::new(0));
    let calls = Arc::clone(&cancellation_calls);
    let result = std::panic::catch_unwind(AssertUnwindSafe(|| {
      settle_tokio_future(
        TokioFutureCancellation::new(move || {
          calls.fetch_add(1, Ordering::SeqCst);
        }),
        || panic!("settlement panic"),
      );
    }));

    assert!(result.is_err());
    assert_eq!(cancellation_calls.load(Ordering::SeqCst), 1);
  }

  #[test]
  fn successful_settlement_disarms_cancellation() {
    let cancellation_calls = Arc::new(AtomicUsize::new(0));
    let calls = Arc::clone(&cancellation_calls);
    settle_tokio_future(
      TokioFutureCancellation::new(move || {
        calls.fetch_add(1, Ordering::SeqCst);
      }),
      || {},
    );

    assert_eq!(cancellation_calls.load(Ordering::SeqCst), 0);
  }

  #[test]
  fn environment_cleanup_only_cancels_its_generated_tokio_tasks() {
    let _guard = ENV_TASKS_TEST_LOCK
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner);
    let first_env = 0x1001usize as sys::napi_env;
    let second_env = 0x1002usize as sys::napi_env;
    register_runtime_env_tasks(first_env);
    register_runtime_env_tasks(second_env);

    let first_dropped = Arc::new(AtomicBool::new(false));
    let first_drop_flag = DropFlag(Arc::clone(&first_dropped));
    let mut first_task = Box::pin(tokio_generated_task(first_env, async move {
      let _drop_flag = first_drop_flag;
      std::future::pending::<()>().await;
    }));
    let second_dropped = Arc::new(AtomicBool::new(false));
    let second_drop_flag = DropFlag(Arc::clone(&second_dropped));
    let mut second_task = Box::pin(tokio_generated_task(second_env, async move {
      let _drop_flag = second_drop_flag;
      std::future::pending::<()>().await;
    }));
    let waker = futures::task::noop_waker();
    let mut context = Context::from_waker(&waker);

    assert!(first_task.as_mut().poll(&mut context).is_pending());
    assert!(second_task.as_mut().poll(&mut context).is_pending());

    let first_cleanup = cancel_runtime_env_tasks(first_env);
    assert!(first_task.as_mut().poll(&mut context).is_ready());
    first_cleanup.wait().unwrap();
    assert!(second_task.as_mut().poll(&mut context).is_pending());
    assert!(first_dropped.load(Ordering::SeqCst));
    assert!(!second_dropped.load(Ordering::SeqCst));

    let second_cleanup = cancel_runtime_env_tasks(second_env);
    assert!(second_task.as_mut().poll(&mut context).is_ready());
    second_cleanup.wait().unwrap();
    assert!(second_dropped.load(Ordering::SeqCst));
  }

  #[test]
  fn generated_tokio_task_rejects_a_closed_environment() {
    let _guard = ENV_TASKS_TEST_LOCK
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner);
    let env = 0x1003usize as sys::napi_env;
    register_runtime_env_tasks(env);
    let env_tasks = runtime_env_tasks(env);
    cancel_runtime_env_tasks(env).wait().unwrap();
    assert!(!runtime_env_is_open(&env_tasks));

    let dropped = Arc::new(AtomicBool::new(false));
    let drop_flag = DropFlag(Arc::clone(&dropped));
    let mut task = Box::pin(tokio_generated_task(env, async move {
      let _drop_flag = drop_flag;
      std::future::pending::<()>().await;
    }));
    let waker = futures::task::noop_waker();
    let mut context = Context::from_waker(&waker);

    assert!(task.as_mut().poll(&mut context).is_ready());
    assert!(dropped.load(Ordering::SeqCst));
  }

  #[test]
  fn runtime_shutdown_keeps_environment_registry_open_for_restart() {
    let _guard = ENV_TASKS_TEST_LOCK
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner);
    let env = 0x1004usize as sys::napi_env;
    register_runtime_env_tasks(env);
    let env_tasks = runtime_env_tasks(env);

    let first_dropped = Arc::new(AtomicBool::new(false));
    let first_drop_flag = DropFlag(Arc::clone(&first_dropped));
    let mut first_task = Box::pin(tokio_generated_task(env, async move {
      let _drop_flag = first_drop_flag;
      std::future::pending::<()>().await;
    }));
    let waker = futures::task::noop_waker();
    let mut context = Context::from_waker(&waker);
    assert!(first_task.as_mut().poll(&mut context).is_pending());

    cancel_all_env_tasks();
    assert!(runtime_env_is_open(&env_tasks));
    assert!(first_task.as_mut().poll(&mut context).is_ready());
    assert!(first_dropped.load(Ordering::SeqCst));

    let restarted_dropped = Arc::new(AtomicBool::new(false));
    let restarted_drop_flag = DropFlag(Arc::clone(&restarted_dropped));
    let mut restarted_task = Box::pin(tokio_generated_task(env, async move {
      let _drop_flag = restarted_drop_flag;
      std::future::pending::<()>().await;
    }));
    assert!(
      restarted_task.as_mut().poll(&mut context).is_pending(),
      "runtime shutdown must not permanently close a live environment's task registry"
    );

    let cleanup = cancel_runtime_env_tasks(env);
    assert!(restarted_task.as_mut().poll(&mut context).is_ready());
    cleanup.wait().unwrap();
    assert!(restarted_dropped.load(Ordering::SeqCst));
  }

  struct BlockingAbortWake {
    entered: Mutex<Option<mpsc::Sender<()>>>,
    release: Mutex<mpsc::Receiver<()>>,
  }

  impl ArcWake for BlockingAbortWake {
    fn wake_by_ref(arc_self: &Arc<Self>) {
      if let Some(entered) = arc_self
        .entered
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .take()
      {
        entered.send(()).unwrap();
      }
      arc_self
        .release
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .recv()
        .unwrap();
    }
  }

  #[test]
  fn pure_tokio_shutdown_serializes_handoff_and_cancellation() {
    let _guard = ENV_TASKS_TEST_LOCK
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner);
    try_start_async_runtime().expect("Tokio must be running before the handoff race");

    let (handoff_ready_tx, handoff_ready_rx) = mpsc::channel();
    let (spawn_tx, spawn_rx) = mpsc::channel();
    let (spawned_tx, spawned_rx) = mpsc::channel();
    let (release_permit_tx, release_permit_rx) = mpsc::channel();
    let runtime_user = std::thread::spawn(move || {
      let (runtime_use, runtime) = try_runtime().expect("runtime use must be admitted");
      handoff_ready_tx.send(()).unwrap();
      spawn_rx.recv().unwrap();
      drop(runtime.spawn(async {}));
      spawned_tx.send(()).unwrap();
      release_permit_rx.recv().unwrap();
      drop(runtime_use);
    });
    handoff_ready_rx
      .recv_timeout(Duration::from_secs(5))
      .expect("runtime use must pause before spawning");

    let (drain_entered_rx, _drain_observer) = observe_runtime_submission_drain();
    let (shutdown_result_tx, shutdown_result_rx) = mpsc::channel();
    let first_shutdown_result_tx = shutdown_result_tx.clone();
    let first_shutdown = std::thread::spawn(move || {
      first_shutdown_result_tx
        .send(try_shutdown_async_runtime())
        .unwrap();
    });
    drain_entered_rx
      .recv_timeout(Duration::from_secs(5))
      .expect("shutdown must enter the in-flight runtime submission drain");

    let operation_error = try_block_on(async {})
      .expect_err("new runtime work must reject after the admission gate closes");
    assert!(
      operation_error.reason.contains("not running"),
      "{operation_error}"
    );
    let start_error = try_start_async_runtime()
      .expect_err("explicit start must not report success while shutdown drains admission");
    assert_eq!(start_error.status, crate::Status::WouldDeadlock);
    assert!(
      start_error
        .reason
        .contains("another runtime transition is in progress"),
      "{start_error}"
    );

    let second_shutdown = std::thread::spawn(move || {
      shutdown_result_tx
        .send(try_shutdown_async_runtime())
        .unwrap();
    });
    let contention_error = shutdown_result_rx
      .recv_timeout(Duration::from_secs(5))
      .expect("one shutdown contender must observe transition ownership")
      .expect_err("the admitted handoff must keep the owning shutdown blocked");
    assert_eq!(contention_error.status, crate::Status::WouldDeadlock);
    assert!(
      contention_error
        .reason
        .contains("another runtime transition is in progress"),
      "{contention_error}"
    );
    assert!(
      matches!(
        shutdown_result_rx.try_recv(),
        Err(mpsc::TryRecvError::Empty)
      ),
      "the transition owner must wait for the admitted lease-to-spawn handoff"
    );
    spawn_tx.send(()).unwrap();
    spawned_rx
      .recv_timeout(Duration::from_secs(5))
      .expect("the admitted caller must finish spawning on its leased generation");
    assert!(
      matches!(
        shutdown_result_rx.try_recv(),
        Err(mpsc::TryRecvError::Empty)
      ),
      "shutdown must remain blocked until the handoff permit is released"
    );
    release_permit_tx.send(()).unwrap();
    runtime_user.join().unwrap();
    shutdown_result_rx
      .recv_timeout(Duration::from_secs(5))
      .expect("shutdown must resume after the handoff")
      .expect("handoff shutdown must succeed");
    first_shutdown.join().unwrap();
    second_shutdown.join().unwrap();
    tokio_runtime_retirement_waiter()
      .wait_for(Duration::from_secs(5))
      .expect("the handoff generation must retire");

    let env = 0x10ffusize as sys::napi_env;
    assert!(register_runtime_env_tasks(env));
    let (abort_handle, abort_registration) = AbortHandle::new_pair();
    let registration =
      register_env_task(env, abort_handle).expect("the abort handle must be registered");
    let (wake_entered_tx, wake_entered_rx) = mpsc::channel();
    let (release_wake_tx, release_wake_rx) = mpsc::channel();
    let wake = Arc::new(BlockingAbortWake {
      entered: Mutex::new(Some(wake_entered_tx)),
      release: Mutex::new(release_wake_rx),
    });
    let mut future = Box::pin(Abortable::new(
      std::future::pending::<()>(),
      abort_registration,
    ));
    let waker = futures::task::waker(wake);
    let mut context = Context::from_waker(&waker);
    assert!(future.as_mut().poll(&mut context).is_pending());

    let (stopped_shutdown_tx, stopped_shutdown_rx) = mpsc::channel();
    let stopped_shutdown = std::thread::spawn(move || {
      stopped_shutdown_tx
        .send(try_shutdown_async_runtime())
        .unwrap();
    });
    wake_entered_rx
      .recv_timeout(Duration::from_secs(5))
      .expect("stopped-runtime shutdown must begin aborting environment work");
    let error = try_start_async_runtime()
      .expect_err("restart must not overlap stopped-runtime task cancellation");
    assert_eq!(error.status, crate::Status::WouldDeadlock);
    assert!(
      error
        .reason
        .contains("another runtime transition is in progress"),
      "{error}"
    );

    release_wake_tx.send(()).unwrap();
    stopped_shutdown_rx
      .recv_timeout(Duration::from_secs(5))
      .expect("stopped-runtime shutdown must finish after cancellation wakes")
      .expect("stopped-runtime shutdown must succeed");
    stopped_shutdown.join().unwrap();
    assert!(future.as_mut().poll(&mut context).is_ready());
    drop(registration);
    cancel_runtime_env_tasks(env).wait().unwrap();

    try_start_async_runtime().expect("runtime must restart after serialized cancellation");
    try_shutdown_async_runtime().expect("restarted runtime must shut down");
    tokio_runtime_retirement_waiter()
      .wait_for(Duration::from_secs(5))
      .expect("restarted runtime must retire");
  }
}

/// Service-provider interface for plugging a custom async runtime into NAPI-RS.
///
/// The `async-runtime` feature exposes this SPI without by itself imposing a module-load
/// requirement. Implement this trait to back napi with your own scheduler (for example, a
/// single-threaded or WASI-friendly runtime) and register exactly one instance from
/// `#[module_init]`. A pure `async-runtime` addon with no registration can still load and expose
/// synchronous APIs; runtime-backed operations return a missing-backend error.
///
/// If no custom backend has been registered, the registration window closes when napi begins
/// activating the first Node-API environment, or earlier when a runtime-backed operation commits a
/// backend choice. In a combined `async-runtime` + `tokio_rt` build, that choice defaults current
/// generated `#[napi]` futures and current derive v4 `#[napi(async_runtime)]` entry guards to
/// built-in Tokio. The legacy napi-derive 3.5.9 synchronous guard instead uses the established
/// Tokio compatibility helper in combined builds, while its generated async exports follow this
/// selected backend. Selecting and starting a custom backend does not construct Tokio; the first
/// established Tokio compatibility helper call constructs it lazily after any previous generation
/// has retired. In a pure `async-runtime` build, a missing-backend error before any environment is
/// activated leaves selection undecided and does not prevent later registration.
///
/// Under the `noop` feature this SPI cannot be installed:
/// [`try_register_async_runtime`] safely retires the supplied backend and reports
/// [`crate::Status::InvalidArg`], while the infallible [`register_async_runtime`] wrapper retires
/// it and preserves its no-op result. Routed entry points are stubbed out
/// (e.g. `block_on` panics). The notes below about routing apply only to non-`noop` builds.
///
/// The explicit `spawn_on_custom_runtime`, `spawn_blocking_on_custom_runtime`,
/// `block_on_custom_runtime`, and `try_block_on_custom_runtime` helpers require a registered
/// custom backend in every non-`noop` `async-runtime` build. napi manufactures its own joinable
/// handle around
/// [`spawn`](AsyncRuntime::spawn), while both explicit spawn helpers report an immediate backend
/// decline separately from cancellation after acceptance. The established free `spawn`,
/// `spawn_blocking`, [`block_on`], and
/// [`within_runtime_if_available`] names remain Tokio compatibility APIs whenever `tokio_rt` is
/// enabled, so Cargo feature unification cannot silently change their signatures or routing.
/// On threadless `wasm32-wasip1`, the Tokio `spawn` and `spawn_blocking` compatibility helpers
/// panic immediately because that target has neither a background runtime driver nor native
/// threads; use the explicit custom-runtime helpers instead.
/// The hidden [`within_selected_async_runtime`] helper follows the generated-code selection and
/// enters built-in Tokio when a combined build selected Tokio. With a selected custom backend,
/// activation waits for any old Tokio generation to retire but does not construct a replacement.
/// Tokio helpers reject external work while that custom runtime is starting, stopping, or stopped;
/// the first helper call during a running lifecycle constructs Tokio lazily. Runtime hooks may
/// still use Tokio synchronously on the transition thread. Synchronous custom-runtime operations
/// are gated for their full duration as well:
/// shutdown waits for them to return, and external calls are rejected before startup, during
/// lifecycle transitions, and after shutdown. Lifecycle hooks may still use those operations
/// synchronously on the transition thread.
///
/// The implementation is stored once per linked addon image and shared across its threads, hence
/// the `Send + Sync + 'static` bound. During normal environment activation, native napi commits
/// permanent image retention after module registration succeeds. An explicit
/// `try_start_async_runtime` call made before registration retains the image before invoking the
/// backend's `start` hook, because that hook may publish work that outlives a failed module load.
/// The backend's [`Drop`] implementation is therefore not guaranteed to run;
/// [`shutdown`](AsyncRuntime::shutdown) is the sole resource-release and quiescence hook. Keep a
/// newly constructed backend dormant, create active resources in [`start`](AsyncRuntime::start),
/// and release them in `shutdown`. See [`register_async_runtime`] for duplicate registration
/// behavior.
///
/// Panic containment described by this API requires a `panic = "unwind"` build. With
/// `panic = "abort"`, including Rust's currently shipped `wasm32-wasip1` and
/// `wasm32-wasip1-threads` targets, `catch_unwind` cannot intercept a panic: generated async
/// functions may trap or abort before their JavaScript promise or Rust `JoinHandle` is settled.
///
/// # Safety
///
/// Node may unload an addon's native image immediately after its last environment cleanup
/// returns. Implementations must ensure that, after [`shutdown`](AsyncRuntime::shutdown) returns,
/// no backend-owned thread, task, closure, destructor, cancellation callback, or future Node-API
/// callback can execute code or access data from that image. This includes externally retained
/// [`Waker`](std::task::Waker) or [`RawWaker`](std::task::RawWaker) clones and any other task-owned
/// callback, function pointer, or vtable reference whose later wake, clone, or drop path could
/// enter addon code. This requirement applies to both `Ok` and `Err` returns. A backend that
/// cannot prove those references inert must keep the native image loaded itself or terminate the
/// process rather than return. If `shutdown` unwinds, napi retains the image on native targets and
/// aborts on WASI, where no loader handle can pin the callback table safely.
#[cfg(feature = "async-runtime")]
pub unsafe trait AsyncRuntime: Send + Sync + 'static {
  /// Submit a task to run to completion in the background.
  ///
  /// Return `Ok(())` only after taking ownership of the task. Return
  /// `Err(AsyncRuntimeRejection::new(task, error))` when the runtime is stopped, saturated, or
  /// otherwise unable to accept it. The error is surfaced through generated promise rejection or a
  /// `JoinError`. Dropping an accepted task invokes its cancellation callback, so shutdown
  /// implementations may cancel queued work by dropping it without leaving Rust joins or
  /// JavaScript promises pending forever. Generated promises distinguish an immediate submission
  /// rejection from a task dropped later during runtime shutdown. Never forget an accepted task:
  /// retain it until completion or drop it on cancellation.
  ///
  /// A backend may poll the task synchronously before this hook returns. The first poll commits
  /// ownership and may run user work immediately; after that point returning the task in an
  /// [`AsyncRuntimeRejection`] or panicking cannot roll back effects that already occurred. On
  /// unwind-enabled builds, napi already catches task panics. Poll the task directly and do not
  /// bypass its `Drop` implementation. napi marks every poll as a runtime operation, so lifecycle
  /// calls made recursively by task code return an error instead of waiting on the task itself.
  /// Terminal cancellation callbacks and future destructors receive the same protection, including
  /// when queued tasks are dropped unpolled on a runtime worker during shutdown.
  fn spawn(
    &self,
    task: AsyncRuntimeTask,
  ) -> std::result::Result<(), AsyncRuntimeRejection<AsyncRuntimeTask>>;

  /// Block the current thread, fully driving the pinned future to completion before
  /// returning.
  ///
  /// This backs `block_on_custom_runtime` and `try_block_on_custom_runtime` in every
  /// non-`noop` `async-runtime` build. In a pure `async-runtime` build the established
  /// [`block_on`] and `try_block_on` helpers delegate to the same backend; combined
  /// `async-runtime` + `tokio_rt` builds retain their established Tokio routing. napi stores the
  /// future's result through a side effect and verifies that it is present when this method
  /// returns. Return a backend-specific error if the drive cannot be started or completed. The
  /// fallible wrappers preserve that error and also report an `Ok(())` return before completion as
  /// an error; infallible wrappers panic on either failure. napi holds the runtime lifecycle open
  /// until this method returns, so a concurrent shutdown waits rather than tearing the backend down
  /// underneath it. Run the future to completion rather than returning on the first pending poll.
  /// The borrowed future must not be retained, moved to another thread, or accessed after this
  /// method returns. On either `Ok` or `Err`, the backend must stop accessing the borrowed future
  /// before returning.
  fn block_on(&self, future: Pin<&mut dyn Future<Output = ()>>) -> Result<()>;

  /// Enter the runtime context and return a guard that establishes it for the calling
  /// thread.
  ///
  /// napi calls this for generated `#[napi(async_runtime)]` functions when the custom backend was
  /// selected. The hidden [`within_selected_async_runtime`] helper follows the same selection and
  /// [`within_runtime_if_available`] delegates here only in pure `async-runtime` builds; combined
  /// builds retain its established Tokio routing. The returned guard MUST keep the runtime context
  /// active for the whole duration of the closure and tear it down on drop. Return a
  /// backend-specific error if the context cannot be entered. The runtime lifecycle remains open
  /// through guard destruction, so shutdown cannot overlap the entered context. The default
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
  /// Implement it idempotently. Return success only after the backend can accept tasks. A
  /// successful restart must not overlap worker resources from a retiring generation; wait
  /// for retirement or return an error and let the caller retry. Do not call napi's runtime
  /// registration or lifecycle functions recursively from this hook. If this returns an error,
  /// or panics on an unwind-enabled build, napi calls [`shutdown`](AsyncRuntime::shutdown) to roll
  /// back resources created by the partial start. With `panic = "abort"`, a panic traps or aborts
  /// before rollback can run. The default is a no-op.
  fn start(&self) -> Result<()> {
    Ok(())
  }

  /// Shut the runtime down.
  ///
  /// napi installs cleanup ownership for every Node environment, on native and wasm hosts, and
  /// calls this after the last live environment exits. An explicit `shutdown_async_runtime` call
  /// can also invoke this while environments remain live. Stop accepting work before returning
  /// and drop queued [`AsyncRuntimeTask`] values and queued
  /// [`spawn_blocking`](AsyncRuntime::spawn_blocking) closures so their promises and join handles
  /// are cancelled. Return `Ok(())` only after backend-owned worker threads, running tasks, and
  /// running blocking closures have fully quiesced: Node may unload a worker's addon image as soon
  /// as its environment cleanup returns. Do not wait for JavaScript callbacks triggered by
  /// cancellation, and do not call napi's runtime registration or lifecycle functions recursively
  /// from this hook. The hook must be idempotent and tolerate being called before `start`, after a
  /// partial failed `start`, and repeatedly without an intervening `start`. If this returns an
  /// error, the same quiescence guarantee still applies; napi keeps submissions closed and rejects
  /// restart until shutdown is retried successfully, preventing scheduler generations from
  /// overlapping.
  fn shutdown(&self) -> Result<()>;

  /// Optional hook: run `work` on the backend's blocking-capable lane.
  ///
  /// This backs `spawn_blocking_on_custom_runtime`. Return `Ok(())` once the work is
  /// accepted; the backend should run the closure exactly once on a thread where blocking is
  /// acceptable. Dropping accepted work, for example while shutting down, safely cancels the
  /// caller's join handle. Return `Err(AsyncRuntimeRejection::new(work, error))` to decline; the
  /// join handle completes as rejected with that diagnostic and napi does not create an unbounded
  /// fallback thread. Never forget accepted work: run it exactly once or drop it during
  /// cancellation. The default implementation declines with [`crate::Status::GenericFailure`].
  ///
  /// The backend may invoke the closure synchronously before this hook returns. Invocation commits
  /// ownership, so a later hook panic cannot replace the closure's result. On unwind-enabled
  /// builds, the closure is already wrapped in `catch_unwind` before it reaches this hook and a
  /// panic is surfaced as a `JoinError` through the caller's `JoinHandle`, so just run it rather
  /// than adding another panic layer. napi marks the closure invocation as a runtime operation, so
  /// recursive lifecycle calls return an error instead of waiting on the closure itself. Dropping
  /// queued work without invoking it receives the same protection around cancellation and every
  /// captured value's destructor.
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

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
static CUSTOM_ASYNC_RUNTIME: OnceLock<Box<dyn AsyncRuntime>> = OnceLock::new();

#[cfg(all(
  feature = "async-runtime",
  not(feature = "noop"),
  not(target_family = "wasm")
))]
static CUSTOM_ASYNC_RUNTIME_MODULE_RETAINED: AtomicBool = AtomicBool::new(false);

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
static CUSTOM_RUNTIME_SHUTDOWN_QUIESCENCE_UNPROVEN: AtomicBool = AtomicBool::new(false);

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
pub(crate) fn custom_runtime_shutdown_quiescence_unproven() -> bool {
  CUSTOM_RUNTIME_SHUTDOWN_QUIESCENCE_UNPROVEN.load(Ordering::Acquire)
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
const DUPLICATE_RUNTIME_ERROR: &str =
  "register_async_runtime was called more than once for the same addon image";

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
const LATE_RUNTIME_REGISTRATION_ERROR: &str = "register_async_runtime must be called before the \
  first Node-API environment begins activation or an earlier runtime-backed operation commits a \
  backend choice";

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum AsyncRuntimeSelection {
  Undecided,
  #[cfg(feature = "tokio_rt")]
  Tokio,
  Custom,
}

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
  auto_start_enabled: bool,
  selection_frozen: bool,
  selection: AsyncRuntimeSelection,
  state: RuntimeLifecycleState,
  registration_error: Option<String>,
  startup_error: Option<String>,
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
static RUNTIME_LIFECYCLE: (Mutex<RuntimeLifecycle>, Condvar) = (
  Mutex::new(RuntimeLifecycle {
    active_envs: 0,
    auto_start_enabled: true,
    selection_frozen: false,
    selection: AsyncRuntimeSelection::Undecided,
    state: RuntimeLifecycleState::Stopped,
    registration_error: None,
    startup_error: None,
  }),
  Condvar::new(),
);

#[cfg(all(
  not(feature = "noop"),
  any(feature = "async-runtime", feature = "tokio_rt")
))]
#[derive(Clone, Copy, PartialEq, Eq)]
enum RuntimeSubmissionState {
  NeverStarted,
  Open,
  Closed,
}

#[cfg(all(
  not(feature = "noop"),
  any(feature = "async-runtime", feature = "tokio_rt")
))]
struct RuntimeSubmissions {
  state: RuntimeSubmissionState,
  in_flight: usize,
}

#[cfg(all(
  not(feature = "noop"),
  any(feature = "async-runtime", feature = "tokio_rt")
))]
static RUNTIME_SUBMISSIONS: (Mutex<RuntimeSubmissions>, Condvar) = (
  Mutex::new(RuntimeSubmissions {
    state: RuntimeSubmissionState::NeverStarted,
    in_flight: 0,
  }),
  Condvar::new(),
);

#[cfg(all(
  test,
  not(feature = "noop"),
  feature = "tokio_rt",
  not(feature = "async-runtime")
))]
static RUNTIME_SUBMISSION_DRAIN_OBSERVER: Mutex<Option<std::sync::mpsc::Sender<()>>> =
  Mutex::new(None);

#[cfg(all(
  not(feature = "noop"),
  any(feature = "async-runtime", feature = "tokio_rt")
))]
thread_local! {
  static RUNTIME_SUBMISSION_DEPTH: Cell<usize> = const { Cell::new(0) };
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
thread_local! {
  static RUNTIME_TRANSITION_DEPTH: Cell<usize> = const { Cell::new(0) };
  static RUNTIME_HOOK_DEPTH: Cell<usize> = const { Cell::new(0) };
}

#[cfg(all(
  not(feature = "noop"),
  any(feature = "async-runtime", feature = "tokio_rt")
))]
thread_local! {
  static RUNTIME_TEARDOWN_DEPTH: Cell<usize> = const { Cell::new(0) };
  static RUNTIME_FINALIZER_ENV: Cell<Option<usize>> = const { Cell::new(None) };
}

#[cfg(all(
  not(feature = "noop"),
  any(feature = "async-runtime", feature = "tokio_rt")
))]
struct RuntimeTeardownGuard;

#[cfg(all(
  not(feature = "noop"),
  any(feature = "async-runtime", feature = "tokio_rt")
))]
impl RuntimeTeardownGuard {
  fn enter() -> Self {
    RUNTIME_TEARDOWN_DEPTH.with(|depth| depth.set(depth.get() + 1));
    Self
  }
}

#[cfg(all(
  not(feature = "noop"),
  any(feature = "async-runtime", feature = "tokio_rt")
))]
impl Drop for RuntimeTeardownGuard {
  fn drop(&mut self) {
    RUNTIME_TEARDOWN_DEPTH.with(|depth| depth.set(depth.get() - 1));
  }
}

#[cfg(all(
  not(feature = "noop"),
  any(feature = "async-runtime", feature = "tokio_rt")
))]
pub(crate) fn with_runtime_teardown_guard<T>(f: impl FnOnce() -> T) -> T {
  let _teardown = RuntimeTeardownGuard::enter();
  f()
}

#[cfg(all(
  not(feature = "noop"),
  any(feature = "async-runtime", feature = "tokio_rt")
))]
struct RuntimeFinalizerGuard {
  previous: Option<usize>,
}

#[cfg(all(
  not(feature = "noop"),
  any(feature = "async-runtime", feature = "tokio_rt")
))]
impl RuntimeFinalizerGuard {
  fn enter(env: sys::napi_env) -> Self {
    let previous = RUNTIME_FINALIZER_ENV.with(|current| current.replace(Some(env as usize)));
    Self { previous }
  }
}

#[cfg(all(
  not(feature = "noop"),
  any(feature = "async-runtime", feature = "tokio_rt")
))]
impl Drop for RuntimeFinalizerGuard {
  fn drop(&mut self) {
    RUNTIME_FINALIZER_ENV.with(|current| current.set(self.previous));
  }
}

#[cfg(all(
  not(feature = "noop"),
  any(feature = "async-runtime", feature = "tokio_rt")
))]
pub(crate) fn with_runtime_finalizer_guard<T>(env: sys::napi_env, f: impl FnOnce() -> T) -> T {
  let _finalizer = RuntimeFinalizerGuard::enter(env);
  f()
}

#[cfg(all(
  not(feature = "noop"),
  any(feature = "async-runtime", feature = "tokio_rt")
))]
fn ensure_explicit_runtime_transition_allowed() -> Result<()> {
  if RUNTIME_TEARDOWN_DEPTH.with(Cell::get) != 0 {
    return Err(Error::new(
      crate::Status::GenericFailure,
      "Cannot transition the async runtime during N-API cleanup or finalization",
    ));
  }
  if RUNTIME_SUBMISSION_DEPTH.with(Cell::get) != 0 {
    return Err(Error::new(
      crate::Status::GenericFailure,
      "Cannot transition the async runtime from inside an AsyncRuntime operation",
    ));
  }
  Ok(())
}

#[cfg(all(
  not(feature = "noop"),
  any(feature = "async-runtime", feature = "tokio_rt")
))]
fn runtime_finalizer_env() -> Option<usize> {
  RUNTIME_FINALIZER_ENV.with(Cell::get)
}

#[cfg(all(
  not(feature = "noop"),
  any(feature = "async-runtime", feature = "tokio_rt")
))]
fn runtime_finalizer_without_owner_error() -> Error {
  Error::new(
    crate::Status::GenericFailure,
    "Cannot transition the async runtime during N-API cleanup or finalization",
  )
}

#[cfg(all(
  not(feature = "noop"),
  any(feature = "async-runtime", feature = "tokio_rt")
))]
pub(crate) struct RuntimeOperationGuard;

#[cfg(all(
  not(feature = "noop"),
  any(feature = "async-runtime", feature = "tokio_rt")
))]
impl RuntimeOperationGuard {
  pub(crate) fn enter() -> Self {
    RUNTIME_SUBMISSION_DEPTH.with(|depth| depth.set(depth.get() + 1));
    Self
  }
}

#[cfg(all(
  not(feature = "noop"),
  any(feature = "async-runtime", feature = "tokio_rt")
))]
impl Drop for RuntimeOperationGuard {
  fn drop(&mut self) {
    RUNTIME_SUBMISSION_DEPTH.with(|depth| depth.set(depth.get() - 1));
  }
}

#[cfg(all(
  not(feature = "noop"),
  any(feature = "async-runtime", feature = "tokio_rt")
))]
/// Keeps runtime use from overlapping a lifecycle transition. Submission hooks hold it only while
/// ownership is transferred; synchronous operations hold it until the future or entered callback
/// and its guard have finished.
struct RuntimeUsePermit {
  _operation: RuntimeOperationGuard,
}

#[cfg(all(
  not(feature = "noop"),
  any(feature = "async-runtime", feature = "tokio_rt")
))]
impl RuntimeUsePermit {
  fn acquire() -> Option<Self> {
    #[cfg(feature = "async-runtime")]
    let lifecycle = runtime_lifecycle();
    let mut submissions = RUNTIME_SUBMISSIONS
      .0
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner);
    if submissions.state != RuntimeSubmissionState::Open {
      return None;
    }
    #[cfg(feature = "async-runtime")]
    if lifecycle.registration_error.is_some() || lifecycle.state != RuntimeLifecycleState::Running {
      return None;
    }
    submissions.in_flight += 1;
    Some(Self {
      _operation: RuntimeOperationGuard::enter(),
    })
  }

  #[cfg(feature = "async-runtime")]
  fn acquire_synchronous() -> Option<Self> {
    let hook_local_transition =
      RUNTIME_HOOK_DEPTH.with(Cell::get) != 0 && RUNTIME_SUBMISSION_DEPTH.with(Cell::get) == 0;
    let lifecycle = runtime_lifecycle();
    let mut submissions = RUNTIME_SUBMISSIONS
      .0
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner);
    if lifecycle.registration_error.is_some()
      || (!hook_local_transition
        && (submissions.state != RuntimeSubmissionState::Open
          || lifecycle.state != RuntimeLifecycleState::Running))
    {
      return None;
    }
    submissions.in_flight += 1;
    Some(Self {
      _operation: RuntimeOperationGuard::enter(),
    })
  }
}

#[cfg(all(
  not(feature = "noop"),
  any(feature = "async-runtime", feature = "tokio_rt")
))]
impl Drop for RuntimeUsePermit {
  fn drop(&mut self) {
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

#[cfg(all(
  not(feature = "noop"),
  any(feature = "async-runtime", feature = "tokio_rt")
))]
fn open_runtime_submissions() {
  RUNTIME_SUBMISSIONS
    .0
    .lock()
    .unwrap_or_else(std::sync::PoisonError::into_inner)
    .state = RuntimeSubmissionState::Open;
}

#[cfg(all(
  not(feature = "noop"),
  any(feature = "async-runtime", feature = "tokio_rt")
))]
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
    #[cfg(all(test, feature = "tokio_rt", not(feature = "async-runtime")))]
    if let Some(observer) = RUNTIME_SUBMISSION_DRAIN_OBSERVER
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner)
      .take()
    {
      let _ = observer.send(());
    }
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
fn runtime_transition_in_progress_error() -> Error {
  Error::new(
    crate::Status::WouldDeadlock,
    "An async runtime lifecycle transition is already in progress",
  )
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
fn missing_custom_runtime_error() -> Error {
  Error::new(
    crate::Status::GenericFailure,
    "No AsyncRuntime backend is registered. Call \
     napi::bindgen_prelude::register_async_runtime(...) from a module_init hook before using \
     async-runtime-backed APIs",
  )
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
fn select_runtime_for_environment(lifecycle: &mut RuntimeLifecycle) {
  if lifecycle.selection != AsyncRuntimeSelection::Undecided {
    return;
  }
  if CUSTOM_ASYNC_RUNTIME.get().is_some() {
    lifecycle.selection = AsyncRuntimeSelection::Custom;
  } else {
    #[cfg(feature = "tokio_rt")]
    {
      lifecycle.selection = AsyncRuntimeSelection::Tokio;
    }
  }
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
fn select_runtime_for_use(lifecycle: &mut RuntimeLifecycle) -> Result<AsyncRuntimeSelection> {
  select_runtime_for_environment(lifecycle);
  if lifecycle.selection == AsyncRuntimeSelection::Undecided {
    Err(missing_custom_runtime_error())
  } else {
    Ok(lifecycle.selection)
  }
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
struct RuntimeHookGuard;

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
impl RuntimeHookGuard {
  fn enter() -> Self {
    RUNTIME_HOOK_DEPTH.with(|depth| depth.set(depth.get() + 1));
    Self
  }
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
impl Drop for RuntimeHookGuard {
  fn drop(&mut self) {
    RUNTIME_HOOK_DEPTH.with(|depth| depth.set(depth.get() - 1));
  }
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
fn custom_async_runtime() -> Result<&'static dyn AsyncRuntime> {
  CUSTOM_ASYNC_RUNTIME
    .get()
    .map(Box::as_ref)
    .ok_or_else(missing_custom_runtime_error)
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
fn custom_async_runtime_for_use() -> Result<&'static dyn AsyncRuntime> {
  if let Some(message) = &runtime_lifecycle().registration_error {
    return Err(Error::new(crate::Status::GenericFailure, message.clone()));
  }
  custom_async_runtime()
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
fn acquire_synchronous_runtime_use() -> Result<RuntimeUsePermit> {
  RuntimeUsePermit::acquire_synchronous().ok_or_else(runtime_unavailable_error)
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
fn acquire_runtime_use() -> Result<RuntimeUsePermit> {
  RuntimeUsePermit::acquire().ok_or_else(runtime_unavailable_error)
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
fn runtime_unavailable_error() -> Error {
  let lifecycle = runtime_lifecycle();
  if let Some(message) = &lifecycle.registration_error {
    return Error::new(crate::Status::GenericFailure, message.clone());
  }
  if let Some(message) = &lifecycle.startup_error {
    return Error::new(crate::Status::GenericFailure, message.clone());
  }
  if lifecycle.selection == AsyncRuntimeSelection::Undecided {
    return missing_custom_runtime_error();
  }
  Error::new(
    crate::Status::GenericFailure,
    "The async runtime is not running",
  )
}

/// Register the custom [`AsyncRuntime`] backend for this linked addon image.
///
/// Call this once from `#[module_init]`. That hook is a library constructor and runs before napi
/// owns a Node-API environment, so registration only publishes a dormant backend. Runtime-backed
/// APIs become available after environment activation or an explicit runtime start calls
/// [`AsyncRuntime::start`].
///
/// Registration is once per linked addon image. Duplicate or late registration records a
/// module-load error when this infallible wrapper is used during initialization. The fallible
/// [`try_register_async_runtime`] form returns the error directly. napi invokes
/// [`AsyncRuntime::shutdown`] before dropping a rejected backend, because the unsafe
/// [`AsyncRuntime`] contract does not permit assuming that `Drop` quiesces backend work. If that
/// shutdown panics, native builds retain the addon image and leak the backend; WASI builds abort
/// because they cannot pin callback code safely.
///
/// During normal environment activation on native targets, napi commits the backend's permanent
/// addon-image retention only after the enclosing Node-API module registration succeeds. A failed
/// load is not retained solely because it registered a dormant backend, though other unload-safety
/// mechanisms may still retain an image that published callbacks or handles before failing.
/// Explicit startup before module registration retains the image before calling
/// [`AsyncRuntime::start`]. A successfully exported backend remains reusable across zero-environment
/// shutdown/start cycles, and its `Drop` implementation is not guaranteed to run. Construct it
/// without starting threads or other active resources; acquire those in `start` and release them in
/// [`AsyncRuntime::shutdown`].
#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
pub fn register_async_runtime<R: AsyncRuntime>(runtime: R) {
  if let Err(error) = try_register_async_runtime(runtime) {
    let mut lifecycle = runtime_lifecycle();
    if matches!(
      error.reason.as_str(),
      DUPLICATE_RUNTIME_ERROR | LATE_RUNTIME_REGISTRATION_ERROR
    ) {
      lifecycle.registration_error = Some(error.reason);
    } else {
      lifecycle.startup_error = Some(error.reason);
    }
  }
}

/// Try to register a custom async runtime without panicking.
///
/// Library constructors should normally use [`register_async_runtime`], which defers reporting
/// until Node provides an environment where napi can throw a JavaScript exception. Registration
/// after napi begins activating an environment or an earlier runtime-backed operation commits a
/// backend choice returns an error and safely shuts down the rejected backend. A missing-backend
/// error before any environment is activated does not freeze registration.
#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
pub fn try_register_async_runtime<R: AsyncRuntime>(runtime: R) -> Result<()> {
  let mut runtime: Option<Box<dyn AsyncRuntime>> = Some(Box::new(runtime));
  let registration_error = {
    let mut lifecycle = runtime_lifecycle();
    let registration_error = if CUSTOM_ASYNC_RUNTIME.get().is_some() {
      Some(DUPLICATE_RUNTIME_ERROR)
    } else if lifecycle.selection_frozen
      || lifecycle.selection != AsyncRuntimeSelection::Undecided
      || lifecycle.active_envs != 0
      || lifecycle.state != RuntimeLifecycleState::Stopped
    {
      Some(LATE_RUNTIME_REGISTRATION_ERROR)
    } else {
      None
    };
    match publish_async_runtime_if_eligible(
      runtime
        .take()
        .expect("custom runtime is present until registration"),
      registration_error,
      |runtime| CUSTOM_ASYNC_RUNTIME.set(runtime),
    ) {
      Ok(()) => {
        lifecycle.selection = AsyncRuntimeSelection::Custom;
        None
      }
      Err((rejected, reason)) => {
        runtime = Some(rejected);
        Some(reason)
      }
    }
  };

  if let Some(reason) = registration_error {
    let _operation = RuntimeOperationGuard::enter();
    retire_rejected_async_runtime(
      runtime.expect("rejected custom runtime remains owned by the registering caller"),
    );
    return Err(Error::new(crate::Status::GenericFailure, reason));
  }

  Ok(())
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
fn publish_async_runtime_if_eligible<T>(
  runtime: T,
  registration_error: Option<&'static str>,
  publish: impl FnOnce(T) -> std::result::Result<(), T>,
) -> std::result::Result<(), (T, &'static str)> {
  if let Some(reason) = registration_error {
    return Err((runtime, reason));
  }
  publish(runtime).map_err(|runtime| (runtime, DUPLICATE_RUNTIME_ERROR))
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
pub(crate) fn commit_async_runtime_module_retention() {
  #[cfg(not(target_family = "wasm"))]
  if CUSTOM_ASYNC_RUNTIME.get().is_some() {
    retain_custom_async_runtime_module_once();
  }
}

#[cfg(all(
  feature = "async-runtime",
  not(feature = "noop"),
  not(target_family = "wasm")
))]
fn retain_custom_async_runtime_module_once() {
  if CUSTOM_ASYNC_RUNTIME_MODULE_RETAINED
    .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
    .is_ok()
  {
    crate::bindgen_runtime::retain_current_module_for_unload_safety();
  }
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
fn retire_rejected_async_runtime(runtime: Box<dyn AsyncRuntime>) {
  match std::panic::catch_unwind(AssertUnwindSafe(|| runtime.shutdown())) {
    Ok(result) => {
      if let Err(error) = result {
        crate::bindgen_runtime::catch_unwind_safely(|| {
          eprintln!("Rejected AsyncRuntime shutdown returned an error: {error}");
        });
      }
      // The unsafe contract requires quiescence for both Ok and Err returns.
      drop_safely(runtime);
    }
    Err(payload) => {
      let error = crate::bindgen_runtime::panic_to_error(payload);
      crate::bindgen_runtime::catch_unwind_safely(|| {
        eprintln!("Rejected AsyncRuntime shutdown panicked: {error}");
      });
      #[cfg(not(target_family = "wasm"))]
      {
        crate::bindgen_runtime::retain_current_module_for_unload_safety();
        // Shutdown did not return, so neither quiescence nor destructor safety
        // is proven. Keep both the image and backend state alive.
        std::mem::forget(runtime);
      }
      #[cfg(target_family = "wasm")]
      {
        std::mem::forget(runtime);
        // WASI has no loader handle that can retain code reached by surviving
        // backend work after a panicking shutdown.
        std::process::abort();
      }
    }
  }
}

#[cfg(all(feature = "async-runtime", feature = "noop"))]
/// Retire a custom runtime supplied to a `noop` build.
///
/// `noop` builds cannot install an executor. This infallible compatibility wrapper preserves its
/// historical no-op result after safely calling [`AsyncRuntime::shutdown`] and dropping the
/// backend. Use [`try_register_async_runtime`] when the caller must detect unsupported
/// registration.
pub fn register_async_runtime<R: AsyncRuntime>(runtime: R) {
  let _ = try_register_async_runtime(runtime);
}

#[cfg(all(feature = "async-runtime", feature = "noop"))]
/// Retire and reject a custom runtime supplied to a `noop` build.
///
/// The backend is shut down and dropped before this returns
/// [`crate::Status::InvalidArg`].
pub fn try_register_async_runtime<R: AsyncRuntime>(runtime: R) -> Result<()> {
  match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| runtime.shutdown())) {
    Ok(_) => {
      if std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| drop(runtime))).is_err() {
        // A noop build has no loader-retention support. Returning after a
        // destructor panic could leave backend-owned code reachable.
        std::process::abort();
      }
    }
    Err(_) => {
      // Shutdown did not return, so the unsafe AsyncRuntime contract gives no
      // proof that backend-owned work is quiescent.
      std::mem::forget(runtime);
      std::process::abort();
    }
  }
  Err(Error::new(
    crate::Status::InvalidArg,
    "Cannot install a custom async runtime in a noop build",
  ))
}

/// Deprecated alias for [`register_async_runtime`].
#[cfg(feature = "async-runtime")]
#[deprecated(note = "use `register_async_runtime`")]
pub fn create_custom_async_runtime<R: AsyncRuntime>(runtime: R) {
  register_async_runtime(runtime);
}

/// Deprecated alias for [`try_register_async_runtime`].
#[cfg(feature = "async-runtime")]
#[deprecated(note = "use `try_register_async_runtime`")]
pub fn try_create_custom_async_runtime<R: AsyncRuntime>(runtime: R) -> Result<()> {
  try_register_async_runtime(runtime)
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
pub(crate) fn reserve_async_runtime_env() -> Result<()> {
  let mut lifecycle = wait_for_runtime_transition(runtime_lifecycle())?;
  lifecycle.active_envs = lifecycle.active_envs.checked_add(1).unwrap_or_else(|| {
    // Wrapping would make a live environment indistinguishable from no
    // environments and permit runtime shutdown under active work.
    std::process::abort();
  });
  Ok(())
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
pub(crate) fn activate_async_runtime_env() -> Result<()> {
  let selection = {
    let mut lifecycle = wait_for_runtime_transition(runtime_lifecycle())?;
    if lifecycle.active_envs == 0 {
      return Err(Error::new(
        crate::Status::GenericFailure,
        "Cannot activate an async runtime without a registered Node-API environment",
      ));
    }
    lifecycle.selection_frozen = true;
    select_runtime_for_environment(&mut lifecycle);
    lifecycle.selection
  };
  if selection == AsyncRuntimeSelection::Undecided {
    return Ok(());
  }
  retry_failed_automatic_runtime_shutdown()?;
  try_start_selected_runtime(RuntimeStartReason::Environment)
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
fn retry_failed_automatic_runtime_shutdown() -> Result<()> {
  let selection = {
    let mut lifecycle = wait_for_runtime_transition(runtime_lifecycle())?;
    if lifecycle.state == RuntimeLifecycleState::ShutdownFailed
      && lifecycle.auto_start_enabled
      && lifecycle.active_envs != 0
    {
      lifecycle.state = RuntimeLifecycleState::Stopping;
      Some(lifecycle.selection)
    } else {
      None
    }
  };
  if let Some(selection) = selection {
    finish_selected_runtime_shutdown(selection, selection == AsyncRuntimeSelection::Custom)?;
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
  if lifecycle.selection != AsyncRuntimeSelection::Undecided
    && lifecycle.state != RuntimeLifecycleState::Running
    && lifecycle.auto_start_enabled
  {
    return Err(Error::new(
      crate::Status::GenericFailure,
      "The selected async runtime backend did not start",
    ));
  }
  Ok(())
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
pub(crate) fn rollback_unowned_async_runtime_after_registration_failure() -> Result<()> {
  rollback_unowned_async_runtime_after_registration_failure_with_retirement(|| {})
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
pub(crate) fn rollback_unowned_async_runtime_after_registration_failure_with_retirement(
  retirement: impl FnOnce(),
) -> Result<()> {
  let mut retirement = Some(retirement);
  let transition = {
    let mut lifecycle = match wait_for_runtime_transition(runtime_lifecycle()) {
      Ok(lifecycle) => lifecycle,
      Err(error) => {
        retirement
          .take()
          .expect("runtime registration retirement runs exactly once")();
        return Err(error);
      }
    };
    let previous_state = lifecycle.state;
    let previous_error = lifecycle.startup_error.clone();
    let shutdown_runtime =
      lifecycle.active_envs == 0 && previous_state == RuntimeLifecycleState::Running;
    lifecycle.state = RuntimeLifecycleState::Stopping;
    (
      previous_state,
      previous_error,
      lifecycle.selection,
      shutdown_runtime,
    )
  };
  let (previous_state, previous_error, selection, shutdown_runtime) = transition;
  if shutdown_runtime {
    finish_selected_runtime_shutdown_with_retirement(
      selection,
      selection == AsyncRuntimeSelection::Custom,
      retirement
        .take()
        .expect("runtime registration retirement runs exactly once"),
    )
  } else {
    finish_runtime_retirement_without_shutdown(
      previous_state,
      previous_error,
      retirement
        .take()
        .expect("runtime registration retirement runs exactly once"),
    )
  }
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
pub(crate) fn unregister_async_runtime_env_with_retirement(
  retirement: impl FnOnce(),
) -> Result<()> {
  let mut retirement = Some(retirement);
  let transition = {
    let mut lifecycle = match wait_for_runtime_transition(runtime_lifecycle()) {
      Ok(lifecycle) => lifecycle,
      Err(error) => {
        retirement
          .take()
          .expect("runtime environment retirement runs exactly once")();
        return Err(error);
      }
    };
    let had_active_env = lifecycle.active_envs != 0;
    if had_active_env {
      lifecycle.active_envs -= 1;
    }
    let remaining_envs = lifecycle.active_envs;
    let previous_state = lifecycle.state;
    let previous_error = lifecycle.startup_error.clone();
    let shutdown_runtime =
      had_active_env && remaining_envs == 0 && previous_state == RuntimeLifecycleState::Running;
    // Every paired environment/module retirement is one visible transition.
    // Registration/finalizer paths may acquire the environment registry before
    // this mutex, so retirement must publish Stopping and release this mutex
    // before its callback acquires that registry.
    lifecycle.state = RuntimeLifecycleState::Stopping;
    (
      previous_state,
      previous_error,
      lifecycle.selection,
      shutdown_runtime,
    )
  };
  let (previous_state, previous_error, selection, shutdown_runtime) = transition;
  if shutdown_runtime {
    finish_selected_runtime_shutdown_with_retirement(
      selection,
      selection == AsyncRuntimeSelection::Custom,
      retirement
        .take()
        .expect("runtime environment retirement runs exactly once"),
    )
  } else {
    // Non-last cleanup and cleanup after a prior explicit/failed shutdown do
    // not stop the selected backend. Keep explicit lifecycle calls excluded
    // until the paired module count has retired, then restore the stable state.
    finish_runtime_retirement_without_shutdown(
      previous_state,
      previous_error,
      retirement
        .take()
        .expect("runtime environment retirement runs exactly once"),
    )
  }
}

#[cfg(all(
  not(feature = "noop"),
  any(feature = "async-runtime", feature = "tokio_rt")
))]
struct EnvTasks {
  closed: AtomicBool,
  next_id: AtomicUsize,
  entries: Mutex<HashMap<usize, EnvTaskEntry>>,
  quiescence: Condvar,
  #[cfg(any(
    target_family = "wasm",
    all(test, feature = "async-runtime", not(feature = "tokio_rt"))
  ))]
  next_owner_settlement_id: AtomicUsize,
  #[cfg(any(
    target_family = "wasm",
    all(test, feature = "async-runtime", not(feature = "tokio_rt"))
  ))]
  owner_settlements: Mutex<HashMap<usize, RuntimeEnvOwnerSettlementAction>>,
}

#[cfg(all(
  not(feature = "noop"),
  any(feature = "async-runtime", feature = "tokio_rt"),
  any(
    target_family = "wasm",
    all(test, feature = "async-runtime", not(feature = "tokio_rt"))
  )
))]
type RuntimeEnvOwnerSettlementAction = Box<dyn FnOnce() + Send + 'static>;

#[cfg(all(
  not(feature = "noop"),
  any(feature = "async-runtime", feature = "tokio_rt")
))]
struct EnvTaskEntry {
  abort_handle: Option<AbortHandle>,
  #[cfg(feature = "async-runtime")]
  task_future: Option<Weak<AsyncRuntimeTaskFutureSlot>>,
  #[cfg(feature = "async-runtime")]
  task_submission: Option<Weak<AsyncRuntimeSubmission>>,
}

#[cfg(all(
  not(feature = "noop"),
  any(feature = "async-runtime", feature = "tokio_rt")
))]
struct EnvTaskCancellation {
  abort_handle: Option<AbortHandle>,
  #[cfg(feature = "async-runtime")]
  task_future: Option<Weak<AsyncRuntimeTaskFutureSlot>>,
  #[cfg(feature = "async-runtime")]
  task_submission: Option<Weak<AsyncRuntimeSubmission>>,
}

#[cfg(all(
  not(feature = "noop"),
  any(feature = "async-runtime", feature = "tokio_rt")
))]
impl EnvTasks {
  fn new() -> Self {
    Self {
      closed: AtomicBool::new(false),
      next_id: AtomicUsize::new(1),
      entries: Mutex::new(HashMap::new()),
      quiescence: Condvar::new(),
      #[cfg(any(
        target_family = "wasm",
        all(test, feature = "async-runtime", not(feature = "tokio_rt"))
      ))]
      next_owner_settlement_id: AtomicUsize::new(1),
      #[cfg(any(
        target_family = "wasm",
        all(test, feature = "async-runtime", not(feature = "tokio_rt"))
      ))]
      owner_settlements: Mutex::new(HashMap::new()),
    }
  }

  fn register(&self, abort_handle: AbortHandle) -> Option<usize> {
    if self.closed.load(Ordering::Acquire) {
      abort_safely(abort_handle);
      return None;
    }
    let mut entries = self
      .entries
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner);
    if self.closed.load(Ordering::Acquire) {
      drop(entries);
      abort_safely(abort_handle);
      return None;
    }
    let id = loop {
      let id = self.next_id.fetch_add(1, Ordering::Relaxed);
      if id == 0 {
        continue;
      }
      if let std::collections::hash_map::Entry::Vacant(entry) = entries.entry(id) {
        entry.insert(EnvTaskEntry {
          abort_handle: Some(abort_handle),
          #[cfg(feature = "async-runtime")]
          task_future: None,
          #[cfg(feature = "async-runtime")]
          task_submission: None,
        });
        break id;
      }
    };
    Some(id)
  }

  fn remove(&self, id: usize) {
    let mut entries = self
      .entries
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner);
    entries.remove(&id);
    if entries.is_empty() {
      self.quiescence.notify_all();
    }
  }

  #[cfg(any(
    target_family = "wasm",
    all(test, feature = "async-runtime", not(feature = "tokio_rt"))
  ))]
  fn register_owner_settlement(
    self: &Arc<Self>,
    action: RuntimeEnvOwnerSettlementAction,
  ) -> Option<RuntimeEnvOwnerSettlementRegistration> {
    if self.closed.load(Ordering::Acquire) {
      return None;
    }
    let mut settlements = self
      .owner_settlements
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner);
    if self.closed.load(Ordering::Acquire) {
      return None;
    }
    let id = loop {
      let id = self
        .next_owner_settlement_id
        .fetch_add(1, Ordering::Relaxed);
      if id == 0 {
        continue;
      }
      if let std::collections::hash_map::Entry::Vacant(entry) = settlements.entry(id) {
        entry.insert(action);
        break id;
      }
    };
    Some(RuntimeEnvOwnerSettlementRegistration {
      tasks: Arc::clone(self),
      id: Some(id),
    })
  }

  #[cfg(any(
    target_family = "wasm",
    all(test, feature = "async-runtime", not(feature = "tokio_rt"))
  ))]
  fn remove_owner_settlement(&self, id: usize) {
    self
      .owner_settlements
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner)
      .remove(&id);
  }

  #[cfg(any(
    target_family = "wasm",
    all(test, feature = "async-runtime", not(feature = "tokio_rt"))
  ))]
  fn run_owner_settlements(&self) {
    loop {
      let actions = {
        let mut settlements = self
          .owner_settlements
          .lock()
          .unwrap_or_else(std::sync::PoisonError::into_inner);
        std::mem::take(&mut *settlements)
          .into_values()
          .collect::<Vec<_>>()
      };
      if actions.is_empty() {
        return;
      }
      for action in actions {
        crate::bindgen_runtime::catch_unwind_safely(action);
      }
    }
  }

  #[cfg(all(test, feature = "async-runtime", not(feature = "tokio_rt")))]
  fn take_abort_handle(&self, id: usize) -> Option<AbortHandle> {
    // Return an owned handle so aborting and its synchronous wake cannot run under this lock.
    self
      .entries
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner)
      .get_mut(&id)
      .and_then(|entry| entry.abort_handle.take())
  }

  #[cfg(feature = "async-runtime")]
  fn bind_task_future(&self, id: usize, future: &Arc<AsyncRuntimeTaskFutureSlot>) {
    let should_drop = {
      let mut entries = self
        .entries
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
      if self.closed.load(Ordering::Acquire) {
        true
      } else if let Some(entry) = entries.get_mut(&id) {
        entry.task_future = Some(Arc::downgrade(future));
        false
      } else {
        true
      }
    };
    if should_drop {
      future.drop_future();
    }
  }

  #[cfg(feature = "async-runtime")]
  fn bind_task_submission(&self, id: usize, submission: &Arc<AsyncRuntimeSubmission>) {
    let should_cancel = {
      let mut entries = self
        .entries
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
      if self.closed.load(Ordering::Acquire) {
        true
      } else if let Some(entry) = entries.get_mut(&id) {
        entry.task_submission = Some(Arc::downgrade(submission));
        false
      } else {
        true
      }
    };
    if should_cancel {
      submission.cancel(None);
    }
  }

  fn cancel_all(&self, close_env: bool) {
    if close_env {
      self.closed.store(true, Ordering::Release);
    }
    let entries = self
      .entries
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner)
      .values_mut()
      .map(|entry| EnvTaskCancellation {
        abort_handle: entry.abort_handle.take(),
        #[cfg(feature = "async-runtime")]
        task_future: entry.task_future.take(),
        #[cfg(feature = "async-runtime")]
        task_submission: entry.task_submission.take(),
      })
      .collect::<Vec<_>>();
    for entry in entries {
      if let Some(abort_handle) = entry.abort_handle {
        abort_safely(abort_handle);
      }
      #[cfg(feature = "async-runtime")]
      if let Some(task_submission) = entry
        .task_submission
        .and_then(|submission| submission.upgrade())
      {
        task_submission.cancel(None);
      } else if let Some(task_future) = entry.task_future.and_then(|future| future.upgrade()) {
        task_future.drop_future();
      }
    }
  }

  fn wait_for_quiescence(&self, timeout: Duration) -> Result<()> {
    let deadline = Instant::now() + timeout;
    let mut entries = self
      .entries
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner);
    while !entries.is_empty() {
      let now = Instant::now();
      if now >= deadline {
        return Err(Error::new(
          crate::Status::GenericFailure,
          "Timed out waiting for an environment's async task futures to be destroyed",
        ));
      }
      let (next, wait_result) = self
        .quiescence
        .wait_timeout(entries, deadline.saturating_duration_since(now))
        .unwrap_or_else(std::sync::PoisonError::into_inner);
      entries = next;
      if wait_result.timed_out() && !entries.is_empty() {
        return Err(Error::new(
          crate::Status::GenericFailure,
          "Timed out waiting for an environment's async task futures to be destroyed",
        ));
      }
    }
    Ok(())
  }
}

#[cfg(all(
  test,
  not(feature = "noop"),
  any(feature = "async-runtime", feature = "tokio_rt")
))]
mod env_tasks_tests {
  use std::sync::{
    atomic::{AtomicBool, Ordering},
    mpsc,
  };

  use super::*;

  struct FutureDropFlag(Arc<AtomicBool>);

  impl Future for FutureDropFlag {
    type Output = ();

    fn poll(self: Pin<&mut Self>, _cx: &mut Context<'_>) -> Poll<Self::Output> {
      Poll::Pending
    }
  }

  impl Drop for FutureDropFlag {
    fn drop(&mut self) {
      self.0.store(true, Ordering::SeqCst);
    }
  }

  #[test]
  fn ids_skip_zero_and_occupied_entries_after_wrap() {
    let tasks = EnvTasks::new();
    let (max_handle, max_registration) = AbortHandle::new_pair();
    let (one_handle, one_registration) = AbortHandle::new_pair();
    {
      let mut entries = tasks
        .entries
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
      assert!(entries
        .insert(
          usize::MAX,
          EnvTaskEntry {
            abort_handle: Some(max_handle),
            #[cfg(feature = "async-runtime")]
            task_future: None,
            #[cfg(feature = "async-runtime")]
            task_submission: None,
          },
        )
        .is_none());
      assert!(entries
        .insert(
          1,
          EnvTaskEntry {
            abort_handle: Some(one_handle),
            #[cfg(feature = "async-runtime")]
            task_future: None,
            #[cfg(feature = "async-runtime")]
            task_submission: None,
          },
        )
        .is_none());
    }
    tasks.next_id.store(usize::MAX, Ordering::Relaxed);

    let (new_handle, new_registration) = AbortHandle::new_pair();
    assert_eq!(tasks.register(new_handle), Some(2));
    assert_eq!(
      tasks
        .entries
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .len(),
      3
    );

    let mut max_future = Box::pin(Abortable::new(
      std::future::pending::<()>(),
      max_registration,
    ));
    let mut one_future = Box::pin(Abortable::new(
      std::future::pending::<()>(),
      one_registration,
    ));
    let mut new_future = Box::pin(Abortable::new(
      std::future::pending::<()>(),
      new_registration,
    ));
    let waker = futures::task::noop_waker();
    let mut context = Context::from_waker(&waker);
    assert!(max_future.as_mut().poll(&mut context).is_pending());
    assert!(one_future.as_mut().poll(&mut context).is_pending());
    assert!(new_future.as_mut().poll(&mut context).is_pending());

    tasks.cancel_all(true);

    assert!(max_future.as_mut().poll(&mut context).is_ready());
    assert!(one_future.as_mut().poll(&mut context).is_ready());
    assert!(new_future.as_mut().poll(&mut context).is_ready());
  }

  #[test]
  fn quiescence_is_reported_only_after_the_registered_future_is_destroyed() {
    let tasks = Arc::new(EnvTasks::new());
    let dropped = Arc::new(AtomicBool::new(false));
    let (abort_handle, abort_registration) = AbortHandle::new_pair();
    let id = tasks.register(abort_handle).unwrap();
    let future = RegisteredEnvTaskFuture {
      future: Some(Box::pin(Abortable::new(
        FutureDropFlag(Arc::clone(&dropped)),
        abort_registration,
      ))),
      registration: Some(EnvTaskRegistration {
        tasks: Arc::clone(&tasks),
        id: Some(id),
      }),
    };

    tasks.cancel_all(true);
    let wait_tasks = Arc::clone(&tasks);
    let (result_tx, result_rx) = mpsc::channel();
    let waiter = std::thread::spawn(move || {
      result_tx
        .send(wait_tasks.wait_for_quiescence(Duration::from_secs(5)))
        .unwrap();
    });
    assert!(
      result_rx.recv_timeout(Duration::from_millis(50)).is_err(),
      "cancellation alone must not prove future destruction"
    );

    drop(future);
    result_rx
      .recv_timeout(Duration::from_secs(5))
      .expect("future destruction must wake the quiescence waiter")
      .unwrap();
    waiter.join().unwrap();
    assert!(dropped.load(Ordering::SeqCst));
  }

  #[cfg(feature = "async-runtime")]
  #[test]
  fn environment_cleanup_drops_an_unpolled_custom_runtime_future() {
    let env = 0x7fff_1000usize as sys::napi_env;
    assert!(register_runtime_env_tasks(env));
    let dropped = Arc::new(AtomicBool::new(false));
    let task = env_async_task(env, FutureDropFlag(Arc::clone(&dropped)), |_, _| {});

    cancel_runtime_env_tasks(env).wait().unwrap();

    assert!(dropped.load(Ordering::SeqCst));
    drop(task);
  }
}

#[cfg(not(feature = "noop"))]
fn abort_safely(handle: AbortHandle) {
  crate::bindgen_runtime::catch_unwind_safely(|| handle.abort());
}

#[cfg(all(
  not(feature = "noop"),
  any(feature = "async-runtime", feature = "tokio_rt")
))]
struct EnvTaskRegistration {
  tasks: Arc<EnvTasks>,
  id: Option<usize>,
}

#[cfg(all(
  not(feature = "noop"),
  any(feature = "async-runtime", feature = "tokio_rt"),
  any(
    target_family = "wasm",
    all(test, feature = "async-runtime", not(feature = "tokio_rt"))
  )
))]
pub(crate) struct RuntimeEnvOwnerSettlementRegistration {
  tasks: Arc<EnvTasks>,
  id: Option<usize>,
}

#[cfg(all(
  not(feature = "noop"),
  any(feature = "async-runtime", feature = "tokio_rt"),
  any(
    target_family = "wasm",
    all(test, feature = "async-runtime", not(feature = "tokio_rt"))
  )
))]
impl Drop for RuntimeEnvOwnerSettlementRegistration {
  fn drop(&mut self) {
    if let Some(id) = self.id.take() {
      self.tasks.remove_owner_settlement(id);
    }
  }
}

#[cfg(all(
  not(feature = "noop"),
  any(feature = "async-runtime", feature = "tokio_rt")
))]
#[cfg_attr(not(feature = "async-runtime"), allow(dead_code))]
struct EnvTaskRegistrationBinding {
  tasks: Arc<EnvTasks>,
  id: usize,
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
impl EnvTaskRegistrationBinding {
  fn bind_future(&self, future: &Arc<AsyncRuntimeTaskFutureSlot>) {
    self.tasks.bind_task_future(self.id, future);
  }

  fn bind_submission(&self, submission: &Arc<AsyncRuntimeSubmission>) {
    self.tasks.bind_task_submission(self.id, submission);
  }
}

#[cfg(all(
  not(feature = "noop"),
  any(feature = "async-runtime", feature = "tokio_rt")
))]
impl Drop for EnvTaskRegistration {
  fn drop(&mut self) {
    if let Some(id) = self.id.take() {
      self.tasks.remove(id);
    }
  }
}

#[cfg(all(
  not(feature = "noop"),
  any(feature = "async-runtime", feature = "tokio_rt")
))]
struct RegisteredEnvTaskFuture<F: Future> {
  future: Option<Pin<Box<Abortable<F>>>>,
  registration: Option<EnvTaskRegistration>,
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
impl<F: Future> RegisteredEnvTaskFuture<F> {
  fn take_registration(&mut self) -> Option<EnvTaskRegistration> {
    self.registration.take()
  }
}

#[cfg(all(
  not(feature = "noop"),
  any(feature = "async-runtime", feature = "tokio_rt")
))]
impl<F: Future> Future for RegisteredEnvTaskFuture<F> {
  type Output = Option<F::Output>;

  fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output> {
    let this = unsafe { self.get_unchecked_mut() };
    let poll = match this.future.as_mut() {
      Some(future) => future.as_mut().poll(cx),
      None => return Poll::Ready(None),
    };
    match poll {
      Poll::Ready(result) => {
        if let Some(future) = this.future.take() {
          drop_safely(future);
        }
        drop(this.registration.take());
        Poll::Ready(result.ok())
      }
      Poll::Pending => Poll::Pending,
    }
  }
}

#[cfg(all(
  not(feature = "noop"),
  any(feature = "async-runtime", feature = "tokio_rt")
))]
impl<F: Future> Drop for RegisteredEnvTaskFuture<F> {
  fn drop(&mut self) {
    if let Some(future) = self.future.take() {
      drop_safely(future);
    }
    drop(self.registration.take());
  }
}

#[cfg(all(
  not(feature = "noop"),
  any(feature = "async-runtime", feature = "tokio_rt")
))]
static ENV_TASKS: LazyLock<Mutex<HashMap<usize, Arc<EnvTasks>>>> =
  LazyLock::new(|| Mutex::new(HashMap::new()));

#[cfg(all(
  not(feature = "noop"),
  any(feature = "async-runtime", feature = "tokio_rt")
))]
const ENV_TASK_QUIESCENCE_TIMEOUT: Duration = Duration::from_secs(30);

#[cfg(all(
  not(feature = "noop"),
  any(feature = "async-runtime", feature = "tokio_rt")
))]
#[must_use = "environment cleanup must wait for task-future destruction before releasing callbacks"]
pub(crate) struct RuntimeEnvTaskCleanup {
  tasks: Option<Arc<EnvTasks>>,
}

#[cfg(all(
  not(feature = "noop"),
  any(feature = "async-runtime", feature = "tokio_rt")
))]
impl RuntimeEnvTaskCleanup {
  pub(crate) fn wait(self) -> Result<()> {
    self.tasks.map_or(Ok(()), |tasks| {
      tasks.wait_for_quiescence(ENV_TASK_QUIESCENCE_TIMEOUT)
    })
  }
}

#[cfg(all(
  not(feature = "noop"),
  any(feature = "async-runtime", feature = "tokio_rt")
))]
fn runtime_env_tasks(env: sys::napi_env) -> Option<Arc<EnvTasks>> {
  ENV_TASKS
    .lock()
    .unwrap_or_else(std::sync::PoisonError::into_inner)
    .get(&(env as usize))
    .cloned()
}

#[cfg(all(
  not(feature = "noop"),
  any(feature = "async-runtime", feature = "tokio_rt"),
  any(
    target_family = "wasm",
    all(test, feature = "async-runtime", not(feature = "tokio_rt"))
  )
))]
pub(crate) fn register_runtime_env_owner_settlement(
  env: sys::napi_env,
  action: RuntimeEnvOwnerSettlementAction,
) -> Option<RuntimeEnvOwnerSettlementRegistration> {
  runtime_env_tasks(env)?.register_owner_settlement(action)
}

#[cfg(all(
  not(feature = "noop"),
  any(feature = "async-runtime", feature = "tokio_rt")
))]
fn runtime_env_is_open(tasks: &Option<Arc<EnvTasks>>) -> bool {
  tasks
    .as_ref()
    .is_some_and(|tasks| !tasks.closed.load(Ordering::Acquire))
}

#[cfg(all(
  not(feature = "noop"),
  any(feature = "async-runtime", feature = "tokio_rt"),
  any(
    target_family = "wasm",
    all(test, feature = "async-runtime", not(feature = "tokio_rt"))
  )
))]
thread_local! {
  static OWNER_THREAD_DISPOSAL_ENV: Cell<usize> = const { Cell::new(0) };
}

#[cfg(all(
  not(feature = "noop"),
  any(feature = "async-runtime", feature = "tokio_rt"),
  any(
    target_family = "wasm",
    all(test, feature = "async-runtime", not(feature = "tokio_rt"))
  )
))]
struct OwnerThreadDisposalGuard {
  previous_env: usize,
}

#[cfg(all(
  not(feature = "noop"),
  any(feature = "async-runtime", feature = "tokio_rt"),
  any(
    target_family = "wasm",
    all(test, feature = "async-runtime", not(feature = "tokio_rt"))
  )
))]
impl OwnerThreadDisposalGuard {
  fn enter(env: sys::napi_env) -> Self {
    let previous_env = OWNER_THREAD_DISPOSAL_ENV.with(|current| current.replace(env as usize));
    Self { previous_env }
  }
}

#[cfg(all(
  not(feature = "noop"),
  any(feature = "async-runtime", feature = "tokio_rt"),
  any(
    target_family = "wasm",
    all(test, feature = "async-runtime", not(feature = "tokio_rt"))
  )
))]
impl Drop for OwnerThreadDisposalGuard {
  fn drop(&mut self) {
    OWNER_THREAD_DISPOSAL_ENV.with(|current| current.set(self.previous_env));
  }
}

#[cfg(all(
  not(feature = "noop"),
  any(feature = "async-runtime", feature = "tokio_rt"),
  any(
    target_family = "wasm",
    all(test, feature = "async-runtime", not(feature = "tokio_rt"))
  )
))]
pub(crate) fn runtime_env_is_disposing_on_owner_thread(env: sys::napi_env) -> bool {
  OWNER_THREAD_DISPOSAL_ENV.with(|current| current.get() == env as usize)
}

#[cfg(all(
  not(feature = "noop"),
  any(feature = "async-runtime", feature = "tokio_rt"),
  not(any(
    target_family = "wasm",
    all(test, feature = "async-runtime", not(feature = "tokio_rt"))
  ))
))]
pub(crate) fn runtime_env_is_disposing_on_owner_thread(_env: sys::napi_env) -> bool {
  false
}

#[cfg(all(
  not(feature = "noop"),
  any(feature = "async-runtime", feature = "tokio_rt")
))]
pub(crate) fn register_runtime_env_tasks(env: sys::napi_env) -> bool {
  let mut env_tasks = ENV_TASKS
    .lock()
    .unwrap_or_else(std::sync::PoisonError::into_inner);
  match env_tasks.entry(env as usize) {
    std::collections::hash_map::Entry::Vacant(entry) => {
      entry.insert(Arc::new(EnvTasks::new()));
      true
    }
    std::collections::hash_map::Entry::Occupied(_) => false,
  }
}

#[cfg(all(
  not(feature = "noop"),
  any(feature = "async-runtime", feature = "tokio_rt")
))]
pub(crate) fn cancel_runtime_env_tasks(env: sys::napi_env) -> RuntimeEnvTaskCleanup {
  let tasks = ENV_TASKS
    .lock()
    .unwrap_or_else(std::sync::PoisonError::into_inner)
    .remove(&(env as usize));
  if let Some(tasks) = tasks.as_ref() {
    tasks.cancel_all(true);
  }
  RuntimeEnvTaskCleanup { tasks }
}

#[cfg(all(
  not(feature = "noop"),
  any(feature = "async-runtime", feature = "tokio_rt")
))]
pub(crate) fn cancel_and_wait_runtime_env_tasks(env: sys::napi_env) {
  if let Err(error) = cancel_runtime_env_tasks(env).wait() {
    crate::bindgen_runtime::catch_unwind_safely(|| {
      eprintln!("Failed to quiesce environment async tasks: {error}");
    });
    // Continuing environment teardown could release native values still
    // borrowed by a live future.
    std::process::abort();
  }
}

#[cfg(all(
  not(feature = "noop"),
  any(feature = "async-runtime", feature = "tokio_rt"),
  any(
    target_family = "wasm",
    all(test, feature = "async-runtime", not(feature = "tokio_rt"))
  )
))]
pub(crate) fn cancel_and_wait_runtime_env_tasks_before_wasm_dispose(env: sys::napi_env) {
  let _owner_thread_disposal = OwnerThreadDisposalGuard::enter(env);
  let tasks = runtime_env_tasks(env);
  if let Some(tasks) = tasks.as_ref() {
    tasks.cancel_all(false);
  }
  if let Err(error) = (RuntimeEnvTaskCleanup {
    tasks: tasks.clone(),
  })
  .wait()
  {
    crate::bindgen_runtime::catch_unwind_safely(|| {
      eprintln!("Failed to settle environment async tasks before WASI disposal: {error}");
    });
    // Destroying the environment now could discard deferred settlements or
    // release native values still borrowed by a live future.
    std::process::abort();
  }
  if let Some(tasks) = tasks {
    // Runtime settlement is registered before the corresponding task can release
    // its environment registration. Quiescence therefore closes the producer side
    // before this owner-thread drain.
    tasks.run_owner_settlements();
  }
}

#[cfg(all(
  not(feature = "noop"),
  any(feature = "async-runtime", feature = "tokio_rt")
))]
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

#[cfg(all(
  not(feature = "noop"),
  any(feature = "async-runtime", feature = "tokio_rt")
))]
fn register_env_task(env: sys::napi_env, abort_handle: AbortHandle) -> Option<EnvTaskRegistration> {
  let env_tasks = ENV_TASKS
    .lock()
    .unwrap_or_else(std::sync::PoisonError::into_inner);
  let Some(tasks) = env_tasks.get(&(env as usize)).cloned() else {
    drop(env_tasks);
    abort_safely(abort_handle);
    return None;
  };
  let id = tasks.register(abort_handle)?;
  Some(EnvTaskRegistration {
    tasks,
    id: Some(id),
  })
}

#[cfg(all(
  not(feature = "noop"),
  any(feature = "async-runtime", feature = "tokio_rt")
))]
fn registered_env_task_future<F: Future>(
  env: sys::napi_env,
  future: F,
) -> (
  RegisteredEnvTaskFuture<F>,
  Option<EnvTaskRegistrationBinding>,
) {
  let (abort_handle, abort_registration) = AbortHandle::new_pair();
  let registration = register_env_task(env, abort_handle);
  let Some(registration) = registration else {
    drop_safely(future);
    return (
      RegisteredEnvTaskFuture {
        future: None,
        registration: None,
      },
      None,
    );
  };
  let tasks = Arc::clone(&registration.tasks);
  let id = registration
    .id
    .expect("a live environment task registration must retain its ID");
  (
    RegisteredEnvTaskFuture {
      future: Some(Box::pin(Abortable::new(future, abort_registration))),
      registration: Some(registration),
    },
    Some(EnvTaskRegistrationBinding { tasks, id }),
  )
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
fn env_async_task<Completion: IntoAsyncRuntimeCompletion + Send + 'static>(
  env: sys::napi_env,
  future: impl Future<Output = Completion> + Send + 'static,
  cancel: impl FnOnce(bool, Option<Error>) + Send + 'static,
) -> AsyncRuntimeTask {
  let (mut future, registration_binding) = registered_env_task_future(env, future);
  let Some(registration_binding) = registration_binding else {
    return AsyncRuntimeTask::new(async { AsyncTaskOutcome::Cancelled }, move |error| {
      cancel(false, error);
    });
  };
  let registration = future
    .take_registration()
    .expect("a registered custom-runtime future must retain its environment registration");
  let cancel_tasks = Arc::clone(&registration_binding.tasks);

  let mut task = AsyncRuntimeTask::new(
    async move {
      match future.await {
        Some(completion) => AsyncTaskOutcome::Completed(completion.into_async_runtime_completion()),
        None => AsyncTaskOutcome::Cancelled,
      }
    },
    move |error| {
      cancel(!cancel_tasks.closed.load(Ordering::Acquire), error);
    },
  );
  task.bind_env_task_registration(registration, registration_binding);
  task
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
fn async_runtime_env_unavailable_error() -> Error {
  Error::new(
    crate::Status::Cancelled,
    "Async work cannot be scheduled because its Node-API environment is no longer registered",
  )
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
fn submit_async_task(task: AsyncRuntimeTask) {
  let mut task = task;
  let Some(_submission) = RuntimeUsePermit::acquire() else {
    task.reject(runtime_unavailable_error());
    return;
  };
  let runtime = match custom_async_runtime() {
    Ok(runtime) => runtime,
    Err(error) => {
      task.reject(error);
      return;
    }
  };
  let submission = task.begin_submission();
  match std::panic::catch_unwind(AssertUnwindSafe(|| runtime.spawn(task))) {
    Ok(Ok(())) => {
      let _ = submission.accept();
    }
    Ok(Err(rejection)) => {
      let (task, error) = rejection.into_parts();
      submission.reject(error);
      drop(task);
    }
    Err(reason) => {
      submission.fail(crate::bindgen_runtime::panic_to_error(reason));
    }
  }
}

#[cfg(all(not(feature = "noop"), feature = "tokio_rt"))]
#[derive(Default)]
struct TokioRuntimeWorkerTracker {
  workers: Mutex<HashSet<std::thread::ThreadId>>,
}

#[cfg(all(not(feature = "noop"), feature = "tokio_rt"))]
impl TokioRuntimeWorkerTracker {
  fn register_current_thread(&self) {
    self
      .workers
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner)
      .insert(std::thread::current().id());
  }

  fn current_thread_is_worker(&self) -> bool {
    self
      .workers
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner)
      .contains(&std::thread::current().id())
  }
}

#[cfg(all(not(feature = "noop"), feature = "tokio_rt"))]
struct PreparedTokioRuntime {
  runtime: Runtime,
  workers: Arc<TokioRuntimeWorkerTracker>,
  may_spawn_untracked_threads: bool,
}

#[cfg(all(not(feature = "noop"), feature = "tokio_rt"))]
fn create_runtime(generation: usize) -> Result<PreparedTokioRuntime> {
  if let Some(user_defined_rt) = create_user_defined_runtime()? {
    return Ok(user_defined_rt);
  }
  // If no user-defined runtime was installed, or a legacy one-shot registration was consumed by
  // a previous generation, fall back to creating a default runtime.

  #[cfg(any(
    all(target_family = "wasm", tokio_unstable),
    not(target_family = "wasm")
  ))]
  {
    let workers = Arc::new(TokioRuntimeWorkerTracker::default());
    let worker_start = Arc::clone(&workers);
    let runtime = tokio::runtime::Builder::new_multi_thread()
      .enable_all()
      .on_thread_start(move || {
        worker_start.register_current_thread();
      })
      .build()
      .expect("Create tokio runtime failed");
    debug_assert_ne!(generation, 0);
    Ok(PreparedTokioRuntime {
      runtime,
      workers,
      may_spawn_untracked_threads: false,
    })
  }
  #[cfg(all(target_family = "wasm", not(tokio_unstable)))]
  {
    let runtime = tokio::runtime::Builder::new_current_thread()
      .enable_all()
      .build()
      .expect("Create tokio runtime failed");
    debug_assert_ne!(generation, 0);
    Ok(PreparedTokioRuntime {
      runtime,
      workers: Arc::new(TokioRuntimeWorkerTracker::default()),
      may_spawn_untracked_threads: false,
    })
  }
}

// Combined `async-runtime` + `tokio_rt` builds create this runtime lazily for the established free
// Tokio helper APIs when a custom backend is selected. Generated JavaScript-facing futures also
// use it when no custom backend was selected.
#[cfg(all(not(feature = "noop"), feature = "tokio_rt"))]
struct SharedTokioRuntime {
  runtime: Option<Runtime>,
  retirement: Option<Arc<TokioRuntimeRetirementSignal>>,
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
  retirement: Arc<TokioRuntimeRetirementSignal>,
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
    self.retirement.mark_current_thread_as_retirement_owner();
    if let Some(runtime) = self.runtime.take() {
      if let Err(payload) = std::panic::catch_unwind(AssertUnwindSafe(|| drop(runtime))) {
        let error = crate::bindgen_runtime::panic_to_error(payload);
        self.retirement.fail(format!(
          "Tokio runtime retirement panicked while dropping the runtime: {}",
          error.reason
        ));
        return;
      }
    }
    self.retirement.complete();
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
fn launch_tokio_runtime_retirement(
  runtime: Runtime,
  retirement: Arc<TokioRuntimeRetirementSignal>,
) {
  launch_tokio_runtime_retirement_with(runtime, retirement, |worker| {
    std::thread::Builder::new()
      .name("napi-tokio-runtime-retirement".to_owned())
      .spawn(worker)
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
fn launch_tokio_runtime_retirement_with(
  runtime: Runtime,
  retirement: Arc<TokioRuntimeRetirementSignal>,
  spawn: impl FnOnce(Box<dyn FnOnce() + Send + 'static>) -> std::io::Result<std::thread::JoinHandle<()>>,
) {
  let failure_signal = Arc::clone(&retirement);
  let retirement = TokioRuntimeRetirement {
    runtime: Some(runtime),
    retirement,
  };
  failure_signal.begin_thread_spawn();
  match launch_background_drop(retirement, spawn) {
    Ok(thread) => failure_signal.install_thread(thread),
    Err((error, retirement)) => {
      failure_signal.cancel_thread_spawn();
      // Runtime::drop may block on arbitrary user work. Never run it inline on
      // a Node teardown thread after background retirement could not start.
      // The failed signal prevents restart; native cleanup pins the addon
      // before returning so the leaked runtime cannot execute unmapped code.
      std::mem::forget(retirement);
      failure_signal.fail(format!(
        "Failed to spawn the Tokio runtime retirement thread: {error}"
      ));
    }
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
fn launch_background_drop<T: Send + 'static>(
  value: T,
  spawn: impl FnOnce(Box<dyn FnOnce() + Send + 'static>) -> std::io::Result<std::thread::JoinHandle<()>>,
) -> std::result::Result<std::thread::JoinHandle<()>, (std::io::Error, T)> {
  let state = Arc::new(std::sync::Mutex::new(Some(value)));
  let worker_state = Arc::clone(&state);
  let worker: Box<dyn FnOnce() + Send + 'static> = Box::new(move || {
    let retirement = worker_state
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner)
      .take();
    drop(retirement);
  });
  match spawn(worker) {
    Ok(thread) => Ok(thread),
    Err(error) => {
      // `Builder::spawn` drops the worker closure on the calling thread when
      // thread creation fails, but this owner still lets the caller choose a
      // target-appropriate fallback without losing the runtime.
      let value = state
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .take()
        .expect("failed retirement spawn must leave the runtime with the caller");
      Err((error, value))
    }
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
      launch_tokio_runtime_retirement(
        runtime,
        retirement.expect("Tokio runtime retirement signal is present until drop"),
      );
    }
    #[cfg(all(target_family = "wasm", not(tokio_unstable)))]
    {
      let retirement = retirement.expect("Tokio runtime retirement signal is present until drop");
      retirement.mark_current_thread_as_retirement_owner();
      match std::panic::catch_unwind(AssertUnwindSafe(|| runtime.shutdown_background())) {
        Ok(()) => retirement.complete(),
        Err(payload) => {
          let error = crate::bindgen_runtime::panic_to_error(payload);
          retirement.fail(format!(
            "Tokio runtime retirement panicked while dropping the runtime: {}",
            error.reason
          ));
        }
      }
    }
  }
}

#[cfg(all(not(feature = "noop"), feature = "tokio_rt"))]
struct TokioRuntimeGeneration {
  runtime: Arc<SharedTokioRuntime>,
  retirement: Arc<TokioRuntimeRetirementSignal>,
}

#[cfg(all(not(feature = "noop"), feature = "tokio_rt"))]
struct TokioRuntimeLease {
  runtime: Arc<SharedTokioRuntime>,
  retirement: Arc<TokioRuntimeRetirementSignal>,
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
  fn retirement_signal(&self) -> Arc<TokioRuntimeRetirementSignal> {
    Arc::clone(&self.retirement)
  }

  fn generation(&self) -> usize {
    self.retirement.generation
  }

  fn worker_tracker(&self) -> Arc<TokioRuntimeWorkerTracker> {
    Arc::clone(&self.retirement.workers)
  }
}

#[cfg(all(not(feature = "noop"), feature = "tokio_rt"))]
#[derive(Clone)]
enum TokioRuntimeRetirementStatus {
  Pending,
  Complete,
  Failed(String),
}

#[cfg(all(not(feature = "noop"), feature = "tokio_rt"))]
#[cfg_attr(all(target_family = "wasm", not(tokio_unstable)), allow(dead_code))]
enum TokioRuntimeRetirementThread {
  None,
  Spawning,
  Running(std::thread::JoinHandle<()>),
  Joining,
  Joined,
}

#[cfg(all(not(feature = "noop"), feature = "tokio_rt"))]
struct TokioRuntimeRetirementSignal {
  generation: usize,
  runtime_id: Option<tokio::runtime::Id>,
  workers: Arc<TokioRuntimeWorkerTracker>,
  may_have_untracked_runtime_threads: bool,
  status: Mutex<TokioRuntimeRetirementStatus>,
  changed: Condvar,
  thread: Mutex<TokioRuntimeRetirementThread>,
  thread_changed: Condvar,
  retirement_owner: OnceLock<std::thread::ThreadId>,
}

#[cfg(all(not(feature = "noop"), feature = "tokio_rt"))]
#[cfg_attr(all(target_family = "wasm", not(tokio_unstable)), allow(dead_code))]
impl TokioRuntimeRetirementSignal {
  #[cfg(test)]
  fn new(generation: usize, runtime_id: Option<tokio::runtime::Id>) -> Self {
    Self::new_with_workers(
      generation,
      runtime_id,
      Arc::new(TokioRuntimeWorkerTracker::default()),
    )
  }

  #[cfg(test)]
  fn new_with_workers(
    generation: usize,
    runtime_id: Option<tokio::runtime::Id>,
    workers: Arc<TokioRuntimeWorkerTracker>,
  ) -> Self {
    Self::new_with_worker_tracking(generation, runtime_id, workers, false)
  }

  fn new_with_worker_tracking(
    generation: usize,
    runtime_id: Option<tokio::runtime::Id>,
    workers: Arc<TokioRuntimeWorkerTracker>,
    may_have_untracked_runtime_threads: bool,
  ) -> Self {
    Self {
      generation,
      runtime_id,
      workers,
      may_have_untracked_runtime_threads,
      status: Mutex::new(TokioRuntimeRetirementStatus::Pending),
      changed: Condvar::new(),
      thread: Mutex::new(TokioRuntimeRetirementThread::None),
      thread_changed: Condvar::new(),
      retirement_owner: OnceLock::new(),
    }
  }

  fn mark_current_thread_as_retirement_owner(&self) {
    let current = std::thread::current().id();
    if self.retirement_owner.set(current).is_err() {
      debug_assert_eq!(self.retirement_owner.get(), Some(&current));
    }
  }

  fn current_thread_is_retirement_owner(&self) -> bool {
    self.retirement_owner.get() == Some(&std::thread::current().id())
  }

  fn status(&self) -> TokioRuntimeRetirementStatus {
    let status = self
      .status
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner)
      .clone();
    if !matches!(status, TokioRuntimeRetirementStatus::Complete) {
      return status;
    }
    let thread_finished = matches!(
      *self
        .thread
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner),
      TokioRuntimeRetirementThread::None | TokioRuntimeRetirementThread::Joined
    );
    if !thread_finished {
      return TokioRuntimeRetirementStatus::Pending;
    }
    // A joining waiter records a panic before publishing `Joined`. Re-read the
    // status after observing that terminal thread state so a concurrent restart
    // cannot admit a new generation from a stale `Complete` snapshot.
    self
      .status
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner)
      .clone()
  }

  fn begin_thread_spawn(&self) {
    let mut thread = self
      .thread
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner);
    debug_assert!(matches!(*thread, TokioRuntimeRetirementThread::None));
    *thread = TokioRuntimeRetirementThread::Spawning;
  }

  fn install_thread(&self, handle: std::thread::JoinHandle<()>) {
    let mut thread = self
      .thread
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner);
    debug_assert!(matches!(*thread, TokioRuntimeRetirementThread::Spawning));
    *thread = TokioRuntimeRetirementThread::Running(handle);
    self.thread_changed.notify_all();
  }

  fn cancel_thread_spawn(&self) {
    let mut thread = self
      .thread
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner);
    debug_assert!(matches!(*thread, TokioRuntimeRetirementThread::Spawning));
    *thread = TokioRuntimeRetirementThread::None;
    self.thread_changed.notify_all();
  }

  fn complete(&self) {
    let mut status = self
      .status
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner);
    if matches!(*status, TokioRuntimeRetirementStatus::Pending) {
      *status = TokioRuntimeRetirementStatus::Complete;
      self.changed.notify_all();
    }
  }

  fn fail(&self, reason: String) {
    let mut status = self
      .status
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner);
    if matches!(*status, TokioRuntimeRetirementStatus::Pending) {
      *status = TokioRuntimeRetirementStatus::Failed(reason);
      self.changed.notify_all();
    }
  }

  fn fail_thread(&self, reason: String) {
    let mut status = self
      .status
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner);
    match &mut *status {
      TokioRuntimeRetirementStatus::Failed(existing) => {
        existing.push_str("; additionally, ");
        existing.push_str(&reason);
      }
      TokioRuntimeRetirementStatus::Pending | TokioRuntimeRetirementStatus::Complete => {
        *status = TokioRuntimeRetirementStatus::Failed(reason);
      }
    }
    self.changed.notify_all();
  }

  fn cancel_wait(&self, cancelled: &AtomicBool) {
    let status_pending = matches!(
      *self
        .status
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner),
      TokioRuntimeRetirementStatus::Pending
    );
    let thread = self
      .thread
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner);
    if status_pending
      || !matches!(
        *thread,
        TokioRuntimeRetirementThread::None | TokioRuntimeRetirementThread::Joined
      )
    {
      cancelled.store(true, Ordering::Release);
      self.changed.notify_all();
      self.thread_changed.notify_all();
    }
  }

  fn join_thread(&self, handle: std::thread::JoinHandle<()>) -> Result<()> {
    let result = handle.join().map_err(|payload| {
      let error = crate::bindgen_runtime::panic_to_error(payload);
      let reason = format!("Tokio runtime retirement thread panicked: {}", error.reason);
      self.fail_thread(reason.clone());
      Error::new(crate::Status::GenericFailure, reason)
    });
    *self
      .thread
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner) = TokioRuntimeRetirementThread::Joined;
    self.thread_changed.notify_all();
    result
  }

  fn try_join_finished_thread(&self) -> Result<bool> {
    let handle = {
      let mut thread = self
        .thread
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
      match &*thread {
        TokioRuntimeRetirementThread::None | TokioRuntimeRetirementThread::Joined => {
          drop(thread);
          return Ok(!matches!(
            *self
              .status
              .lock()
              .unwrap_or_else(std::sync::PoisonError::into_inner),
            TokioRuntimeRetirementStatus::Pending
          ));
        }
        TokioRuntimeRetirementThread::Spawning | TokioRuntimeRetirementThread::Joining => {
          return Ok(false);
        }
        TokioRuntimeRetirementThread::Running(handle) if !handle.is_finished() => {
          return Ok(false);
        }
        TokioRuntimeRetirementThread::Running(_) => {}
      }
      let TokioRuntimeRetirementThread::Running(handle) =
        std::mem::replace(&mut *thread, TokioRuntimeRetirementThread::Joining)
      else {
        unreachable!()
      };
      handle
    };

    self.join_thread(handle)?;
    Ok(true)
  }

  fn wait_for_thread_exit(
    &self,
    cancelled: &AtomicBool,
    deadline: Option<std::time::Instant>,
  ) -> Result<()> {
    if self.current_thread_is_retirement_owner() {
      return Err(Error::new(
        crate::Status::WouldDeadlock,
        "Cannot wait for Tokio runtime retirement from its retirement thread",
      ));
    }
    let handle = {
      let mut thread = self
        .thread
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
      loop {
        if cancelled.load(Ordering::Acquire) {
          return Err(Error::new(
            crate::Status::Cancelled,
            "Tokio runtime retirement wait was cancelled",
          ));
        }
        match &*thread {
          TokioRuntimeRetirementThread::None | TokioRuntimeRetirementThread::Joined => {
            return Ok(())
          }
          TokioRuntimeRetirementThread::Spawning | TokioRuntimeRetirementThread::Joining => {
            thread = if let Some(deadline) = deadline {
              let Some(remaining) = deadline.checked_duration_since(std::time::Instant::now())
              else {
                return Err(Error::new(
                  crate::Status::GenericFailure,
                  "Tokio runtime retirement exceeded the unload grace period",
                ));
              };
              let (thread, timeout) = self
                .thread_changed
                .wait_timeout(thread, remaining)
                .unwrap_or_else(std::sync::PoisonError::into_inner);
              if timeout.timed_out() {
                return Err(Error::new(
                  crate::Status::GenericFailure,
                  "Tokio runtime retirement exceeded the unload grace period",
                ));
              }
              thread
            } else {
              self
                .thread_changed
                .wait(thread)
                .unwrap_or_else(std::sync::PoisonError::into_inner)
            };
          }
          TokioRuntimeRetirementThread::Running(handle) => {
            if handle.thread().id() == std::thread::current().id() {
              return Err(Error::new(
                crate::Status::WouldDeadlock,
                "Cannot join the Tokio runtime retirement thread from itself",
              ));
            }
            if !handle.is_finished() {
              let wait = match deadline {
                Some(deadline) => {
                  let Some(remaining) = deadline.checked_duration_since(std::time::Instant::now())
                  else {
                    return Err(Error::new(
                      crate::Status::GenericFailure,
                      "Tokio runtime retirement exceeded the unload grace period",
                    ));
                  };
                  remaining.min(std::time::Duration::from_millis(1))
                }
                None => std::time::Duration::from_millis(1),
              };
              let (next, _) = self
                .thread_changed
                .wait_timeout(thread, wait)
                .unwrap_or_else(std::sync::PoisonError::into_inner);
              thread = next;
              continue;
            }
            let TokioRuntimeRetirementThread::Running(handle) =
              std::mem::replace(&mut *thread, TokioRuntimeRetirementThread::Joining)
            else {
              unreachable!()
            };
            break handle;
          }
        }
      }
    };

    self.join_thread(handle)?;
    if cancelled.load(Ordering::Acquire) {
      return Err(Error::new(
        crate::Status::Cancelled,
        "Tokio runtime retirement wait was cancelled",
      ));
    }
    Ok(())
  }

  fn result(&self) -> Result<()> {
    match self
      .status
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner)
      .clone()
    {
      TokioRuntimeRetirementStatus::Complete => Ok(()),
      TokioRuntimeRetirementStatus::Failed(reason) => Err(Error::new(
        crate::Status::GenericFailure,
        format!("Tokio runtime retirement failed: {reason}"),
      )),
      TokioRuntimeRetirementStatus::Pending => Err(Error::new(
        crate::Status::GenericFailure,
        "Tokio runtime retirement did not reach a terminal state",
      )),
    }
  }

  fn wait(&self, cancelled: &AtomicBool, deadline: Option<std::time::Instant>) -> Result<()> {
    let mut status = self
      .status
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner);
    loop {
      if cancelled.load(Ordering::Acquire) {
        return Err(Error::new(
          crate::Status::Cancelled,
          "Tokio runtime retirement wait was cancelled",
        ));
      }
      match &*status {
        TokioRuntimeRetirementStatus::Pending => {
          if self.current_thread_is_retirement_owner() {
            return Err(Error::new(
              crate::Status::WouldDeadlock,
              "Cannot wait for Tokio runtime retirement from its retirement thread",
            ));
          }
          if self.may_have_untracked_runtime_threads && deadline.is_none() {
            return Err(Error::new(
              crate::Status::WouldDeadlock,
              "Cannot block waiting for a supplied Tokio runtime to retire because it may own \
               untracked runtime threads; retry after retirement completes",
            ));
          }
          if current_tokio_runtime_may_own_generation(self.generation, self.runtime_id) {
            return Err(Error::new(
              crate::Status::WouldDeadlock,
              "Cannot wait for Tokio runtime retirement from work owned by that runtime",
            ));
          }
          if self.workers.current_thread_is_worker() {
            return Err(Error::new(
              crate::Status::WouldDeadlock,
              "Cannot wait for Tokio runtime retirement from a worker owned by that runtime",
            ));
          }
          status = if let Some(deadline) = deadline {
            let Some(remaining) = deadline.checked_duration_since(std::time::Instant::now()) else {
              return Err(Error::new(
                crate::Status::GenericFailure,
                "Tokio runtime retirement exceeded the unload grace period",
              ));
            };
            let (status, timeout) = self
              .changed
              .wait_timeout(status, remaining)
              .unwrap_or_else(std::sync::PoisonError::into_inner);
            if timeout.timed_out() && matches!(*status, TokioRuntimeRetirementStatus::Pending) {
              return Err(Error::new(
                crate::Status::GenericFailure,
                "Tokio runtime retirement exceeded the unload grace period",
              ));
            }
            status
          } else {
            self
              .changed
              .wait(status)
              .unwrap_or_else(std::sync::PoisonError::into_inner)
          };
        }
        TokioRuntimeRetirementStatus::Complete | TokioRuntimeRetirementStatus::Failed(_) => {
          drop(status);
          self.wait_for_thread_exit(cancelled, deadline)?;
          return self.result();
        }
      }
    }
  }
}

#[cfg(all(not(feature = "noop"), feature = "tokio_rt"))]
struct TokioRuntimeRetirementWaiterInner {
  retirement: Option<Arc<TokioRuntimeRetirementSignal>>,
  cancelled: AtomicBool,
}

/// A blocking, cancellable snapshot of the Tokio generation currently retiring.
///
/// The snapshot never follows later runtime generations. If no generation is retiring when this
/// value is created, [`wait`](Self::wait) returns immediately. Clones share cancellation state:
/// calling [`cancel`](Self::cancel) on any clone wakes the same pending wait. Cancellation remains
/// effective after retirement publishes a terminal result until its retirement thread is joined.
///
/// A successful wait proves that the runtime generation and its worker resources retired. It does
/// not guarantee that a native addon image will be unmapped: after the built-in Tokio runtime has
/// been created, napi may keep that image mapped for the process lifetime because safe Rust code
/// can retain task waker vtables after `Runtime::drop`.
#[cfg(all(not(feature = "noop"), feature = "tokio_rt"))]
#[derive(Clone)]
pub struct TokioRuntimeRetirementWaiter {
  inner: Arc<TokioRuntimeRetirementWaiterInner>,
}

#[cfg(all(not(feature = "noop"), feature = "tokio_rt"))]
impl TokioRuntimeRetirementWaiter {
  fn new(retirement: Option<Arc<TokioRuntimeRetirementSignal>>) -> Self {
    Self {
      inner: Arc::new(TokioRuntimeRetirementWaiterInner {
        retirement,
        cancelled: AtomicBool::new(false),
      }),
    }
  }

  /// Block until the snapshotted generation retires, this waiter is cancelled, or retirement
  /// fails terminally.
  ///
  /// This returns [`crate::Status::WouldDeadlock`] instead of blocking when called by work owned
  /// by the retiring Tokio runtime. Pending retirement of a runtime installed through
  /// [`create_custom_tokio_runtime`] also returns `WouldDeadlock`: napi cannot retrofit tracking
  /// hooks onto that runtime's future blocking threads, so no caller can safely prove that it is
  /// external to the runtime. Retry after background retirement completes. No napi runtime
  /// lifecycle lock is held while blocked.
  pub fn wait(&self) -> Result<()> {
    match &self.inner.retirement {
      Some(retirement) => retirement.wait(&self.inner.cancelled, None),
      None => Ok(()),
    }
  }

  #[cfg(any(
    not(target_family = "wasm"),
    all(target_family = "wasm", tokio_unstable)
  ))]
  #[cfg_attr(not(windows), allow(dead_code))]
  pub(crate) fn wait_for(&self, timeout: std::time::Duration) -> Result<()> {
    match &self.inner.retirement {
      Some(retirement) => retirement.wait(
        &self.inner.cancelled,
        Some(std::time::Instant::now() + timeout),
      ),
      None => Ok(()),
    }
  }

  /// Cancel this waiter and wake a concurrent [`wait`](Self::wait).
  ///
  /// All clones represent the same waiter, so cancellation through any clone is observed by every
  /// clone. This does not cancel retirement itself.
  pub fn cancel(&self) {
    if let Some(retirement) = &self.inner.retirement {
      retirement.cancel_wait(&self.inner.cancelled);
    }
  }
}

/// Snapshot the Tokio runtime generation currently retiring.
///
/// The returned waiter can be moved to a blocking worker while a clone is retained by an
/// environment cancellation owner. It does not borrow or retain a napi environment.
#[cfg(all(not(feature = "noop"), feature = "tokio_rt"))]
pub fn tokio_runtime_retirement_waiter() -> TokioRuntimeRetirementWaiter {
  let retirement = TOKIO_RUNTIME_STATE
    .lock()
    .unwrap_or_else(std::sync::PoisonError::into_inner)
    .retiring
    .clone();
  TokioRuntimeRetirementWaiter::new(retirement)
}

#[cfg(all(not(feature = "noop"), feature = "tokio_rt"))]
fn try_join_finished_tokio_runtime_retirement() -> Result<bool> {
  let retirement = TOKIO_RUNTIME_STATE
    .lock()
    .unwrap_or_else(std::sync::PoisonError::into_inner)
    .retiring
    .clone();
  match retirement {
    Some(retirement) => retirement.try_join_finished_thread(),
    None => Ok(true),
  }
}

#[cfg(all(not(feature = "noop"), feature = "async-runtime", feature = "tokio_rt"))]
fn finish_tokio_runtime_retirement(wait_for_retirement: bool) -> Result<()> {
  loop {
    let retirement = TOKIO_RUNTIME_STATE
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner)
      .retiring
      .clone();
    let Some(retirement) = retirement else {
      return Ok(());
    };

    if wait_for_retirement {
      let waiter = TokioRuntimeRetirementWaiter::new(Some(Arc::clone(&retirement)));
      #[cfg(any(
        not(target_family = "wasm"),
        all(target_family = "wasm", tokio_unstable)
      ))]
      waiter.wait_for(std::time::Duration::from_secs(5))?;
      #[cfg(all(target_family = "wasm", not(tokio_unstable)))]
      waiter.wait()?;
    } else if !retirement.try_join_finished_thread()? {
      return Err(Error::new(
        crate::Status::WouldDeadlock,
        "Tokio runtime is still shutting down",
      ));
    }
    retirement.result()?;

    let mut state = TOKIO_RUNTIME_STATE
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner);
    if state
      .retiring
      .as_ref()
      .is_some_and(|current| Arc::ptr_eq(current, &retirement))
    {
      state.retiring = None;
      return Ok(());
    }
  }
}

#[cfg(all(not(feature = "noop"), feature = "tokio_rt"))]
static NEXT_TOKIO_RUNTIME_GENERATION: AtomicUsize = AtomicUsize::new(1);

#[cfg(all(not(feature = "noop"), feature = "tokio_rt"))]
thread_local! {
  static CURRENT_TOKIO_RUNTIME_GENERATION: Cell<Option<usize>> = const { Cell::new(None) };
}

#[cfg(all(not(feature = "noop"), feature = "tokio_rt"))]
struct TokioRuntimeGenerationGuard {
  previous: Option<usize>,
}

#[cfg(all(not(feature = "noop"), feature = "tokio_rt"))]
impl TokioRuntimeGenerationGuard {
  fn enter(generation: usize) -> Self {
    let previous =
      CURRENT_TOKIO_RUNTIME_GENERATION.with(|current| current.replace(Some(generation)));
    Self { previous }
  }
}

#[cfg(all(not(feature = "noop"), feature = "tokio_rt"))]
impl Drop for TokioRuntimeGenerationGuard {
  fn drop(&mut self) {
    CURRENT_TOKIO_RUNTIME_GENERATION.with(|current| current.set(self.previous));
  }
}

#[cfg(all(not(feature = "noop"), feature = "tokio_rt"))]
fn current_tokio_runtime_may_own_generation(
  generation: usize,
  runtime_id: Option<tokio::runtime::Id>,
) -> bool {
  CURRENT_TOKIO_RUNTIME_GENERATION.with(|current| current.get() == Some(generation))
    || runtime_id.is_some_and(|runtime_id| {
      tokio::runtime::Handle::try_current().is_ok_and(|handle| handle.id() == runtime_id)
    })
}

#[cfg(all(not(feature = "noop"), feature = "tokio_rt"))]
struct TokioRuntimeGenerationFuture<F> {
  future: F,
  generation: usize,
  workers: Arc<TokioRuntimeWorkerTracker>,
  register_worker: bool,
}

#[cfg(all(not(feature = "noop"), feature = "tokio_rt"))]
impl<F> TokioRuntimeGenerationFuture<F> {
  fn new(
    future: F,
    generation: usize,
    workers: Arc<TokioRuntimeWorkerTracker>,
    register_worker: bool,
  ) -> Self {
    Self {
      future,
      generation,
      workers,
      register_worker,
    }
  }
}

#[cfg(all(not(feature = "noop"), feature = "tokio_rt"))]
impl<F: Future> Future for TokioRuntimeGenerationFuture<F> {
  type Output = F::Output;

  fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output> {
    // SAFETY: `future` is never moved after the wrapper is pinned.
    let this = unsafe { self.get_unchecked_mut() };
    let _operation = RuntimeOperationGuard::enter();
    if this.register_worker {
      this.workers.register_current_thread();
    }
    let _generation = TokioRuntimeGenerationGuard::enter(this.generation);
    unsafe { Pin::new_unchecked(&mut this.future) }.poll(cx)
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
  retiring: Option<Arc<TokioRuntimeRetirementSignal>>,
  registration_closed: bool,
}

#[cfg(all(not(feature = "noop"), feature = "tokio_rt"))]
static TOKIO_RUNTIME_STATE: std::sync::Mutex<TokioRuntimeState> =
  std::sync::Mutex::new(TokioRuntimeState {
    lifecycle: TokioRuntimeLifecycle::Uninitialized,
    generation: None,
    retiring: None,
    registration_closed: false,
  });

#[cfg(all(not(feature = "noop"), feature = "tokio_rt"))]
static TOKIO_RUNTIME_TRANSITION: Mutex<()> = Mutex::new(());

#[cfg(all(not(feature = "noop"), feature = "tokio_rt"))]
thread_local! {
  static TOKIO_RUNTIME_TRANSITION_ACTIVE: Cell<bool> = const { Cell::new(false) };
}

#[cfg(all(not(feature = "noop"), feature = "tokio_rt"))]
struct TokioRuntimeTransitionGuard;

#[cfg(all(not(feature = "noop"), feature = "tokio_rt"))]
impl TokioRuntimeTransitionGuard {
  fn enter() -> Result<Self> {
    if TOKIO_RUNTIME_TRANSITION_ACTIVE.with(|active| active.replace(true)) {
      return Err(Error::new(
        crate::Status::WouldDeadlock,
        "Cannot start, shut down, or configure Tokio recursively during a runtime transition",
      ));
    }
    Ok(Self)
  }
}

#[cfg(all(not(feature = "noop"), feature = "tokio_rt"))]
impl Drop for TokioRuntimeTransitionGuard {
  fn drop(&mut self) {
    TOKIO_RUNTIME_TRANSITION_ACTIVE.with(|active| active.set(false));
  }
}

#[cfg(all(not(feature = "noop"), feature = "tokio_rt"))]
#[derive(Clone, Copy)]
enum TokioRuntimeTransitionMode {
  NonBlocking,
  Wait,
}

#[cfg(all(not(feature = "noop"), feature = "tokio_rt"))]
#[derive(Clone, Copy, PartialEq, Eq)]
enum TokioRuntimeAcquisitionMode {
  RuntimeUse,
  LifecycleStart,
}

#[cfg(all(not(feature = "noop"), feature = "tokio_rt"))]
fn with_tokio_runtime_transition<T>(
  mode: TokioRuntimeTransitionMode,
  operation: impl FnOnce() -> Result<T>,
) -> Result<T> {
  if TOKIO_RUNTIME_TRANSITION_ACTIVE.with(Cell::get) {
    let reason = match mode {
      TokioRuntimeTransitionMode::NonBlocking => {
        "Cannot start, shut down, or configure Tokio recursively during a runtime transition"
      }
      TokioRuntimeTransitionMode::Wait => {
        "A custom Tokio runtime factory must not wait for another environment to load or unload the same addon"
      }
    };
    return Err(Error::new(crate::Status::WouldDeadlock, reason));
  }
  let _transition = match mode {
    TokioRuntimeTransitionMode::NonBlocking => match TOKIO_RUNTIME_TRANSITION.try_lock() {
      Ok(transition) => transition,
      Err(std::sync::TryLockError::Poisoned(error)) => error.into_inner(),
      Err(std::sync::TryLockError::WouldBlock) => {
        return Err(Error::new(
          crate::Status::WouldDeadlock,
          "Cannot start, shut down, or configure Tokio while another runtime transition is in progress",
        ));
      }
    },
    TokioRuntimeTransitionMode::Wait => TOKIO_RUNTIME_TRANSITION
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner),
  };
  let _active = TokioRuntimeTransitionGuard::enter()?;
  operation()
}

#[cfg(all(not(feature = "noop"), feature = "tokio_rt"))]
static TOKIO_RUNTIME_REQUIRES_MODULE_RETENTION: AtomicBool = AtomicBool::new(false);

#[cfg(all(not(feature = "noop"), feature = "tokio_rt"))]
#[cfg_attr(target_family = "wasm", allow(dead_code))]
pub(crate) fn tokio_runtime_requires_module_retention() -> bool {
  TOKIO_RUNTIME_REQUIRES_MODULE_RETENTION.load(Ordering::Acquire)
}

#[cfg(all(
  not(feature = "noop"),
  feature = "tokio_rt",
  not(feature = "async-runtime")
))]
fn runtime() -> (RuntimeUsePermit, TokioRuntimeLease) {
  try_runtime().unwrap_or_else(|error| panic!("{error}"))
}

#[cfg(all(not(feature = "noop"), feature = "tokio_rt"))]
fn try_runtime() -> Result<(RuntimeUsePermit, TokioRuntimeLease)> {
  #[cfg(feature = "async-runtime")]
  {
    acquire_tokio_runtime_for_use()
  }
  #[cfg(not(feature = "async-runtime"))]
  {
    // Initial use may construct the first generation. Admission is acquired only
    // after publication, then the lease is reacquired so it cannot name a
    // generation detached by a racing shutdown.
    drop(acquire_tokio_runtime(false)?);
    let runtime_use = RuntimeUsePermit::acquire().ok_or_else(|| {
      Error::new(
        crate::Status::GenericFailure,
        "Tokio runtime is not running",
      )
    })?;
    let runtime = acquire_tokio_runtime(false)?;
    Ok((runtime_use, runtime))
  }
}

#[cfg(all(not(feature = "noop"), feature = "tokio_rt"))]
enum UserDefinedTokioRuntime {
  OneShot(Box<Mutex<Option<PreparedTokioRuntime>>>),
  #[cfg(not(any(target_os = "aix", all(target_family = "wasm", tokio_unstable))))]
  Factory(Box<dyn Fn() -> Result<Runtime> + Send + Sync>),
}

#[cfg(all(not(feature = "noop"), feature = "tokio_rt"))]
static USER_DEFINED_RT: OnceLock<UserDefinedTokioRuntime> = OnceLock::new();

#[cfg(all(not(feature = "noop"), feature = "tokio_rt"))]
static USER_DEFINED_RT_REGISTRATION_ERROR: Mutex<Option<Error>> = Mutex::new(None);

#[cfg(all(not(feature = "noop"), feature = "tokio_rt"))]
fn user_defined_tokio_runtime_registration_error() -> Result<Option<Error>> {
  USER_DEFINED_RT_REGISTRATION_ERROR
    .lock()
    .unwrap_or_else(std::sync::PoisonError::into_inner)
    .as_ref()
    .map(Error::try_clone)
    .transpose()
}

#[cfg(all(not(feature = "noop"), feature = "tokio_rt"))]
const DUPLICATE_TOKIO_RUNTIME_ERROR: &str =
  "A custom Tokio runtime or runtime factory was registered more than once; the first registration \
   permanently owns the custom Tokio runtime slot";

#[cfg(all(not(feature = "noop"), feature = "tokio_rt"))]
const LATE_TOKIO_RUNTIME_REGISTRATION_ERROR: &str =
  "Cannot configure a custom Tokio runtime after the first runtime generation has started";

#[cfg(all(not(feature = "noop"), feature = "tokio_rt"))]
fn create_user_defined_runtime() -> Result<Option<PreparedTokioRuntime>> {
  match USER_DEFINED_RT.get() {
    Some(UserDefinedTokioRuntime::OneShot(runtime)) => Ok(
      runtime
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .take(),
    ),
    #[cfg(not(any(target_os = "aix", all(target_family = "wasm", tokio_unstable))))]
    Some(UserDefinedTokioRuntime::Factory(factory)) => {
      factory().and_then(prepare_supplied_tokio_runtime).map(Some)
    }
    None => Ok(None),
  }
}

#[cfg(all(not(feature = "noop"), feature = "tokio_rt"))]
fn try_register_user_defined_tokio_runtime(
  candidate: UserDefinedTokioRuntime,
) -> std::result::Result<(), (Error, UserDefinedTokioRuntime)> {
  if USER_DEFINED_RT.get().is_some() {
    return Err((
      Error::new(crate::Status::InvalidArg, DUPLICATE_TOKIO_RUNTIME_ERROR),
      candidate,
    ));
  }
  let state = TOKIO_RUNTIME_STATE
    .lock()
    .unwrap_or_else(std::sync::PoisonError::into_inner);
  if state.registration_closed {
    return Err((
      Error::new(
        crate::Status::InvalidArg,
        LATE_TOKIO_RUNTIME_REGISTRATION_ERROR,
      ),
      candidate,
    ));
  }

  match USER_DEFINED_RT.set(candidate) {
    Ok(()) => Ok(()),
    Err(candidate) => Err((
      Error::new(crate::Status::InvalidArg, DUPLICATE_TOKIO_RUNTIME_ERROR),
      candidate,
    )),
  }
}

#[cfg(all(not(feature = "noop"), feature = "tokio_rt"))]
fn prepare_supplied_tokio_runtime(runtime: Runtime) -> Result<PreparedTokioRuntime> {
  #[cfg(target_os = "aix")]
  {
    shutdown_supplied_tokio_runtime_without_retention(runtime);
    return Err(Error::new(
      crate::Status::GenericFailure,
      "Tokio runtimes are unsupported on AIX because napi cannot retain the addon image while \
       runtime threads or task wakers may still reference it",
    ));
  }

  #[cfg(all(target_family = "wasm", tokio_unstable))]
  {
    // Threaded WASI cannot pin a native image. Even a supplied current-thread
    // runtime may already own blocking-pool threads before napi can install an
    // environment cleanup owner. Fully retire it before reporting rejection.
    shutdown_supplied_tokio_runtime_without_retention(runtime);
    return Err(Error::new(
      crate::Status::GenericFailure,
      "Externally constructed Tokio runtimes are unsupported on threaded WASI because they can \
       start threads before a Node-API environment owns cleanup; use napi's built-in runtime",
    ));
  }

  #[cfg(not(any(target_os = "aix", all(target_family = "wasm", tokio_unstable))))]
  {
    #[cfg(not(target_family = "wasm"))]
    {
      // A supplied runtime may already own scheduler or blocking threads before
      // napi owns any environment cleanup hook. Pin before storing it.
      crate::bindgen_runtime::retain_current_module_for_unload_safety();
      TOKIO_RUNTIME_REQUIRES_MODULE_RETENTION.store(true, Ordering::Release);
    }

    #[cfg(not(target_family = "wasm"))]
    let may_spawn_untracked_threads = true;
    #[cfg(target_family = "wasm")]
    let may_spawn_untracked_threads = false;
    let workers = Arc::new(TokioRuntimeWorkerTracker::default());
    Ok(PreparedTokioRuntime {
      runtime,
      workers,
      may_spawn_untracked_threads,
    })
  }
}

#[cfg(all(not(feature = "noop"), feature = "tokio_rt"))]
fn shutdown_rejected_supplied_tokio_runtime(runtime: PreparedTokioRuntime) {
  let PreparedTokioRuntime {
    runtime, workers, ..
  } = runtime;
  drop(workers);
  #[cfg(not(target_family = "wasm"))]
  crate::bindgen_runtime::catch_unwind_safely(|| runtime.shutdown_background());
  #[cfg(all(target_family = "wasm", not(tokio_unstable)))]
  if std::panic::catch_unwind(AssertUnwindSafe(|| runtime.shutdown_background())).is_err() {
    std::process::abort();
  }
  #[cfg(all(target_family = "wasm", tokio_unstable))]
  {
    let (result_tx, result_rx) = std::sync::mpsc::sync_channel(1);
    let worker = std::thread::Builder::new()
      .name("napi-rejected-tokio-runtime".to_owned())
      .spawn(move || {
        let result = std::panic::catch_unwind(AssertUnwindSafe(|| drop(runtime))).map(|_| ());
        let _ = result_tx.send(result);
      })
      .unwrap_or_else(|_| std::process::abort());
    match result_rx.recv_timeout(std::time::Duration::from_secs(5)) {
      Ok(Ok(())) if worker.join().is_ok() => {}
      _ => std::process::abort(),
    }
  }
}

#[cfg(all(not(feature = "noop"), feature = "tokio_rt"))]
/// Configure the built-in Tokio runtime used by NAPI-RS, controlling its configuration yourself.
///
/// This affects the built-in Tokio path whenever `tokio_rt` is enabled. In a combined
/// `async-runtime` build, generated JavaScript-facing futures use this runtime when no custom
/// backend was registered before selection. With a selected custom backend, the established free
/// Tokio helpers construct their Tokio runtime lazily on first use.
/// ### Example
/// ```no_run
/// use tokio::runtime::Builder;
/// use napi::bindgen_prelude::create_custom_tokio_runtime;
///
/// #[napi_derive::module_init]
/// fn init() {
///    let rt = Builder::new_multi_thread().enable_all().thread_stack_size(32 * 1024 * 1024).build().unwrap();
///    create_custom_tokio_runtime(rt);
/// }
/// ```
///
/// While a supplied runtime that may own threads is retiring,
/// [`tokio_runtime_retirement_waiter`] returns [`crate::Status::WouldDeadlock`] instead of
/// blocking. A runtime handed to napi may create blocking threads after registration, and its
/// builder hooks cannot be retrofitted, so callers must retry after background retirement
/// completes.
///
/// Threaded WASI and AIX cannot retain an unloading module image, so externally built runtimes are
/// rejected after synchronous retirement. The fallible by-value API is not exported on those
/// targets because disposing a consumed Tokio runtime cannot guarantee a non-terminating return.
/// This compatibility wrapper ignores duplicate configuration, preserving its established
/// first-registration-wins behavior. The registration remains consumed after startup; shutdown and
/// restart never reopen it for a replacement runtime. Other registration failures are
/// recorded and returned the next time built-in Tokio is selected or a Tokio compatibility helper
/// is used. In a combined build, such a failure does not prevent a separately selected custom
/// [`AsyncRuntime`] from starting or restarting.
pub fn create_custom_tokio_runtime(rt: Runtime) {
  if let Err(error) = try_register_custom_tokio_runtime_by_value(rt) {
    if error.reason == DUPLICATE_TOKIO_RUNTIME_ERROR {
      return;
    }
    *USER_DEFINED_RT_REGISTRATION_ERROR
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(error);
  }
}

/// Try to configure the built-in Tokio runtime without panicking or terminating the process.
///
/// Call this from module initialization before any Tokio-backed napi work starts. Only the first
/// registration can succeed. Startup permanently consumes that registration, so later calls remain
/// duplicates across shutdown and restart and return an error after safely initiating retirement
/// of the rejected runtime.
///
/// This API is available only where rejecting its consumed [`Runtime`] can return without
/// terminating the process. Use [`try_create_custom_tokio_runtime_factory`] for a fallible
/// configuration API on AIX, threaded WASI, `noop`, or builds without `tokio_rt`.
#[cfg(all(
  not(feature = "noop"),
  feature = "tokio_rt",
  not(any(target_os = "aix", all(target_family = "wasm", tokio_unstable)))
))]
pub fn try_create_custom_tokio_runtime(rt: Runtime) -> Result<()> {
  try_register_custom_tokio_runtime_by_value(rt)
}

#[cfg(all(not(feature = "noop"), feature = "tokio_rt"))]
fn try_register_custom_tokio_runtime_by_value(rt: Runtime) -> Result<()> {
  let rt = prepare_supplied_tokio_runtime(rt)?;
  match try_register_user_defined_tokio_runtime(UserDefinedTokioRuntime::OneShot(Box::new(
    Mutex::new(Some(rt)),
  ))) {
    Ok(()) => Ok(()),
    Err((error, UserDefinedTokioRuntime::OneShot(runtime))) => {
      let runtime = (*runtime)
        .into_inner()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .expect("a newly prepared custom Tokio runtime cannot already be consumed");
      shutdown_rejected_supplied_tokio_runtime(runtime);
      Err(error)
    }
    #[cfg(not(any(target_os = "aix", all(target_family = "wasm", tokio_unstable))))]
    Err((_, UserDefinedTokioRuntime::Factory(_))) => {
      unreachable!("a concrete runtime registration cannot become a factory")
    }
  }
}

#[cfg(all(not(feature = "noop"), feature = "tokio_rt"))]
/// Configure a fresh built-in Tokio runtime for every NAPI-RS lifecycle generation.
///
/// Use this from module initialization when the addon's Tokio configuration must survive worker
/// teardown, Electron renderer reload, or an explicit shutdown/restart cycle. The factory is
/// retained for the process lifetime and called once whenever napi needs a new Tokio generation.
/// Factory calls are serialized with Tokio shutdown, but napi does not hold its runtime-state mutex
/// while invoking user code. Concurrent or reentrant Tokio startup and shutdown calls made while
/// the factory is running return [`crate::Status::WouldDeadlock`]. The factory must not
/// synchronously wait for another environment to finish loading or unloading the same addon:
/// internal environment activation and cleanup wait for runtime construction to finish.
///
/// The first concrete runtime or factory registration permanently owns the custom Tokio slot.
/// This compatibility wrapper ignores duplicate registration. Other registration failures are
/// recorded and returned the next time built-in Tokio is selected or a Tokio compatibility helper
/// is used; they do not prevent a separately selected custom [`AsyncRuntime`] from restarting in a
/// combined build. Use [`try_create_custom_tokio_runtime_factory`] when the caller must observe a
/// registration failure directly.
pub fn create_custom_tokio_runtime_factory<F, E>(factory: F)
where
  F: Fn() -> std::result::Result<Runtime, E> + Send + Sync + 'static,
  E: Into<Error>,
{
  if let Err(error) = try_create_custom_tokio_runtime_factory(factory) {
    if error.reason == DUPLICATE_TOKIO_RUNTIME_ERROR {
      return;
    }
    *USER_DEFINED_RT_REGISTRATION_ERROR
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(error);
  }
}

#[cfg(all(not(feature = "noop"), feature = "tokio_rt"))]
/// Try to configure a fresh built-in Tokio runtime for every lifecycle generation.
///
/// The factory must be thread-safe because different Node environments may initiate lifecycle
/// transitions from different threads, although construction itself is serialized. A factory
/// failure aborts only that startup attempt; a later explicit or environment-driven start calls
/// the same factory again. It must not synchronously wait for another environment to load or
/// unload the same addon. On AIX and threaded WASI, custom Tokio runtimes are unsupported and the
/// factory is rejected without being invoked.
pub fn try_create_custom_tokio_runtime_factory<F, E>(factory: F) -> Result<()>
where
  F: Fn() -> std::result::Result<Runtime, E> + Send + Sync + 'static,
  E: Into<Error>,
{
  #[cfg(any(target_os = "aix", all(target_family = "wasm", tokio_unstable)))]
  {
    let _ = factory;
    return Err(Error::new(
      crate::Status::InvalidArg,
      "Custom Tokio runtime factories are unsupported on this target; use napi's built-in runtime",
    ));
  }

  #[cfg(not(any(target_os = "aix", all(target_family = "wasm", tokio_unstable))))]
  {
    let factory = UserDefinedTokioRuntime::Factory(Box::new(move || factory().map_err(Into::into)));
    match try_register_user_defined_tokio_runtime(factory) {
      Ok(()) => Ok(()),
      Err((error, UserDefinedTokioRuntime::Factory(_))) => Err(error),
      Err((_, UserDefinedTokioRuntime::OneShot(_))) => {
        unreachable!("a factory registration cannot become a concrete runtime")
      }
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
/// the supplied Tokio runtime is retired without being installed. Use
/// [`try_create_custom_tokio_runtime_factory`] when configuration failure must be reported without
/// consuming a runtime.
pub fn create_custom_tokio_runtime(runtime: Runtime) {
  let _ = try_register_custom_tokio_runtime_by_value(runtime);
}

#[cfg(all(
  not(feature = "noop"),
  feature = "async-runtime",
  feature = "tokio",
  not(feature = "tokio_rt")
))]
fn try_register_custom_tokio_runtime_by_value(runtime: Runtime) -> Result<()> {
  #[cfg(not(target_family = "wasm"))]
  {
    crate::bindgen_runtime::retain_current_module_for_unload_safety();
    crate::bindgen_runtime::catch_unwind_safely(|| runtime.shutdown_background());
  }
  #[cfg(all(target_family = "wasm", tokio_unstable))]
  shutdown_supplied_tokio_runtime_without_retention(runtime);
  #[cfg(all(target_family = "wasm", not(tokio_unstable)))]
  if std::panic::catch_unwind(AssertUnwindSafe(|| drop(runtime))).is_err() {
    std::process::abort();
  }
  Err(Error::new(
    crate::Status::InvalidArg,
    "Cannot install a custom Tokio runtime because the tokio_rt feature is not enabled",
  ))
}

#[cfg(all(
  not(feature = "noop"),
  feature = "async-runtime",
  feature = "tokio",
  not(feature = "tokio_rt")
))]
/// Reject a custom Tokio factory when the built-in `tokio_rt` executor is disabled.
pub fn create_custom_tokio_runtime_factory<F, E>(factory: F)
where
  F: Fn() -> std::result::Result<Runtime, E> + Send + Sync + 'static,
  E: Into<Error>,
{
  let _ = try_create_custom_tokio_runtime_factory(factory);
}

#[cfg(all(
  not(feature = "noop"),
  feature = "async-runtime",
  feature = "tokio",
  not(feature = "tokio_rt")
))]
/// Reject a custom Tokio factory when the built-in `tokio_rt` executor is disabled.
pub fn try_create_custom_tokio_runtime_factory<F, E>(factory: F) -> Result<()>
where
  F: Fn() -> std::result::Result<Runtime, E> + Send + Sync + 'static,
  E: Into<Error>,
{
  let _ = factory;
  Err(Error::new(
    crate::Status::InvalidArg,
    "Cannot install a custom Tokio runtime factory because the tokio_rt feature is not enabled",
  ))
}

#[cfg(all(feature = "noop", feature = "tokio"))]
pub fn create_custom_tokio_runtime(runtime: Runtime) {
  let _ = try_register_custom_tokio_runtime_by_value(runtime);
}

#[cfg(all(feature = "noop", feature = "tokio"))]
fn try_register_custom_tokio_runtime_by_value(runtime: Runtime) -> Result<()> {
  #[cfg(all(target_family = "wasm", tokio_unstable))]
  shutdown_supplied_tokio_runtime_without_retention(runtime);
  #[cfg(not(all(target_family = "wasm", tokio_unstable)))]
  if std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| drop(runtime))).is_err() {
    // A noop build may not enable napi4 and therefore may have no loader
    // retention support. Do not return with unproven runtime quiescence.
    std::process::abort();
  }
  Err(Error::new(
    crate::Status::InvalidArg,
    "Cannot install a custom Tokio runtime in a noop build",
  ))
}

#[cfg(all(feature = "noop", feature = "tokio"))]
pub fn create_custom_tokio_runtime_factory<F, E>(factory: F)
where
  F: Fn() -> std::result::Result<Runtime, E> + Send + Sync + 'static,
  E: Into<Error>,
{
  let _ = try_create_custom_tokio_runtime_factory(factory);
}

#[cfg(all(feature = "noop", feature = "tokio"))]
/// Reject a custom Tokio factory in a `noop` build without invoking it.
pub fn try_create_custom_tokio_runtime_factory<F, E>(factory: F) -> Result<()>
where
  F: Fn() -> std::result::Result<Runtime, E> + Send + Sync + 'static,
  E: Into<Error>,
{
  let _ = factory;
  Err(Error::new(
    crate::Status::InvalidArg,
    "Cannot install a custom Tokio runtime factory in a noop build",
  ))
}

#[cfg(all(
  feature = "tokio",
  any(target_os = "aix", all(target_family = "wasm", tokio_unstable))
))]
fn shutdown_supplied_tokio_runtime_without_retention(runtime: Runtime) {
  let (result_tx, result_rx) = std::sync::mpsc::sync_channel(1);
  let worker = std::thread::Builder::new()
    .name("napi-supplied-tokio-runtime-shutdown".to_owned())
    .spawn(move || {
      let result =
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| drop(runtime))).map(|_| ());
      let _ = result_tx.send(result);
    })
    .unwrap_or_else(|_| std::process::abort());
  match result_rx.recv_timeout(std::time::Duration::from_secs(5)) {
    Ok(Ok(())) if worker.join().is_ok() => {}
    _ => std::process::abort(),
  }
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
fn call_custom_runtime_start() -> Result<()> {
  let _hook = RuntimeHookGuard::enter();
  std::panic::catch_unwind(AssertUnwindSafe(|| custom_async_runtime()?.start()))
    .map_err(crate::bindgen_runtime::panic_to_error)?
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
fn call_custom_runtime_shutdown() -> Result<()> {
  let _hook = RuntimeHookGuard::enter();
  match std::panic::catch_unwind(AssertUnwindSafe(|| custom_async_runtime()?.shutdown())) {
    Ok(result) => {
      CUSTOM_RUNTIME_SHUTDOWN_QUIESCENCE_UNPROVEN.store(false, Ordering::Release);
      result
    }
    Err(payload) => {
      CUSTOM_RUNTIME_SHUTDOWN_QUIESCENCE_UNPROVEN.store(true, Ordering::Release);
      #[cfg(not(target_family = "wasm"))]
      {
        retain_custom_async_runtime_module_once();
        Err(crate::bindgen_runtime::panic_to_error(payload))
      }
      #[cfg(target_family = "wasm")]
      {
        std::mem::forget(payload);
        std::process::abort()
      }
    }
  }
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
fn combine_runtime_shutdown_results(
  custom_result: Result<()>,
  tokio_result: Result<()>,
) -> Result<()> {
  match (custom_result, tokio_result) {
    (Ok(()), Ok(())) => Ok(()),
    (Err(error), Ok(())) | (Ok(()), Err(error)) => Err(error),
    (Err(custom_error), Err(tokio_error)) => Err(Error::new(
      crate::Status::GenericFailure,
      format!(
        "Custom async runtime shutdown failed: {}; additionally, Tokio runtime shutdown failed: {}",
        custom_error.reason, tokio_error.reason
      ),
    )),
  }
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
fn shutdown_runtime_backends(
  selection: AsyncRuntimeSelection,
  call_custom_shutdown: bool,
) -> Result<()> {
  let custom_result = if selection == AsyncRuntimeSelection::Custom && call_custom_shutdown {
    call_custom_runtime_shutdown()
  } else {
    Ok(())
  };
  #[cfg(feature = "tokio_rt")]
  let tokio_result = if selection == AsyncRuntimeSelection::Undecided {
    Ok(())
  } else {
    shutdown_tokio_runtime()
  };
  #[cfg(not(feature = "tokio_rt"))]
  let tokio_result = Ok(());
  combine_runtime_shutdown_results(custom_result, tokio_result)
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
fn rollback_failed_custom_runtime_start(selection: AsyncRuntimeSelection) -> Result<()> {
  shutdown_runtime_backends(selection, true)
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
#[derive(Clone, Copy, PartialEq, Eq)]
enum RuntimeStartReason {
  Environment,
  Explicit,
  #[cfg(feature = "tokio_rt")]
  RuntimeUse,
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
fn try_start_selected_runtime(reason: RuntimeStartReason) -> Result<()> {
  #[cfg(feature = "tokio_rt")]
  let tokio_registration_error = user_defined_tokio_runtime_registration_error()?;

  let finalizer_env = if reason == RuntimeStartReason::Explicit {
    runtime_finalizer_env()
      .map(|env| {
        crate::bindgen_runtime::registered_runtime_env(env)
          .ok_or_else(runtime_finalizer_without_owner_error)
      })
      .transpose()?
  } else {
    None
  };
  let selection = {
    let mut lifecycle = runtime_lifecycle();
    if reason != RuntimeStartReason::Environment
      && matches!(
        lifecycle.state,
        RuntimeLifecycleState::Starting | RuntimeLifecycleState::Stopping
      )
    {
      return Err(runtime_transition_in_progress_error());
    }
    if reason == RuntimeStartReason::Environment {
      lifecycle = wait_for_runtime_transition(lifecycle)?;
    }
    if let Some(message) = &lifecycle.registration_error {
      return Err(Error::new(crate::Status::GenericFailure, message.clone()));
    }
    let selection = select_runtime_for_use(&mut lifecycle)?;
    #[cfg(feature = "tokio_rt")]
    if selection == AsyncRuntimeSelection::Tokio {
      if let Some(error) = tokio_registration_error {
        return Err(error);
      }
    }
    if reason == RuntimeStartReason::Explicit {
      lifecycle.auto_start_enabled = true;
    } else if !lifecycle.auto_start_enabled {
      #[cfg(feature = "tokio_rt")]
      if reason == RuntimeStartReason::RuntimeUse {
        return Err(Error::new(
          crate::Status::GenericFailure,
          "The async runtime is stopped; call start_async_runtime before using it again",
        ));
      }
      return Ok(());
    } else if reason == RuntimeStartReason::Environment && lifecycle.active_envs == 0 {
      return Ok(());
    }
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
    selection
  };
  drop(finalizer_env);

  #[cfg(not(target_family = "wasm"))]
  if reason == RuntimeStartReason::Explicit && selection == AsyncRuntimeSelection::Custom {
    // Explicit startup can happen before Node calls napi_register_module_v1.
    // Retain first so an early registration failure cannot unload the backend
    // allocation, vtable, or work started by its hook.
    retain_custom_async_runtime_module_once();
  }

  let _transition = RuntimeTransitionGuard::enter();
  let mut shutdown_failed = false;
  let result = (|| {
    close_runtime_submissions()?;

    #[cfg(feature = "tokio_rt")]
    match selection {
      AsyncRuntimeSelection::Custom => {
        finish_tokio_runtime_retirement(reason == RuntimeStartReason::Environment)?;
      }
      AsyncRuntimeSelection::Tokio => {
        if reason == RuntimeStartReason::Environment {
          start_tokio_runtime_after_retirement()?;
        } else {
          start_tokio_runtime()?;
        }
      }
      AsyncRuntimeSelection::Undecided => unreachable!("startup requires a selected backend"),
    }

    if selection == AsyncRuntimeSelection::Custom {
      if let Err(error) = call_custom_runtime_start() {
        if let Err(cleanup) = rollback_failed_custom_runtime_start(selection) {
          shutdown_failed = true;
          return Err(lifecycle_error(error, cleanup));
        }
        return Err(error);
      }
    }

    open_runtime_submissions();
    Ok(())
  })();
  finish_runtime_transition(&result, shutdown_failed);
  result
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
struct RuntimeLifecyclePublication {
  state: RuntimeLifecycleState,
  startup_error: Option<String>,
  published: bool,
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
impl RuntimeLifecyclePublication {
  fn shutdown() -> Self {
    Self {
      state: RuntimeLifecycleState::ShutdownFailed,
      startup_error: Some("Async runtime lifecycle transition did not complete".to_owned()),
      published: false,
    }
  }

  fn set_state(&mut self, state: RuntimeLifecycleState, startup_error: Option<String>) {
    self.state = state;
    self.startup_error = startup_error;
  }

  fn set_shutdown_result(&mut self, result: &Result<()>) {
    self.state = if result.is_ok() {
      RuntimeLifecycleState::Stopped
    } else {
      RuntimeLifecycleState::ShutdownFailed
    };
    self.startup_error = result.as_ref().err().map(|error| error.reason.clone());
  }

  fn publish(&mut self) {
    let mut lifecycle = runtime_lifecycle();
    lifecycle.state = self.state;
    lifecycle.startup_error = self.startup_error.take();
    self.published = true;
    RUNTIME_LIFECYCLE.1.notify_all();
  }
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
impl Drop for RuntimeLifecyclePublication {
  fn drop(&mut self) {
    if !self.published {
      self.publish();
    }
  }
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
fn finish_runtime_retirement_without_shutdown(
  previous_state: RuntimeLifecycleState,
  previous_error: Option<String>,
  retirement: impl FnOnce(),
) -> Result<()> {
  let _transition = RuntimeTransitionGuard::enter();
  let mut publication = RuntimeLifecyclePublication::shutdown();
  retirement();
  publication.set_state(previous_state, previous_error);
  publication.publish();
  Ok(())
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
fn finish_selected_runtime_shutdown_with_retirement(
  selection: AsyncRuntimeSelection,
  call_custom_shutdown: bool,
  retirement: impl FnOnce(),
) -> Result<()> {
  let _transition = RuntimeTransitionGuard::enter();
  let mut publication = RuntimeLifecyclePublication::shutdown();
  let result: Result<()> = (|| {
    close_runtime_submissions()?;
    cancel_all_env_tasks();
    shutdown_runtime_backends(selection, call_custom_shutdown)
  })();

  retirement();
  publication.set_shutdown_result(&result);
  publication.publish();
  result
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
fn finish_selected_runtime_shutdown(
  selection: AsyncRuntimeSelection,
  call_custom_shutdown: bool,
) -> Result<()> {
  finish_selected_runtime_shutdown_with_retirement(selection, call_custom_shutdown, || {})
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
fn selected_runtime_for_use() -> Result<AsyncRuntimeSelection> {
  let selection = {
    let mut lifecycle = runtime_lifecycle();
    if let Some(message) = &lifecycle.registration_error {
      return Err(Error::new(crate::Status::GenericFailure, message.clone()));
    }
    let selection = select_runtime_for_use(&mut lifecycle)?;
    if selection == AsyncRuntimeSelection::Custom {
      let hook_local_transition = RUNTIME_HOOK_DEPTH.with(Cell::get) != 0
        && RUNTIME_SUBMISSION_DEPTH.with(Cell::get) == 0
        && matches!(
          lifecycle.state,
          RuntimeLifecycleState::Starting | RuntimeLifecycleState::Stopping
        );
      if lifecycle.state == RuntimeLifecycleState::Running || hook_local_transition {
        return Ok(selection);
      }
      return Err(Error::new(
        crate::Status::GenericFailure,
        lifecycle
          .startup_error
          .clone()
          .unwrap_or_else(|| "The async runtime is not running".to_owned()),
      ));
    }
    selection
  };

  #[cfg(feature = "tokio_rt")]
  if selection == AsyncRuntimeSelection::Tokio {
    try_start_selected_runtime(RuntimeStartReason::RuntimeUse)?;
  }
  Ok(selection)
}

#[cfg(all(feature = "async-runtime", not(feature = "noop"), feature = "tokio_rt"))]
fn acquire_tokio_runtime_for_use() -> Result<(RuntimeUsePermit, TokioRuntimeLease)> {
  let selection = selected_runtime_for_use()?;
  let allow_restart = selection == AsyncRuntimeSelection::Custom;
  let runtime_use = match selection {
    AsyncRuntimeSelection::Custom => acquire_synchronous_runtime_use()?,
    AsyncRuntimeSelection::Tokio => acquire_runtime_use()?,
    AsyncRuntimeSelection::Undecided => unreachable!("runtime use requires a selected backend"),
  };
  // Selected Tokio startup is committed by `selected_runtime_for_use`. A selected
  // custom backend may construct its compatibility Tokio peer here. In both cases
  // admission prevents shutdown from detaching the generation before handoff.
  let runtime = acquire_tokio_runtime(allow_restart)?;
  Ok((runtime_use, runtime))
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
fn generated_futures_use_custom_runtime() -> Result<bool> {
  Ok(selected_runtime_for_use()? == AsyncRuntimeSelection::Custom)
}

#[cfg(not(feature = "noop"))]
/// Start the async runtime.
///
/// With only `async-runtime`, this delegates to the registered `AsyncRuntime` backend's `start`
/// and reports a clear error when no backend was registered. In a combined
/// `async-runtime` + `tokio_rt` build, a timely custom registration selects and starts only that
/// backend; the established Tokio compatibility helpers construct Tokio lazily on first use.
/// Otherwise, environment activation or earlier runtime use selects the built-in Tokio runtime and
/// `async-runtime` remains additive. In a combined build, calling this before registering a custom
/// backend intentionally commits the built-in Tokio selection and later custom registration is
/// rejected. A missing-backend error in a pure `async-runtime` build before any environment is
/// activated leaves later registration available.
/// Without `async-runtime`, this starts only Tokio.
///
/// In Node.js native targets, active runtime resources are shut down when the last Node
/// environment exits. A registered custom backend object remains process-lifetime and is reused
/// when a worker or Electron renderer creates a new environment, so its `start` and `shutdown`
/// hooks must support repeated cycles. An explicit start also re-enables this
/// environment-driven startup after an explicit shutdown.
///
/// On wasm, shutdown uses the host's Node-API environment cleanup hook just like native targets,
/// or you can call `shutdown_async_runtime` explicitly. A custom `async-runtime` backend controls
/// its own lifetime. In some scenarios you may want to start the runtime again, e.g. in tests.
/// This compatibility wrapper reports startup failures to stderr; use
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
/// a new Tokio generation that overlaps the old one. This also returns
/// [`crate::Status::WouldDeadlock`] rather than waiting when another lifecycle transition is
/// already in progress.
#[cfg(not(feature = "noop"))]
pub fn try_start_async_runtime() -> Result<()> {
  ensure_explicit_runtime_transition_allowed()?;
  #[cfg(feature = "async-runtime")]
  {
    try_start_selected_runtime(RuntimeStartReason::Explicit)
  }
  #[cfg(all(feature = "tokio_rt", not(feature = "async-runtime")))]
  {
    if let Some(env) = runtime_finalizer_env() {
      crate::bindgen_runtime::with_registered_runtime_env(env, start_tokio_runtime)
        .ok_or_else(runtime_finalizer_without_owner_error)?
    } else {
      start_tokio_runtime()
    }
  }
  #[cfg(not(any(feature = "async-runtime", feature = "tokio_rt")))]
  {
    Ok(())
  }
}

#[cfg(not(feature = "noop"))]
/// Shut the async runtime down.
///
/// With only `async-runtime`, this shuts down the selected custom backend. In a combined
/// `async-runtime` + `tokio_rt` build it shuts down either the selected built-in Tokio runtime or
/// the selected custom backend and any Tokio peer that its compatibility helpers created lazily.
/// Without `async-runtime`, it takes down only Tokio. Explicit shutdown is sticky: registering
/// another Node worker or environment does not restart the selected backend until
/// [`start_async_runtime`] or [`try_start_async_runtime`] is called. Automatic shutdown after the
/// last environment exits remains restartable by a later environment. New environments can still
/// load the addon while explicitly stopped, but runtime-backed operations reject until restart.
///
/// On native addons, once the built-in Tokio runtime has been created, last-environment cleanup
/// may keep the native image mapped for the process lifetime even after Tokio worker threads and
/// runtime resources retire. Safe Rust code can retain task wakers whose wake, clone, or drop
/// vtables point into the addon after `Runtime::drop`; retaining the image is an unload-safety
/// policy, not a failure to retire the runtime.
pub fn shutdown_async_runtime() {
  if let Err(error) = try_shutdown_async_runtime() {
    crate::bindgen_runtime::catch_unwind_safely(|| {
      eprintln!("Failed to shut down async runtime: {error}");
    });
  }
}

/// Fallible form of [`shutdown_async_runtime`].
///
/// Returns [`crate::Status::WouldDeadlock`] rather than waiting when another lifecycle transition
/// is already in progress.
#[cfg(not(feature = "noop"))]
pub fn try_shutdown_async_runtime() -> Result<()> {
  ensure_explicit_runtime_transition_allowed()?;
  #[cfg(feature = "async-runtime")]
  {
    let finalizer_env = runtime_finalizer_env()
      .map(|env| {
        crate::bindgen_runtime::registered_runtime_env(env)
          .ok_or_else(runtime_finalizer_without_owner_error)
      })
      .transpose()?;
    let (selection, call_custom_shutdown) = {
      let mut lifecycle = runtime_lifecycle();
      if matches!(
        lifecycle.state,
        RuntimeLifecycleState::Starting | RuntimeLifecycleState::Stopping
      ) {
        return Err(runtime_transition_in_progress_error());
      }
      lifecycle.auto_start_enabled = false;
      let selection = lifecycle.selection;
      let call_custom_shutdown = selection == AsyncRuntimeSelection::Custom
        && matches!(
          lifecycle.state,
          RuntimeLifecycleState::Stopped
            | RuntimeLifecycleState::Running
            | RuntimeLifecycleState::ShutdownFailed
        );
      lifecycle.state = RuntimeLifecycleState::Stopping;
      (selection, call_custom_shutdown)
    };
    drop(finalizer_env);
    finish_selected_runtime_shutdown(selection, call_custom_shutdown)
  }
  #[cfg(all(feature = "tokio_rt", not(feature = "async-runtime")))]
  {
    if let Some(env) = runtime_finalizer_env() {
      crate::bindgen_runtime::with_registered_runtime_env(env, shutdown_tokio_runtime)
        .ok_or_else(runtime_finalizer_without_owner_error)?
    } else {
      shutdown_tokio_runtime()
    }
  }
  #[cfg(not(any(feature = "async-runtime", feature = "tokio_rt")))]
  {
    Ok(())
  }
}

#[cfg(all(not(feature = "noop"), feature = "tokio_rt"))]
pub(crate) fn start_tokio_runtime() -> Result<()> {
  loop {
    match start_tokio_runtime_impl(true) {
      Ok(()) => return Ok(()),
      Err(error)
        if error.status == crate::Status::WouldDeadlock
          && error.reason == "Tokio runtime is still shutting down" =>
      {
        if try_join_finished_tokio_runtime_retirement()? {
          continue;
        }
        return Err(error);
      }
      Err(error) => return Err(error),
    }
  }
}

#[cfg(all(not(feature = "noop"), feature = "tokio_rt"))]
pub(crate) fn start_tokio_runtime_after_retirement() -> Result<()> {
  loop {
    match acquire_tokio_runtime_with_transition(
      true,
      TokioRuntimeTransitionMode::Wait,
      TokioRuntimeAcquisitionMode::LifecycleStart,
    )
    .map(drop)
    {
      Ok(()) => return Ok(()),
      Err(error)
        if error.status == crate::Status::WouldDeadlock
          && error.reason == "Tokio runtime is still shutting down" =>
      {
        let waiter = tokio_runtime_retirement_waiter();
        #[cfg(any(
          not(target_family = "wasm"),
          all(target_family = "wasm", tokio_unstable)
        ))]
        waiter.wait_for(std::time::Duration::from_secs(5))?;
        #[cfg(all(target_family = "wasm", not(tokio_unstable)))]
        waiter.wait()?;
      }
      Err(error) => return Err(error),
    }
  }
}

#[cfg(all(not(feature = "noop"), feature = "tokio_rt"))]
fn start_tokio_runtime_impl(allow_restart: bool) -> Result<()> {
  acquire_tokio_runtime_with_transition(
    allow_restart,
    TokioRuntimeTransitionMode::NonBlocking,
    TokioRuntimeAcquisitionMode::LifecycleStart,
  )
  .map(drop)
}

#[cfg(all(not(feature = "noop"), feature = "tokio_rt"))]
fn acquire_tokio_runtime(allow_restart: bool) -> Result<TokioRuntimeLease> {
  acquire_tokio_runtime_with_transition(
    allow_restart,
    TokioRuntimeTransitionMode::NonBlocking,
    TokioRuntimeAcquisitionMode::RuntimeUse,
  )
}

#[cfg(all(not(feature = "noop"), feature = "tokio_rt"))]
fn acquire_tokio_runtime_with_transition(
  allow_restart: bool,
  transition_mode: TokioRuntimeTransitionMode,
  acquisition_mode: TokioRuntimeAcquisitionMode,
) -> Result<TokioRuntimeLease> {
  std::panic::catch_unwind(AssertUnwindSafe(|| -> Result<TokioRuntimeLease> {
    if let Some(error) = user_defined_tokio_runtime_registration_error()? {
      return Err(error);
    }
    if acquisition_mode == TokioRuntimeAcquisitionMode::RuntimeUse {
      // A runtime-use caller may already hold admission while shutdown owns the transition and
      // waits for that handoff. Explicit lifecycle starts must serialize instead of reporting a
      // generation whose admission gate has already closed.
      let state = TOKIO_RUNTIME_STATE
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
      if state.lifecycle == TokioRuntimeLifecycle::Running {
        let generation = state
          .generation
          .as_ref()
          .expect("running Tokio lifecycle must own a generation");
        return Ok(TokioRuntimeLease {
          runtime: Arc::clone(&generation.runtime),
          retirement: Arc::clone(&generation.retirement),
        });
      }
    }

    with_tokio_runtime_transition(transition_mode, || {
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
      match state
        .retiring
        .as_ref()
        .map(|retirement| retirement.status())
      {
        Some(TokioRuntimeRetirementStatus::Pending) => {
          return Err(Error::new(
            crate::Status::WouldDeadlock,
            "Tokio runtime is still shutting down",
          ));
        }
        Some(TokioRuntimeRetirementStatus::Failed(reason)) => {
          return Err(Error::new(
            crate::Status::GenericFailure,
            format!("Tokio runtime retirement failed: {reason}"),
          ));
        }
        Some(TokioRuntimeRetirementStatus::Complete) | None => {}
      }
      state.retiring = None;
      let lifecycle = state.lifecycle;
      state.registration_closed = true;
      drop(state);

      let generation = NEXT_TOKIO_RUNTIME_GENERATION.fetch_add(1, Ordering::Relaxed);
      #[cfg(not(target_family = "wasm"))]
      crate::bindgen_runtime::retain_current_module_for_unload_safety();
      let PreparedTokioRuntime {
        runtime: rt,
        workers,
        may_spawn_untracked_threads,
      } = create_runtime(generation)?;
      // Pin before creating workers: Tokio task wakers may be cloned outside
      // napi's ownership, and a constructor-time caller can create this
      // generation before any Node environment owns a cleanup hook.
      TOKIO_RUNTIME_REQUIRES_MODULE_RETENTION.store(true, Ordering::Release);
      let retirement = Arc::new(TokioRuntimeRetirementSignal::new_with_worker_tracking(
        generation,
        Some(rt.handle().id()),
        workers,
        may_spawn_untracked_threads,
      ));
      let runtime = Arc::new(SharedTokioRuntime {
        runtime: Some(rt),
        retirement: Some(Arc::clone(&retirement)),
      });
      let mut state = TOKIO_RUNTIME_STATE
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
      debug_assert!(state.lifecycle == lifecycle);
      debug_assert!(state.generation.is_none());
      state.generation = Some(TokioRuntimeGeneration {
        runtime: Arc::clone(&runtime),
        retirement: Arc::clone(&retirement),
      });
      state.lifecycle = TokioRuntimeLifecycle::Running;
      #[cfg(not(feature = "async-runtime"))]
      open_runtime_submissions();
      Ok(TokioRuntimeLease {
        runtime,
        retirement,
      })
    })
  }))
  .map_err(crate::bindgen_runtime::panic_to_error)
  .and_then(|result| result)
}

#[cfg(all(not(feature = "noop"), feature = "tokio_rt"))]
pub(crate) fn shutdown_tokio_runtime() -> Result<()> {
  shutdown_tokio_runtime_with_transition(TokioRuntimeTransitionMode::NonBlocking)
}

#[cfg(all(not(feature = "noop"), feature = "tokio_rt"))]
pub(crate) fn shutdown_tokio_runtime_after_transition() -> Result<()> {
  shutdown_tokio_runtime_with_transition(TokioRuntimeTransitionMode::Wait)
}

#[cfg(all(not(feature = "noop"), feature = "tokio_rt"))]
fn shutdown_tokio_runtime_with_transition(
  transition_mode: TokioRuntimeTransitionMode,
) -> Result<()> {
  let rt = std::panic::catch_unwind(AssertUnwindSafe(|| {
    with_tokio_runtime_transition(
      transition_mode,
      || -> Result<Option<TokioRuntimeGeneration>> {
        // Combined builds close and drain selected-runtime admission before
        // entering the Tokio backend. A pure Tokio build constructs its first
        // generation before admission, so an admitted caller never needs this
        // transition lock to finish a handoff to the current generation.
        #[cfg(not(feature = "async-runtime"))]
        close_runtime_submissions()?;
        let generation = {
          let mut state = TOKIO_RUNTIME_STATE
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
          match state.lifecycle {
            TokioRuntimeLifecycle::Uninitialized => {
              state.lifecycle = TokioRuntimeLifecycle::Stopped;
              None
            }
            TokioRuntimeLifecycle::Stopped => None,
            TokioRuntimeLifecycle::Running => {
              let generation = state.generation.take();
              if let Some(generation) = &generation {
                state.retiring = Some(Arc::clone(&generation.retirement));
              }
              state.lifecycle = TokioRuntimeLifecycle::Stopped;
              generation
            }
          }
        };
        // In a pure Tokio build, keep transition serialization through
        // cancellation. Otherwise a stopped/no-generation shutdown can race a
        // restart and abort work registered by the newly published generation.
        #[cfg(not(feature = "async-runtime"))]
        cancel_all_env_tasks();
        Ok(generation)
      },
    )
  }))
  .map_err(crate::bindgen_runtime::panic_to_error)
  .and_then(|result| result)?;

  drop(rt);
  Ok(())
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
enum JoinErrorKind {
  Panic(SafeDrop<Box<dyn Any + Send + 'static>>),
  Cancelled,
  Rejected(Error),
  Runtime(Error),
}

/// The error returned when joining a [`JoinHandle`] whose task panicked, was cancelled, was
/// rejected by the backend, or could not be submitted to the runtime.
///
/// This is napi's runtime-agnostic analogue of `tokio::task::JoinError`, produced by the
/// explicit [`spawn_on_custom_runtime`]/[`spawn_blocking_on_custom_runtime`] helpers.
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

  fn rejected(error: Error) -> Self {
    Self {
      kind: JoinErrorKind::Rejected(error),
    }
  }

  fn runtime(error: Error) -> Self {
    Self {
      kind: JoinErrorKind::Runtime(error),
    }
  }

  fn from_cancellation_reason(reason: AsyncRuntimeCancellationReason) -> Self {
    match reason {
      AsyncRuntimeCancellationReason::Cancelled => Self::cancelled(),
      AsyncRuntimeCancellationReason::Rejected(error) => Self::rejected(error),
      AsyncRuntimeCancellationReason::Failed(error) => Self::runtime(error),
    }
  }

  /// Whether the task failed because it panicked.
  pub fn is_panic(&self) -> bool {
    matches!(self.kind, JoinErrorKind::Panic(_))
  }

  /// Whether accepted work was later dropped or shutdown cancelled it.
  pub fn is_cancelled(&self) -> bool {
    matches!(self.kind, JoinErrorKind::Cancelled)
  }

  /// Whether the backend immediately declined the submitted work.
  pub fn is_rejected(&self) -> bool {
    matches!(self.kind, JoinErrorKind::Rejected(_))
  }

  /// Whether the task could not be submitted because the runtime was unavailable or its
  /// submission hook failed.
  pub fn is_runtime_error(&self) -> bool {
    matches!(self.kind, JoinErrorKind::Runtime(_))
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
      kind => Err(Self { kind }),
    }
  }

  /// Consume the error, returning the backend-rejection diagnostic.
  pub fn into_rejection_error(self) -> Error {
    self
      .try_into_rejection_error()
      .expect("JoinError does not contain a backend rejection")
  }

  /// Consume the error, returning the diagnostic when the backend rejected the work.
  pub fn try_into_rejection_error(self) -> std::result::Result<Error, Self> {
    match self.kind {
      JoinErrorKind::Rejected(error) => Ok(error),
      kind => Err(Self { kind }),
    }
  }

  /// Consume the error, returning the runtime lifecycle or submission error.
  pub fn into_runtime_error(self) -> Error {
    self
      .try_into_runtime_error()
      .expect("JoinError does not contain a runtime error")
  }

  /// Consume the error, returning the runtime error when lifecycle validation or submission failed.
  pub fn try_into_runtime_error(self) -> std::result::Result<Error, Self> {
    match self.kind {
      JoinErrorKind::Runtime(error) => Ok(error),
      kind => Err(Self { kind }),
    }
  }
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
impl std::fmt::Debug for JoinError {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    match self.kind {
      JoinErrorKind::Panic(_) => f.write_str("JoinError::Panic(...)"),
      JoinErrorKind::Cancelled => f.write_str("JoinError::Cancelled"),
      JoinErrorKind::Rejected(ref error) => {
        f.debug_tuple("JoinError::Rejected").field(error).finish()
      }
      JoinErrorKind::Runtime(ref error) => {
        f.debug_tuple("JoinError::Runtime").field(error).finish()
      }
    }
  }
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
impl std::fmt::Display for JoinError {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    match self.kind {
      JoinErrorKind::Panic(_) => f.write_str("task panicked"),
      JoinErrorKind::Cancelled => f.write_str("task was cancelled"),
      JoinErrorKind::Rejected(ref error) => write!(f, "task submission was rejected: {error}"),
      JoinErrorKind::Runtime(ref error) => write!(f, "task submission failed: {error}"),
    }
  }
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
impl std::error::Error for JoinError {
  fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
    match &self.kind {
      JoinErrorKind::Rejected(error) | JoinErrorKind::Runtime(error) => Some(error),
      JoinErrorKind::Panic(_) | JoinErrorKind::Cancelled => None,
    }
  }
}

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

  fn clear_consumer_waker(&self) {
    let waker = self
      .inner
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner)
      .waker
      .take();
    if let Some(waker) = waker {
      drop_safely(waker);
    }
  }
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
struct BlockingWorkState<F, R: Send + 'static> {
  func: Option<F>,
  task_state: Option<Arc<JoinState<R>>>,
  submission: Arc<AsyncRuntimeSubmission>,
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
impl<F, R> BlockingWorkState<F, R>
where
  F: FnOnce() -> R,
  R: Send + 'static,
{
  fn new(func: F, state: Arc<JoinState<R>>, submission: Arc<AsyncRuntimeSubmission>) -> Self {
    Self {
      func: Some(func),
      task_state: Some(state),
      submission,
    }
  }

  fn run(mut self) {
    let _operation = RuntimeOperationGuard::enter();
    if !self.submission.start() {
      return;
    }
    let func = self
      .func
      .take()
      .expect("blocking work function is present until execution");
    let task_state = self
      .task_state
      .take()
      .expect("blocking work join state is present until execution");
    let result = std::panic::catch_unwind(AssertUnwindSafe(func));
    task_state.complete(result.map_err(JoinError::new_panic));
    self.submission.complete();
  }
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
impl<F, R: Send + 'static> Drop for BlockingWorkState<F, R> {
  fn drop(&mut self) {
    let _operation = RuntimeOperationGuard::enter();
    if let Some(func) = self.func.take() {
      drop_safely(func);
    }
    self.submission.cancel(None);
    if let Some(task_state) = self.task_state.take() {
      drop_safely(task_state);
    }
  }
}

/// A napi-owned handle to a task spawned via [`spawn_on_custom_runtime`] or
/// [`spawn_blocking_on_custom_runtime`].
///
/// Await it to join the task: it resolves to the task's output, or to a [`JoinError`]
/// carrying the panic payload if the task panicked on an unwind-enabled build. With
/// `panic = "abort"`, a panic cannot settle the handle. Unlike `tokio::task::JoinHandle` it is
/// join-only — there is no `abort`; detach the task by dropping the handle. Immediate backend
/// rejection resolves with a rejection error, while dropping accepted work resolves with a
/// cancellation error. A pre-submission lifecycle failure resolves with a runtime error. On an
/// unwind-enabled build, a panicking submission hook also resolves the handle with a runtime error
/// preserving the panic diagnostic.
#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
pub struct JoinHandle<T> {
  state: Arc<JoinState<T>>,
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
impl<T> Drop for JoinHandle<T> {
  fn drop(&mut self) {
    self.state.clear_consumer_waker();
  }
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
///
/// On threadless `wasm32-wasip1` this panics immediately because its current-thread Tokio runtime
/// has no background driver. Use a registered custom runtime or a threaded WASI target.
pub fn spawn<F>(fut: F) -> tokio::task::JoinHandle<F::Output>
where
  F: 'static + Send + Future<Output = ()>,
{
  #[cfg(all(target_family = "wasm", not(tokio_unstable)))]
  {
    drop_safely(fut);
    panic!("{}", threadless_wasi_builtin_tokio_error().reason);
  }
  #[cfg(any(
    all(target_family = "wasm", tokio_unstable),
    not(target_family = "wasm")
  ))]
  {
    let mut fut = SafeDrop::new(fut);
    let (_runtime_use, runtime) = {
      #[cfg(feature = "async-runtime")]
      {
        acquire_tokio_runtime_for_use().unwrap_or_else(|error| panic!("{error}"))
      }
      #[cfg(not(feature = "async-runtime"))]
      {
        runtime()
      }
    };
    let retirement = runtime.retirement_signal();
    let generation = runtime.generation();
    let workers = runtime.worker_tracker();
    let register_worker = matches!(
      runtime.handle().runtime_flavor(),
      tokio::runtime::RuntimeFlavor::MultiThread
    );
    runtime.spawn(TokioRuntimeGenerationFuture::new(
      async move {
        let _retirement = retirement;
        fut.take().await
      },
      generation,
      workers,
      register_worker,
    ))
  }
}

#[cfg(all(not(feature = "noop"), feature = "async-runtime"))]
/// Spawn a future onto the registered [`AsyncRuntime`] backend, returning a joinable
/// [`JoinHandle`].
///
/// The joinable-ness is manufactured by napi over [`spawn`](AsyncRuntime::spawn): the future
/// is wrapped so that its output — or, on an unwind-enabled build, a caught panic payload as a
/// [`JoinError`] — is handed to the returned handle. With `panic = "abort"`, a panic traps or
/// aborts before the handle can be settled. This name and routing are unchanged when `tokio_rt`
/// is also enabled; the Tokio-backed compatibility helper remains `spawn`. Missing, stopped, or
/// transitioning runtime states are reported as runtime errors, an immediate backend decline is
/// reported as rejection, and accepted work dropped later reports cancellation.
pub fn spawn_on_custom_runtime<F>(fut: F) -> JoinHandle<F::Output>
where
  F: 'static + Send + Future,
  F::Output: 'static + Send,
{
  let state = Arc::new(JoinState::new());
  let task_state = state.clone();
  let cancellation_state = state.clone();
  let mut task = AsyncRuntimeTask::new_with_cancellation_reason(
    async move {
      let result = AssertUnwindSafe(fut).catch_unwind().await;
      AsyncTaskOutcome::Completed(Box::new(move || {
        task_state.complete(result.map_err(JoinError::new_panic));
      }))
    },
    move |reason| {
      cancellation_state.complete(Err(JoinError::from_cancellation_reason(reason)));
    },
  );
  let runtime = match custom_async_runtime_for_use() {
    Ok(runtime) => runtime,
    Err(error) => {
      task.reject(error);
      return JoinHandle { state };
    }
  };
  let _submission = match acquire_runtime_use() {
    Ok(submission) => submission,
    Err(error) => {
      task.reject(error);
      return JoinHandle { state };
    }
  };
  let submission = task.begin_submission();
  match std::panic::catch_unwind(AssertUnwindSafe(|| runtime.spawn(task))) {
    Ok(Ok(())) => {
      let _ = submission.accept();
    }
    Ok(Err(rejection)) => {
      let (task, error) = rejection.into_parts();
      submission.reject(error);
      drop(task);
    }
    Err(reason) => {
      submission.fail(crate::bindgen_runtime::panic_to_error(reason));
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

#[cfg(all(not(feature = "noop"), feature = "async-runtime"))]
/// Run a future to completion on the registered [`AsyncRuntime`] backend.
///
/// Unlike [`block_on`], this explicit helper always requires a registered custom backend. It
/// panics when that backend is unavailable, stopped, transitioning, returns an error, panics, or
/// returns before the future completes. Exported N-API callbacks should prefer
/// [`try_block_on_custom_runtime`] so the error can become a JavaScript exception.
pub fn block_on_custom_runtime<F: Future>(fut: F) -> F::Output {
  try_block_on_custom_runtime(fut).unwrap_or_else(|error| panic!("{error}"))
}

#[cfg(not(feature = "noop"))]
fn try_block_on_safely<F: Future>(
  fut: F,
  block_on: impl FnOnce(Pin<&mut dyn Future<Output = ()>>) -> Result<()>,
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
    block_on(driver.as_mut())
  }))
  .map_err(crate::bindgen_runtime::panic_to_error)??;
  output.take().ok_or_else(|| {
    Error::new(
      crate::Status::GenericFailure,
      "Async runtime returned before the future completed",
    )
  })
}

#[cfg(all(not(feature = "noop"), feature = "async-runtime"))]
/// Fallible form of [`block_on_custom_runtime`].
///
/// This always delegates to [`AsyncRuntime::block_on`], including in combined
/// `async-runtime` + `tokio_rt` builds. It rejects calls before startup, during lifecycle
/// transitions, and after shutdown, preserves errors returned by the backend, and keeps shutdown
/// from overlapping the synchronous drive.
pub fn try_block_on_custom_runtime<F: Future>(fut: F) -> Result<F::Output> {
  let mut fut = SafeDrop::new(fut);
  let runtime = custom_async_runtime_for_use()?;
  let _runtime_use = acquire_synchronous_runtime_use()?;
  try_block_on_safely(fut.take(), |future| runtime.block_on(future))
}

#[cfg(not(feature = "noop"))]
/// Fallible form of [`block_on`].
///
/// This reports a missing backend, a backend error, or a backend that returned before polling the
/// future to completion as a napi error. On unwind-enabled builds, it also converts a backend panic
/// into a napi error; with `panic = "abort"`, that panic traps or aborts instead. When
/// `async-runtime` is enabled it also rejects calls before startup, during lifecycle transitions,
/// and after shutdown, and prevents shutdown from overlapping the synchronous drive.
pub fn try_block_on<F: Future>(fut: F) -> Result<F::Output> {
  #[cfg(all(feature = "async-runtime", not(feature = "tokio_rt")))]
  {
    try_block_on_custom_runtime(fut)
  }
  #[cfg(feature = "tokio_rt")]
  {
    let mut fut = SafeDrop::new(fut);
    let (_runtime_use, runtime) = try_runtime()?;
    let generation = runtime.generation();
    try_block_on_safely(fut.take(), |future| {
      let _generation = TokioRuntimeGenerationGuard::enter(generation);
      runtime.block_on(future);
      Ok(())
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
///
/// On threadless `wasm32-wasip1` this panics immediately because native blocking threads are
/// unavailable. Use a registered custom runtime or a threaded WASI target.
pub fn spawn_blocking<F, R>(func: F) -> tokio::task::JoinHandle<R>
where
  F: FnOnce() -> R + Send + 'static,
  R: Send + 'static,
{
  #[cfg(all(target_family = "wasm", not(tokio_unstable)))]
  {
    drop_safely(func);
    panic!("{}", threadless_wasi_builtin_tokio_error().reason);
  }
  #[cfg(any(
    all(target_family = "wasm", tokio_unstable),
    not(target_family = "wasm")
  ))]
  {
    let mut func = SafeDrop::new(func);
    let (_runtime_use, runtime) = {
      #[cfg(feature = "async-runtime")]
      {
        acquire_tokio_runtime_for_use().unwrap_or_else(|error| panic!("{error}"))
      }
      #[cfg(not(feature = "async-runtime"))]
      {
        runtime()
      }
    };
    let retirement = runtime.retirement_signal();
    let generation = runtime.generation();
    let workers = runtime.worker_tracker();
    runtime.spawn_blocking(move || {
      let _operation = RuntimeOperationGuard::enter();
      let _retirement = retirement;
      workers.register_current_thread();
      let _generation = TokioRuntimeGenerationGuard::enter(generation);
      func.take()()
    })
  }
}

#[cfg(all(not(feature = "noop"), feature = "async-runtime"))]
/// Run blocking work through the registered [`AsyncRuntime`] backend, returning a joinable
/// [`JoinHandle`].
///
/// The closure — wrapped so that its output, or on an unwind-enabled build a caught panic payload
/// as a [`JoinError`], is handed to the returned handle — is offered to the backend's
/// [`spawn_blocking`](AsyncRuntime::spawn_blocking) hook. If the backend declines, the returned
/// handle completes with a rejection error. With `panic = "abort"`, a panic cannot settle the
/// handle. napi never creates an unbounded fallback thread, which keeps this API valid on
/// threadless WebAssembly. This name and routing are unchanged when `tokio_rt` is also enabled;
/// the Tokio-backed compatibility helper remains `spawn_blocking`. Missing, stopped, or
/// transitioning runtime states are reported as runtime errors.
pub fn spawn_blocking_on_custom_runtime<F, R>(func: F) -> JoinHandle<R>
where
  F: FnOnce() -> R + Send + 'static,
  R: Send + 'static,
{
  let state = Arc::new(JoinState::new());
  let cancellation_state = state.clone();
  let submission = Arc::new(AsyncRuntimeSubmission::new_with_reason(Box::new(
    move |reason| {
      cancellation_state.complete(Err(JoinError::from_cancellation_reason(reason)));
    },
  )));
  let work = BlockingWorkState::new(func, state.clone(), Arc::clone(&submission));
  let work: Box<dyn FnOnce() + Send + 'static> = Box::new(move || work.run());
  let runtime = match custom_async_runtime_for_use() {
    Ok(runtime) => runtime,
    Err(error) => {
      submission.fail(error);
      drop(work);
      return JoinHandle { state };
    }
  };
  let _runtime_use = match acquire_runtime_use() {
    Ok(runtime_use) => runtime_use,
    Err(error) => {
      submission.fail(error);
      drop(work);
      return JoinHandle { state };
    }
  };
  match std::panic::catch_unwind(AssertUnwindSafe(|| runtime.spawn_blocking(work))) {
    Ok(Ok(())) => {
      let _ = submission.accept();
    }
    Ok(Err(rejection)) => {
      let (work, error) = rejection.into_parts();
      submission.reject(error);
      drop(work);
    }
    Err(reason) => {
      submission.fail(crate::bindgen_runtime::panic_to_error(reason));
    }
  }
  JoinHandle { state }
}

// This function's signature must be kept in sync with the one in lib.rs, otherwise napi
// will fail to compile with the `tokio_rt` feature.
#[cfg(not(feature = "noop"))]
/// Enter the async runtime context for the duration of the provided closure, then call it.
///
/// A pure `async-runtime` build enters the registered backend. If `tokio_rt` is enabled, including
/// through feature unification, this established public helper enters Tokio. Current derive v4
/// `#[napi(async_runtime)]` callbacks independently follow the selected generated-code backend:
/// custom when registered before selection, otherwise Tokio in a combined build. The legacy
/// napi-derive 3.5.9 synchronous guard calls this compatibility helper and therefore enters Tokio
/// in a combined build. With `async-runtime` enabled, both entry paths hold the lifecycle open
/// through guard destruction and reject calls before startup, during lifecycle transitions, and
/// after shutdown.
pub fn within_runtime_if_available<F: FnOnce() -> T, T>(f: F) -> T {
  try_within_runtime_if_available(f).unwrap_or_else(|error| panic!("{error}"))
}

#[cfg(not(feature = "noop"))]
/// Fallible form of [`within_runtime_if_available`].
///
/// In a pure `async-runtime` build, this preserves an error returned by
/// [`AsyncRuntime::enter`]. Combined and Tokio-only builds use Tokio's infallible context guard.
pub fn try_within_runtime_if_available<F: FnOnce() -> T, T>(f: F) -> Result<T> {
  let mut f = SafeDrop::new(f);
  #[cfg(feature = "tokio_rt")]
  {
    let (_runtime_use, runtime) = try_runtime()?;
    let runtime_guard = runtime.enter();
    let _generation = TokioRuntimeGenerationGuard::enter(runtime.generation());
    call_with_runtime_guard(runtime_guard, f.take())
  }
  #[cfg(all(feature = "async-runtime", not(feature = "tokio_rt")))]
  {
    let runtime = custom_async_runtime_for_use()?;
    let _runtime_use = acquire_synchronous_runtime_use()?;
    let runtime_guard = std::panic::catch_unwind(AssertUnwindSafe(|| runtime.enter()))
      .map_err(crate::bindgen_runtime::panic_to_error)??;
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
    Err(reason) => {
      let error = crate::bindgen_runtime::panic_to_error(reason);
      Err(match drop_result {
        Ok(()) => error,
        Err(cleanup) => runtime_guard_cleanup_error(error, cleanup),
      })
    }
  }
}

#[cfg(not(feature = "noop"))]
fn runtime_guard_cleanup_error(mut error: Error, cleanup: Error) -> Error {
  error.reason = format!(
    "{}; additionally, async runtime guard cleanup failed: {}",
    error.reason, cleanup.reason
  );
  error
}

#[cfg(not(feature = "noop"))]
fn call_fallible_with_runtime_guard<G, F: FnOnce() -> Result<T>, T>(guard: G, f: F) -> Result<T> {
  let call_result = std::panic::catch_unwind(AssertUnwindSafe(f));
  let drop_result = std::panic::catch_unwind(AssertUnwindSafe(|| drop(guard)))
    .map_err(crate::bindgen_runtime::panic_to_error);
  match call_result {
    Ok(result) => match (result, drop_result) {
      (Ok(value), Ok(())) => Ok(value),
      (Ok(value), Err(error)) => {
        crate::bindgen_runtime::catch_unwind_safely(|| drop(value));
        Err(error)
      }
      (Err(error), Ok(())) => Err(error),
      (Err(error), Err(cleanup)) => Err(runtime_guard_cleanup_error(error, cleanup)),
    },
    Err(reason) => {
      let error = crate::bindgen_runtime::panic_to_error(reason);
      Err(match drop_result {
        Ok(()) => error,
        Err(cleanup) => runtime_guard_cleanup_error(error, cleanup),
      })
    }
  }
}

#[cfg(all(not(feature = "noop"), feature = "async-runtime"))]
/// Enter the runtime selected for generated `#[napi(async_runtime)]` callbacks.
///
/// A registered custom backend delegates to [`AsyncRuntime::enter`]. In a combined build with no
/// registration, this enters the selected built-in Tokio runtime instead. The runtime remains live
/// through closure execution and guard destruction; backend, closure, and guard failures are
/// returned as [`Error`]. Panic failures are converted only on unwind-enabled builds; with
/// `panic = "abort"`, they trap or abort instead.
#[doc(hidden)]
pub fn within_selected_async_runtime<F: FnOnce() -> Result<T>, T>(f: F) -> Result<T> {
  let mut f = SafeDrop::new(f);
  match selected_runtime_for_use()? {
    AsyncRuntimeSelection::Custom => {
      let runtime = custom_async_runtime()?;
      let _runtime_use = acquire_synchronous_runtime_use()?;
      let runtime_guard = std::panic::catch_unwind(AssertUnwindSafe(|| runtime.enter()))
        .map_err(crate::bindgen_runtime::panic_to_error)??;
      call_fallible_with_runtime_guard(runtime_guard, f.take())
    }
    #[cfg(feature = "tokio_rt")]
    AsyncRuntimeSelection::Tokio => {
      let (_runtime_use, runtime) = try_runtime()?;
      let runtime_guard = runtime.enter();
      let _generation = TokioRuntimeGenerationGuard::enter(runtime.generation());
      call_fallible_with_runtime_guard(runtime_guard, f.take())
    }
    AsyncRuntimeSelection::Undecided => unreachable!("runtime use requires a selected backend"),
  }
}

#[cfg(all(not(feature = "noop"), not(feature = "async-runtime")))]
#[doc(hidden)]
pub fn within_selected_async_runtime<F: FnOnce() -> Result<T>, T>(f: F) -> Result<T> {
  let mut f = SafeDrop::new(f);
  #[cfg(feature = "tokio_rt")]
  {
    let (_runtime_use, runtime) = try_runtime()?;
    let runtime_guard = runtime.enter();
    let _generation = TokioRuntimeGenerationGuard::enter(runtime.generation());
    call_fallible_with_runtime_guard(runtime_guard, f.take())
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
pub fn within_selected_async_runtime<F: FnOnce() -> Result<T>, T>(f: F) -> Result<T> {
  f()
}

/// Compatibility entry point used by previously released `napi-derive` code.
#[allow(dead_code)]
#[doc(hidden)]
pub fn within_custom_runtime_if_available<F: FnOnce() -> Result<T>, T>(f: F) -> Result<T> {
  within_selected_async_runtime(f)
}

#[cfg(all(feature = "noop", feature = "tokio_rt"))]
#[allow(unused)]
/// Tokio compatibility API unavailable in `noop` builds; returns a null placeholder.
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

#[cfg(all(not(feature = "noop"), feature = "tokio_rt"))]
#[allow(clippy::not_unsafe_ptr_arg_deref)]
/// Spawn a future on napi's built-in Tokio runtime and return its JavaScript promise.
///
/// This function remains Tokio-backed when `async-runtime` is also enabled. Generated async
/// exports and [`Env::spawn_future`](crate::Env::spawn_future) independently follow the selected
/// async backend.
pub fn execute_tokio_future<
  Data: 'static + Send,
  Fut: 'static + Send + Future<Output = std::result::Result<Data, impl Into<Error>>>,
  Resolver: 'static + FnOnce(sys::napi_env, Data) -> Result<sys::napi_value>,
>(
  env: sys::napi_env,
  fut: Fut,
  resolver: Resolver,
) -> Result<sys::napi_value> {
  execute_builtin_tokio_future(env, fut, resolver, None, false)
}

#[cfg(not(feature = "noop"))]
#[allow(clippy::not_unsafe_ptr_arg_deref)]
pub(crate) fn execute_selected_async_future<
  Data: 'static + Send,
  Fut: 'static + Send + Future<Output = std::result::Result<Data, impl Into<Error>>>,
  Resolver: 'static + FnOnce(sys::napi_env, Data) -> Result<sys::napi_value>,
>(
  env: sys::napi_env,
  fut: Fut,
  resolver: Resolver,
) -> Result<sys::napi_value> {
  execute_selected_async_future_with_terminal_finalizer(env, fut, resolver, None)
}

#[cfg(not(feature = "noop"))]
#[allow(clippy::not_unsafe_ptr_arg_deref)]
fn execute_selected_async_future_with_terminal_finalizer<
  Data: 'static + Send,
  Fut: 'static + Send + Future<Output = std::result::Result<Data, impl Into<Error>>>,
  Resolver: 'static + FnOnce(sys::napi_env, Data) -> Result<sys::napi_value>,
>(
  env: sys::napi_env,
  fut: Fut,
  resolver: Resolver,
  terminal_finalizer: Option<AsyncBlockTerminalFinalizer>,
) -> Result<sys::napi_value> {
  #[cfg(feature = "async-runtime")]
  {
    match generated_futures_use_custom_runtime() {
      Ok(true) => {
        return execute_custom_runtime_future(env, fut, resolver, terminal_finalizer);
      }
      Ok(false) => {}
      Err(error) => {
        return reject_async_future_setup(env, fut, resolver, None, terminal_finalizer, error);
      }
    }
  }
  #[cfg(feature = "tokio_rt")]
  {
    execute_builtin_tokio_future(env, fut, resolver, terminal_finalizer, true)
  }
  #[cfg(all(feature = "async-runtime", not(feature = "tokio_rt")))]
  {
    unreachable!("a pure async-runtime build can only select a custom backend")
  }
}

#[cfg(feature = "noop")]
pub(crate) fn execute_selected_async_future<
  Data: 'static + Send,
  Fut: 'static + Send + Future<Output = std::result::Result<Data, impl Into<Error>>>,
  Resolver: 'static + FnOnce(sys::napi_env, Data) -> Result<sys::napi_value>,
>(
  env: sys::napi_env,
  fut: Fut,
  resolver: Resolver,
) -> Result<sys::napi_value> {
  execute_selected_async_future_with_terminal_finalizer(env, fut, resolver, None)
}

#[cfg(feature = "noop")]
fn execute_selected_async_future_with_terminal_finalizer<
  Data: 'static + Send,
  Fut: 'static + Send + Future<Output = std::result::Result<Data, impl Into<Error>>>,
  Resolver: 'static + FnOnce(sys::napi_env, Data) -> Result<sys::napi_value>,
>(
  _env: sys::napi_env,
  fut: Fut,
  resolver: Resolver,
  terminal_finalizer: Option<AsyncBlockTerminalFinalizer>,
) -> Result<sys::napi_value> {
  crate::bindgen_runtime::catch_unwind_safely(|| drop(fut));
  crate::bindgen_runtime::catch_unwind_safely(|| drop(resolver));
  if let Some(terminal_finalizer) = terminal_finalizer {
    terminal_finalizer.run();
  }
  Ok(std::ptr::null_mut())
}

#[cfg(all(
  not(feature = "noop"),
  any(feature = "async-runtime", feature = "tokio_rt")
))]
struct OwnerThreadAsyncSetupCleanup<Fut, Resolver> {
  env: sys::napi_env,
  fut: Option<Fut>,
  resolver: Option<Resolver>,
  finalize_callback: Option<Box<dyn FnOnce(sys::napi_env)>>,
  terminal_finalizer: Option<AsyncBlockTerminalFinalizer>,
}

#[cfg(all(
  not(feature = "noop"),
  any(feature = "async-runtime", feature = "tokio_rt")
))]
impl<Fut, Resolver> OwnerThreadAsyncSetupCleanup<Fut, Resolver> {
  fn new(
    env: sys::napi_env,
    fut: Fut,
    resolver: Resolver,
    finalize_callback: Option<Box<dyn FnOnce(sys::napi_env)>>,
    terminal_finalizer: Option<AsyncBlockTerminalFinalizer>,
  ) -> Self {
    Self {
      env,
      fut: Some(fut),
      resolver: Some(resolver),
      finalize_callback,
      terminal_finalizer,
    }
  }

  fn take_fut(&mut self) -> Fut {
    self
      .fut
      .take()
      .expect("async setup future is transferred exactly once")
  }

  fn take_resolver(&mut self) -> Resolver {
    self
      .resolver
      .take()
      .expect("async setup resolver is transferred exactly once")
  }

  fn take_finalize_callback(&mut self) -> Option<Box<dyn FnOnce(sys::napi_env)>> {
    self.finalize_callback.take()
  }

  fn take_terminal_finalizer(&mut self) -> Option<AsyncBlockTerminalFinalizer> {
    self.terminal_finalizer.take()
  }
}

#[cfg(all(
  not(feature = "noop"),
  any(feature = "async-runtime", feature = "tokio_rt")
))]
impl<Fut, Resolver> Drop for OwnerThreadAsyncSetupCleanup<Fut, Resolver> {
  fn drop(&mut self) {
    if let Some(fut) = self.fut.take() {
      drop_safely(fut);
    }
    if let Some(resolver) = self.resolver.take() {
      drop_safely(resolver);
    }
    if let Some(finalize_callback) = self.finalize_callback.take() {
      let env = self.env;
      crate::bindgen_runtime::catch_unwind_safely(|| finalize_callback(env));
    }
    run_async_block_terminal_finalizer(&self.terminal_finalizer);
  }
}

#[cfg(all(
  not(feature = "noop"),
  any(
    feature = "async-runtime",
    all(feature = "tokio_rt", target_family = "wasm", not(tokio_unstable))
  )
))]
fn reject_async_future_setup<
  Data: 'static + Send,
  Fut: 'static + Send,
  Resolver: 'static + FnOnce(sys::napi_env, Data) -> Result<sys::napi_value>,
>(
  env: sys::napi_env,
  fut: Fut,
  resolver: Resolver,
  finalize_callback: Option<Box<dyn FnOnce(sys::napi_env)>>,
  terminal_finalizer: Option<AsyncBlockTerminalFinalizer>,
  error: Error,
) -> Result<sys::napi_value> {
  // This helper is called synchronously from the JavaScript owner thread before any scheduler
  // takes ownership. Reject directly so failed module-registration rollback does not depend on
  // environment task, resolver, or TSFN registries that have already been removed.
  let _cleanup =
    OwnerThreadAsyncSetupCleanup::new(env, fut, resolver, finalize_callback, terminal_finalizer);
  let mut deferred = std::ptr::null_mut();
  let mut promise = std::ptr::null_mut();
  check_status!(
    unsafe { sys::napi_create_promise(env, &mut deferred, &mut promise) },
    "Create rejected async setup promise failed"
  )?;
  let error = unsafe { crate::JsError::from(error).into_value(env) };
  check_status!(
    unsafe { sys::napi_reject_deferred(env, deferred, error) },
    "Reject async setup promise failed"
  )?;
  Ok(promise)
}

#[cfg(all(not(feature = "noop"), feature = "async-runtime"))]
fn execute_custom_runtime_future<
  Data: 'static + Send,
  Fut: 'static + Send + Future<Output = std::result::Result<Data, impl Into<Error>>>,
  Resolver: 'static + FnOnce(sys::napi_env, Data) -> Result<sys::napi_value>,
>(
  env: sys::napi_env,
  fut: Fut,
  resolver: Resolver,
  terminal_finalizer: Option<AsyncBlockTerminalFinalizer>,
) -> Result<sys::napi_value> {
  let raw_env = env;
  if !runtime_env_is_open(&runtime_env_tasks(raw_env)) {
    return reject_async_future_setup(
      raw_env,
      fut,
      resolver,
      None,
      terminal_finalizer,
      async_runtime_env_unavailable_error(),
    );
  }
  let mut setup_cleanup =
    OwnerThreadAsyncSetupCleanup::new(raw_env, fut, resolver, None, terminal_finalizer);
  let env = Env::from_raw(env);
  let (deferred, promise) = JsDeferred::new(&env)?;
  let sendable_resolver = SendableResolver::new_for_env(raw_env, setup_cleanup.take_resolver());
  let fut = setup_cleanup.take_fut();
  let terminal_finalizer = setup_cleanup.take_terminal_finalizer();
  let cancellation_deferred = deferred.clone();
  let cancellation_resolver = sendable_resolver.clone_handle();
  let cancellation_terminal_finalizer = terminal_finalizer.clone();
  let task = env_async_task(
    raw_env,
    async move {
      let completion: AsyncRuntimeCompletion = match AssertUnwindSafe(fut).catch_unwind().await {
        Ok(Ok(v)) => Box::new(move || {
          deferred.resolve_for_runtime(move |env| {
            let _terminal_finalizer = terminal_finalizer.map(AsyncBlockTerminalFinalizerGuard);
            sendable_resolver
              .resolve(env.raw(), v)
              .map(|v| unsafe { Unknown::from_raw_unchecked(env.raw(), v) })
          });
        }),
        Ok(Err(e)) => {
          let error = e.into();
          Box::new(move || {
            run_async_block_terminal_finalizer(&terminal_finalizer);
            deferred.reject_with_cleanup(error, move || {
              let _ = sendable_resolver.discard();
            });
          })
        }
        Err(reason) => {
          let error = crate::bindgen_runtime::panic_to_error(reason);
          Box::new(move || {
            run_async_block_terminal_finalizer(&terminal_finalizer);
            deferred.reject_with_cleanup(error, move || {
              let _ = sendable_resolver.discard();
            });
          })
        }
      };
      completion
    },
    move |env_open, cancellation_error| {
      run_async_block_terminal_finalizer(&cancellation_terminal_finalizer);
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
  Ok(promise.0.value)
}

#[cfg(all(
  not(feature = "noop"),
  feature = "tokio_rt",
  any(
    all(target_family = "wasm", tokio_unstable),
    not(target_family = "wasm")
  )
))]
fn spawn_generated_tokio_task(
  runtime: TokioRuntimeLease,
  future: impl Future<Output = ()> + Send + 'static,
) {
  let retirement = runtime.retirement_signal();
  let generation = runtime.generation();
  let workers = runtime.worker_tracker();
  let register_worker = matches!(
    runtime.handle().runtime_flavor(),
    tokio::runtime::RuntimeFlavor::MultiThread
  );
  runtime.spawn(TokioRuntimeGenerationFuture::new(
    async move {
      let _retirement = retirement;
      future.await;
    },
    generation,
    workers,
    register_worker,
  ));
}

#[cfg(all(
  not(feature = "noop"),
  feature = "tokio_rt",
  target_family = "wasm",
  not(tokio_unstable)
))]
fn threadless_wasi_builtin_tokio_error() -> Error {
  Error::new(
    crate::Status::GenericFailure,
    "Built-in Tokio async tasks require a threaded WASI target. Use wasm32-wasip1-threads, or \
     enable async-runtime and register a custom AsyncRuntime backend for wasm32-wasip1.",
  )
}

#[cfg(all(
  not(feature = "noop"),
  feature = "tokio_rt",
  target_family = "wasm",
  not(tokio_unstable)
))]
fn execute_builtin_tokio_future<
  Data: 'static + Send,
  Fut: 'static + Send + Future<Output = std::result::Result<Data, impl Into<Error>>>,
  Resolver: 'static + FnOnce(sys::napi_env, Data) -> Result<sys::napi_value>,
>(
  env: sys::napi_env,
  fut: Fut,
  resolver: Resolver,
  terminal_finalizer: Option<AsyncBlockTerminalFinalizer>,
  _require_selected_tokio: bool,
) -> Result<sys::napi_value> {
  reject_async_future_setup(
    env,
    fut,
    resolver,
    None,
    terminal_finalizer,
    threadless_wasi_builtin_tokio_error(),
  )
}

#[cfg(all(
  not(feature = "noop"),
  feature = "tokio_rt",
  any(
    all(target_family = "wasm", tokio_unstable),
    not(target_family = "wasm")
  )
))]
fn execute_builtin_tokio_future<
  Data: 'static + Send,
  Fut: 'static + Send + Future<Output = std::result::Result<Data, impl Into<Error>>>,
  Resolver: 'static + FnOnce(sys::napi_env, Data) -> Result<sys::napi_value>,
>(
  env: sys::napi_env,
  fut: Fut,
  resolver: Resolver,
  terminal_finalizer: Option<AsyncBlockTerminalFinalizer>,
  require_selected_tokio: bool,
) -> Result<sys::napi_value> {
  let raw_env = env;
  let mut setup_cleanup =
    OwnerThreadAsyncSetupCleanup::new(raw_env, fut, resolver, None, terminal_finalizer);
  let env = Env::from_raw(env);
  let (deferred, promise) = JsDeferred::new(&env)?;
  let sendable_resolver = SendableResolver::new_for_env(raw_env, setup_cleanup.take_resolver());
  let (_runtime_use, runtime) = match try_runtime() {
    Ok(runtime) => runtime,
    Err(error) => {
      let fut = setup_cleanup.take_fut();
      let cleanup_terminal_finalizer = setup_cleanup.take_terminal_finalizer();
      deferred.reject_with_cleanup(error, move || {
        {
          let _operation = RuntimeOperationGuard::enter();
          drop_safely(fut);
          crate::bindgen_runtime::catch_unwind_safely(|| {
            let _ = sendable_resolver.discard();
          });
        }
        run_async_block_terminal_finalizer(&cleanup_terminal_finalizer);
      });
      return Ok(promise.0.value);
    }
  };
  let fut = setup_cleanup.take_fut();
  let terminal_finalizer = setup_cleanup.take_terminal_finalizer();
  let _ = require_selected_tokio;
  let inner = {
    let cancellation_env_tasks = runtime_env_tasks(raw_env);
    let cancellation_deferred = deferred.clone();
    let cancellation_resolver = sendable_resolver.clone_handle();
    let cancellation_terminal_finalizer = terminal_finalizer.clone();
    let cancellation = TokioFutureCancellation::new(move || {
      run_async_block_terminal_finalizer(&cancellation_terminal_finalizer);
      if runtime_env_is_open(&cancellation_env_tasks) {
        cancellation_deferred.reject_with_cleanup(
          Error::new(
            crate::Status::Cancelled,
            "Async task was cancelled because its runtime stopped",
          ),
          move || {
            let _ = cancellation_resolver.discard();
          },
        );
      }
    });
    async move {
      let result = AssertUnwindSafe(fut).catch_unwind().await;
      settle_tokio_future(cancellation, move || match result {
        Ok(Ok(v)) => {
          deferred.resolve_for_runtime(move |env| {
            let _terminal_finalizer = terminal_finalizer.map(AsyncBlockTerminalFinalizerGuard);
            sendable_resolver
              .resolve(env.raw(), v)
              .map(|v| unsafe { Unknown::from_raw_unchecked(env.raw(), v) })
          });
        }
        Ok(Err(e)) => {
          run_async_block_terminal_finalizer(&terminal_finalizer);
          deferred.reject_with_cleanup(e.into(), move || {
            let _ = sendable_resolver.discard();
          });
        }
        Err(reason) => {
          run_async_block_terminal_finalizer(&terminal_finalizer);
          deferred.reject_with_cleanup(crate::bindgen_runtime::panic_to_error(reason), move || {
            let _ = sendable_resolver.discard();
          })
        }
      });
    }
  };

  let inner = tokio_generated_task(raw_env, inner);

  spawn_generated_tokio_task(runtime, inner);

  Ok(promise.0.value)
}

fn execute_async_block_future<
  Data: 'static + Send,
  Fut: 'static + Send + Future<Output = std::result::Result<Data, impl Into<Error>>>,
  Resolver: 'static + FnOnce(sys::napi_env, Data) -> Result<sys::napi_value>,
>(
  env: sys::napi_env,
  fut: Fut,
  resolver: Resolver,
  terminal_finalizer: Option<AsyncBlockTerminalFinalizer>,
) -> Result<sys::napi_value> {
  execute_selected_async_future_with_terminal_finalizer(env, fut, resolver, terminal_finalizer)
}

#[doc(hidden)]
#[cfg(not(feature = "noop"))]
#[allow(clippy::not_unsafe_ptr_arg_deref)]
fn execute_selected_async_future_with_finalize_callback<
  Data: 'static + Send,
  Fut: 'static + Send + Future<Output = std::result::Result<Data, impl Into<Error>>>,
  Resolver: 'static + FnOnce(sys::napi_env, Data) -> Result<sys::napi_value>,
>(
  env: sys::napi_env,
  fut: Fut,
  resolver: Resolver,
  finalize_callback: Option<Box<dyn FnOnce(sys::napi_env)>>,
) -> Result<sys::napi_value> {
  #[cfg(feature = "async-runtime")]
  {
    match generated_futures_use_custom_runtime() {
      Ok(true) => {
        return execute_custom_runtime_future_with_finalize_callback(
          env,
          fut,
          resolver,
          finalize_callback,
        );
      }
      Ok(false) => {}
      Err(error) => {
        return reject_async_future_setup(env, fut, resolver, finalize_callback, None, error);
      }
    }
  }
  #[cfg(feature = "tokio_rt")]
  {
    execute_builtin_tokio_future_with_finalize_callback(env, fut, resolver, finalize_callback)
  }
  #[cfg(all(feature = "async-runtime", not(feature = "tokio_rt")))]
  {
    unreachable!("a pure async-runtime build can only select a custom backend")
  }
}

/// Versioned selected-runtime entry point for current `napi-derive` output.
#[doc(hidden)]
#[cfg(not(feature = "noop"))]
#[allow(clippy::not_unsafe_ptr_arg_deref)]
pub fn execute_async_future_with_finalize_callback<
  Data: 'static + Send,
  Fut: 'static + Send + Future<Output = std::result::Result<Data, impl Into<Error>>>,
  Resolver: 'static + FnOnce(sys::napi_env, Data) -> Result<sys::napi_value>,
>(
  env: sys::napi_env,
  fut: Fut,
  resolver: Resolver,
  finalize_callback: Option<Box<dyn FnOnce(sys::napi_env)>>,
) -> Result<sys::napi_value> {
  execute_selected_async_future_with_finalize_callback(env, fut, resolver, finalize_callback)
}

/// Compatibility entry point for `napi-derive` versions released before the versioned async-runtime
/// code-generation contract.
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
  execute_selected_async_future_with_finalize_callback(env, fut, resolver, finalize_callback)
}

#[cfg(all(not(feature = "noop"), feature = "async-runtime"))]
fn execute_custom_runtime_future_with_finalize_callback<
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
  if !runtime_env_is_open(&runtime_env_tasks(raw_env)) {
    return reject_async_future_setup(
      raw_env,
      fut,
      resolver,
      finalize_callback,
      None,
      async_runtime_env_unavailable_error(),
    );
  }
  let mut setup_cleanup =
    OwnerThreadAsyncSetupCleanup::new(raw_env, fut, resolver, finalize_callback, None);
  let env = Env::from_raw(env);
  let (mut deferred, promise) = JsDeferred::new(&env)?;
  let sendable_resolver = SendableResolver::new_for_env(raw_env, setup_cleanup.take_resolver());
  let fut = setup_cleanup.take_fut();
  deferred.set_finalize_callback(setup_cleanup.take_finalize_callback());
  let cancellation_deferred = deferred.clone();
  let cancellation_resolver = sendable_resolver.clone_handle();
  let task = env_async_task(
    raw_env,
    async move {
      let completion: AsyncRuntimeCompletion = match AssertUnwindSafe(fut).catch_unwind().await {
        Ok(Ok(v)) => Box::new(move || {
          deferred.resolve_for_runtime(move |env| {
            sendable_resolver
              .resolve(env.raw(), v)
              .map(|v| unsafe { Unknown::from_raw_unchecked(env.raw(), v) })
          })
        }),
        Ok(Err(e)) => {
          let error = e.into();
          Box::new(move || {
            deferred.reject_with_cleanup(error, move || {
              let _ = sendable_resolver.discard();
            })
          })
        }
        Err(reason) => {
          let error = crate::bindgen_runtime::panic_to_error(reason);
          Box::new(move || {
            deferred.reject_with_cleanup(error, move || {
              let _ = sendable_resolver.discard();
            });
          })
        }
      };
      completion
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
  Ok(promise.0.value)
}

#[cfg(all(
  not(feature = "noop"),
  feature = "tokio_rt",
  target_family = "wasm",
  not(tokio_unstable)
))]
fn execute_builtin_tokio_future_with_finalize_callback<
  Data: 'static + Send,
  Fut: 'static + Send + Future<Output = std::result::Result<Data, impl Into<Error>>>,
  Resolver: 'static + FnOnce(sys::napi_env, Data) -> Result<sys::napi_value>,
>(
  env: sys::napi_env,
  fut: Fut,
  resolver: Resolver,
  finalize_callback: Option<Box<dyn FnOnce(sys::napi_env)>>,
) -> Result<sys::napi_value> {
  reject_async_future_setup(
    env,
    fut,
    resolver,
    finalize_callback,
    None,
    threadless_wasi_builtin_tokio_error(),
  )
}

#[cfg(all(
  not(feature = "noop"),
  feature = "tokio_rt",
  any(
    all(target_family = "wasm", tokio_unstable),
    not(target_family = "wasm")
  )
))]
fn execute_builtin_tokio_future_with_finalize_callback<
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
  let mut setup_cleanup =
    OwnerThreadAsyncSetupCleanup::new(raw_env, fut, resolver, finalize_callback, None);
  let env = Env::from_raw(env);
  let (mut deferred, promise) = JsDeferred::new(&env)?;
  let sendable_resolver = SendableResolver::new_for_env(raw_env, setup_cleanup.take_resolver());
  let fut = setup_cleanup.take_fut();
  deferred.set_finalize_callback(setup_cleanup.take_finalize_callback());
  let (_runtime_use, runtime) = match try_runtime() {
    Ok(runtime) => runtime,
    Err(error) => {
      deferred.reject_with_cleanup(error, move || {
        let _operation = RuntimeOperationGuard::enter();
        drop_safely(fut);
        crate::bindgen_runtime::catch_unwind_safely(|| {
          let _ = sendable_resolver.discard();
        });
      });
      return Ok(promise.0.value);
    }
  };
  let inner = {
    let cancellation_env_tasks = runtime_env_tasks(raw_env);
    let cancellation_deferred = deferred.clone();
    let cancellation_resolver = sendable_resolver.clone_handle();
    let cancellation = TokioFutureCancellation::new(move || {
      if runtime_env_is_open(&cancellation_env_tasks) {
        cancellation_deferred.reject_with_cleanup(
          Error::new(
            crate::Status::Cancelled,
            "Async task was cancelled because its runtime stopped",
          ),
          move || {
            let _ = cancellation_resolver.discard();
          },
        );
      }
    });
    async move {
      let result = AssertUnwindSafe(fut).catch_unwind().await;
      settle_tokio_future(cancellation, move || match result {
        Ok(Ok(v)) => deferred.resolve_for_runtime(move |env| {
          sendable_resolver
            .resolve(env.raw(), v)
            .map(|v| unsafe { Unknown::from_raw_unchecked(env.raw(), v) })
        }),
        Ok(Err(e)) => deferred.reject_with_cleanup(e.into(), move || {
          let _ = sendable_resolver.discard();
        }),
        Err(reason) => {
          deferred.reject_with_cleanup(crate::bindgen_runtime::panic_to_error(reason), move || {
            let _ = sendable_resolver.discard();
          })
        }
      });
    }
  };

  let inner = tokio_generated_task(raw_env, inner);

  spawn_generated_tokio_task(runtime, inner);

  Ok(promise.0.value)
}

#[cfg(feature = "noop")]
#[doc(hidden)]
fn execute_selected_async_future_with_finalize_callback<
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

#[cfg(feature = "noop")]
#[doc(hidden)]
pub fn execute_async_future_with_finalize_callback<
  Data: 'static + Send,
  Fut: 'static + Send + Future<Output = std::result::Result<Data, impl Into<Error>>>,
  Resolver: 'static + FnOnce(sys::napi_env, Data) -> Result<sys::napi_value>,
>(
  env: sys::napi_env,
  fut: Fut,
  resolver: Resolver,
  finalize_callback: Option<Box<dyn FnOnce(sys::napi_env)>>,
) -> Result<sys::napi_value> {
  execute_selected_async_future_with_finalize_callback(env, fut, resolver, finalize_callback)
}

#[cfg(feature = "noop")]
#[doc(hidden)]
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
  execute_selected_async_future_with_finalize_callback(env, fut, resolver, finalize_callback)
}

pub struct AsyncBlockBuilder<
  V: Send + 'static,
  F: Future<Output = Result<V>> + Send + 'static,
  Dispose: FnOnce(Env) -> Result<()> + 'static = fn(Env) -> Result<()>,
  TerminalFinalizer: FnOnce() + Send + 'static = fn(),
> {
  inner: F,
  dispose: Option<Dispose>,
  terminal_finalizer: Option<TerminalFinalizer>,
}

impl<V: ToNapiValue + Send + 'static, F: Future<Output = Result<V>> + Send + 'static>
  AsyncBlockBuilder<V, F>
{
  /// Create an `AsyncBlockBuilder` without a success disposer or terminal finalizer.
  pub fn new(inner: F) -> Self {
    Self {
      inner,
      dispose: None,
      terminal_finalizer: None,
    }
  }

  /// Create an `AsyncBlockBuilder` without a success disposer or terminal finalizer.
  pub fn with(inner: F) -> Self {
    Self {
      inner,
      dispose: None,
      terminal_finalizer: None,
    }
  }
}

impl<
    V: ToNapiValue + Send + 'static,
    F: Future<Output = Result<V>> + Send + 'static,
    Dispose: FnOnce(Env) -> Result<()> + 'static,
    TerminalFinalizer: FnOnce() + Send + 'static,
  > AsyncBlockBuilder<V, F, Dispose, TerminalFinalizer>
{
  /// Run `dispose` on the JavaScript owner thread before converting a successful result.
  ///
  /// This is a success-only hook. It does not run when the future rejects, panics, is cancelled,
  /// or when [`build`](Self::build) fails before scheduling the future. Use
  /// [`with_terminal_finalizer`](Self::with_terminal_finalizer) for cleanup that must run on every
  /// terminal path.
  pub fn with_dispose<NewDispose>(
    self,
    dispose: NewDispose,
  ) -> AsyncBlockBuilder<V, F, NewDispose, TerminalFinalizer>
  where
    NewDispose: FnOnce(Env) -> Result<()> + 'static,
  {
    AsyncBlockBuilder {
      inner: self.inner,
      dispose: Some(dispose),
      terminal_finalizer: self.terminal_finalizer,
    }
  }

  /// Install an exactly-once finalizer for every terminal path.
  ///
  /// The finalizer runs after a successful result's resolver attempt, and also runs when the
  /// future rejects or panics, runtime cancellation drops the work, the Node environment closes,
  /// or [`build`](Self::build) rolls back before returning an async block. It may run on the
  /// calling thread, a runtime worker, or the JavaScript owner thread, so it cannot access an
  /// [`Env`] and must be `Send`. A panic from the finalizer is contained after the callback is
  /// claimed; it does not change the promise result or cause another invocation.
  pub fn with_terminal_finalizer<NewTerminalFinalizer>(
    self,
    terminal_finalizer: NewTerminalFinalizer,
  ) -> AsyncBlockBuilder<V, F, Dispose, NewTerminalFinalizer>
  where
    NewTerminalFinalizer: FnOnce() + Send + 'static,
  {
    AsyncBlockBuilder {
      inner: self.inner,
      dispose: self.dispose,
      terminal_finalizer: Some(terminal_finalizer),
    }
  }

  pub fn build(self, env: &Env) -> Result<AsyncBlock<V>> {
    let terminal_finalizer = self
      .terminal_finalizer
      .map(AsyncBlockTerminalFinalizer::new);
    Ok(AsyncBlock {
      inner: execute_async_block_future(
        env.0,
        self.inner,
        |env, v| unsafe {
          if let Some(dispose) = self.dispose {
            let env = Env::from_raw(env);
            dispose(env)?;
          }
          V::to_napi_value(env, v)
        },
        terminal_finalizer,
      )?,
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
      inner: execute_selected_async_future_with_terminal_finalizer(
        env.0,
        inner,
        |env, v| unsafe {
          let v = map(Env::from_raw(env), v)?;
          T::to_napi_value(env, v)
        },
        None,
      )?,
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

#[cfg(all(test, not(feature = "noop")))]
mod async_block_terminal_finalizer_tests {
  #[cfg(any(feature = "async-runtime", feature = "tokio_rt"))]
  use std::sync::atomic::AtomicBool;
  use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
  };

  use super::*;

  #[cfg(any(feature = "async-runtime", feature = "tokio_rt"))]
  struct DropFlag(Arc<AtomicBool>);

  #[cfg(any(feature = "async-runtime", feature = "tokio_rt"))]
  impl Drop for DropFlag {
    fn drop(&mut self) {
      self.0.store(true, Ordering::SeqCst);
    }
  }

  fn counted_finalizer() -> (AsyncBlockTerminalFinalizer, Arc<AtomicUsize>) {
    let calls = Arc::new(AtomicUsize::new(0));
    let finalizer_calls = Arc::clone(&calls);
    (
      AsyncBlockTerminalFinalizer::new(move || {
        finalizer_calls.fetch_add(1, Ordering::SeqCst);
      }),
      calls,
    )
  }

  #[test]
  fn async_block_success_runs_terminal_finalizer_once_after_resolver() {
    let (finalizer, calls) = counted_finalizer();
    let cancellation_finalizer = finalizer.clone();
    let resolver_finalizer = finalizer.clone();

    drop(cancellation_finalizer);
    {
      let _terminal_finalizer = AsyncBlockTerminalFinalizerGuard(resolver_finalizer);
      assert_eq!(calls.load(Ordering::SeqCst), 0);
    }
    finalizer.run();
    drop(finalizer);

    assert_eq!(calls.load(Ordering::SeqCst), 1);
  }

  #[test]
  fn async_block_rejection_runs_terminal_finalizer_once() {
    let (finalizer, calls) = counted_finalizer();
    let resolver_finalizer = finalizer.clone();
    let terminal_finalizer = Some(finalizer.clone());

    run_async_block_terminal_finalizer(&terminal_finalizer);
    run_async_block_terminal_finalizer(&terminal_finalizer);
    drop(resolver_finalizer);
    drop(terminal_finalizer);
    drop(finalizer);

    assert_eq!(calls.load(Ordering::SeqCst), 1);
  }

  #[test]
  fn async_block_cancellation_runs_terminal_finalizer_once_across_threads() {
    let (finalizer, calls) = counted_finalizer();
    let cancellation_finalizer = Some(finalizer.clone());
    let cancellation = std::thread::spawn(move || {
      run_async_block_terminal_finalizer(&cancellation_finalizer);
      run_async_block_terminal_finalizer(&cancellation_finalizer);
    });

    cancellation.join().unwrap();
    finalizer.run();
    drop(finalizer);

    assert_eq!(calls.load(Ordering::SeqCst), 1);
  }

  #[test]
  fn async_block_build_rollback_runs_terminal_finalizer_once_on_last_drop() {
    let (finalizer, calls) = counted_finalizer();
    let future_finalizer = finalizer.clone();
    let resolver_finalizer = finalizer.clone();

    drop(future_finalizer);
    drop(resolver_finalizer);
    assert_eq!(calls.load(Ordering::SeqCst), 0);
    drop(finalizer);

    assert_eq!(calls.load(Ordering::SeqCst), 1);
  }

  #[cfg(any(feature = "async-runtime", feature = "tokio_rt"))]
  #[test]
  fn async_setup_cleanup_drops_inputs_before_terminal_finalizer() {
    let future_dropped = Arc::new(AtomicBool::new(false));
    let resolver_dropped = Arc::new(AtomicBool::new(false));
    let finalizer_observed_order = Arc::new(AtomicBool::new(false));
    let finalizer_future_dropped = Arc::clone(&future_dropped);
    let finalizer_resolver_dropped = Arc::clone(&resolver_dropped);
    let finalizer_observed_order_result = Arc::clone(&finalizer_observed_order);
    let cleanup = OwnerThreadAsyncSetupCleanup::new(
      std::ptr::null_mut(),
      DropFlag(future_dropped),
      DropFlag(resolver_dropped),
      None,
      Some(AsyncBlockTerminalFinalizer::new(move || {
        finalizer_observed_order_result.store(
          finalizer_future_dropped.load(Ordering::SeqCst)
            && finalizer_resolver_dropped.load(Ordering::SeqCst),
          Ordering::SeqCst,
        );
      })),
    );

    drop(cleanup);

    assert!(finalizer_observed_order.load(Ordering::SeqCst));
  }

  #[test]
  fn async_block_terminal_finalizer_contains_panics_after_claiming_callback() {
    let finalizer = AsyncBlockTerminalFinalizer::new(|| panic!("terminal finalizer panic"));

    finalizer.run();
    finalizer.run();
  }
}

#[cfg(all(test, feature = "noop"))]
mod noop_async_block_terminal_finalizer_tests {
  use std::{
    pin::Pin,
    sync::{
      atomic::{AtomicBool, Ordering},
      Arc,
    },
    task::{Context, Poll},
  };

  use super::*;

  struct DropFlag(Arc<AtomicBool>);

  impl Future for DropFlag {
    type Output = Result<()>;

    fn poll(self: Pin<&mut Self>, _cx: &mut Context<'_>) -> Poll<Self::Output> {
      Poll::Pending
    }
  }

  impl Drop for DropFlag {
    fn drop(&mut self) {
      self.0.store(true, Ordering::SeqCst);
    }
  }

  #[test]
  fn noop_async_block_finalizes_after_future_and_resolver_destruction() {
    let future_dropped = Arc::new(AtomicBool::new(false));
    let resolver_dropped = Arc::new(AtomicBool::new(false));
    let finalizer_observed_order = Arc::new(AtomicBool::new(false));
    let resolver_probe = DropFlag(Arc::clone(&resolver_dropped));
    let finalizer_future_dropped = Arc::clone(&future_dropped);
    let finalizer_resolver_dropped = Arc::clone(&resolver_dropped);
    let finalizer_observed_order_result = Arc::clone(&finalizer_observed_order);

    execute_selected_async_future_with_terminal_finalizer(
      std::ptr::null_mut(),
      DropFlag(Arc::clone(&future_dropped)),
      move |_, ()| {
        let _ = &resolver_probe;
        Ok(std::ptr::null_mut())
      },
      Some(AsyncBlockTerminalFinalizer::new(move || {
        finalizer_observed_order_result.store(
          finalizer_future_dropped.load(Ordering::SeqCst)
            && finalizer_resolver_dropped.load(Ordering::SeqCst),
          Ordering::SeqCst,
        );
      })),
    )
    .unwrap();

    assert!(future_dropped.load(Ordering::SeqCst));
    assert!(resolver_dropped.load(Ordering::SeqCst));
    assert!(finalizer_observed_order.load(Ordering::SeqCst));
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
    mpsc, Arc, Condvar, Mutex, MutexGuard,
  };
  use std::task::{RawWaker, RawWakerVTable};
  use std::time::Duration;

  use futures::{task::ArcWake, FutureExt};

  use super::{
    spawn_blocking_on_custom_runtime as spawn_blocking, spawn_on_custom_runtime as spawn, *,
  };

  const BACKEND_WORKER_THREAD: &str = "inline-runtime-worker";
  const BACKEND_BLOCKING_THREAD: &str = "inline-runtime-blocking";
  const BACKEND_CANCELLATION_THREAD: &str = "inline-runtime-cancellation";

  static BACKEND_SPAWN_CALLS: AtomicUsize = AtomicUsize::new(0);
  static BACKEND_BLOCKING_CALLS: AtomicUsize = AtomicUsize::new(0);
  static BACKEND_BLOCK_ON_CALLS: AtomicUsize = AtomicUsize::new(0);
  static BACKEND_ENTER_CALLS: AtomicUsize = AtomicUsize::new(0);
  static BACKEND_START_CALLS: AtomicUsize = AtomicUsize::new(0);
  static BACKEND_SHUTDOWN_CALLS: AtomicUsize = AtomicUsize::new(0);
  static DECLINE_SPAWN: AtomicBool = AtomicBool::new(false);
  static DROP_SPAWN_TASK: AtomicBool = AtomicBool::new(false);
  static QUEUE_SPAWN_TASK: AtomicBool = AtomicBool::new(false);
  static DECLINE_SPAWN_BLOCKING: AtomicBool = AtomicBool::new(false);
  static PANIC_SPAWN: AtomicBool = AtomicBool::new(false);
  static PANIC_AFTER_RETAINING_SPAWN: AtomicBool = AtomicBool::new(false);
  static PANIC_AFTER_POLLING_AND_RETAINING_SPAWN: AtomicBool = AtomicBool::new(false);
  static DRIVE_SPAWN_INLINE: AtomicBool = AtomicBool::new(false);
  static PANIC_AFTER_DRIVING_SPAWN: AtomicBool = AtomicBool::new(false);
  static PANIC_SPAWN_BLOCKING: AtomicBool = AtomicBool::new(false);
  static PANIC_AFTER_RETAINING_SPAWN_BLOCKING: AtomicBool = AtomicBool::new(false);
  static DRIVE_SPAWN_BLOCKING_INLINE: AtomicBool = AtomicBool::new(false);
  static PANIC_AFTER_DRIVING_SPAWN_BLOCKING: AtomicBool = AtomicBool::new(false);
  static PANIC_ENTER: AtomicBool = AtomicBool::new(false);
  static FAIL_ENTER: AtomicBool = AtomicBool::new(false);
  static PANIC_GUARD_DROP: AtomicBool = AtomicBool::new(false);
  static PANIC_BLOCK_ON: AtomicBool = AtomicBool::new(false);
  static FAIL_BLOCK_ON: AtomicBool = AtomicBool::new(false);
  static PANIC_BLOCK_ON_AFTER_COMPLETION: AtomicBool = AtomicBool::new(false);
  static RETURN_BLOCK_ON_EARLY: AtomicBool = AtomicBool::new(false);
  static DROP_BLOCKING_WORK: AtomicBool = AtomicBool::new(false);
  static QUEUE_BLOCKING_WORK: AtomicBool = AtomicBool::new(false);
  static SHUTDOWN_DURING_SPAWN: AtomicBool = AtomicBool::new(false);
  static START_DURING_SHUTDOWN: AtomicBool = AtomicBool::new(false);
  static USE_SYNCHRONOUS_LIFECYCLE_HOOKS: AtomicBool = AtomicBool::new(false);
  static WAIT_FOR_ACTIVE_WORK_ON_SHUTDOWN: AtomicBool = AtomicBool::new(false);
  static PAUSE_BACKEND_WORKER_START: AtomicBool = AtomicBool::new(false);
  static ACTIVE_BACKEND_WORK: (Mutex<usize>, Condvar) = (Mutex::new(0), Condvar::new());
  static BACKEND_WORKER_START: (Mutex<(usize, bool)>, Condvar) =
    (Mutex::new((0, false)), Condvar::new());
  static QUEUED_TASK: Mutex<Option<AsyncRuntimeTask>> = Mutex::new(None);
  static QUEUED_BLOCKING: Mutex<Option<Box<dyn FnOnce() + Send + 'static>>> = Mutex::new(None);
  static LIFECYCLE_REENTRY_ERROR: Mutex<Option<String>> = Mutex::new(None);
  static RUNTIME_STATE_TEST_LOCK: Mutex<()> = Mutex::new(());
  struct RuntimeStateTestGuard {
    _guard: MutexGuard<'static, ()>,
    drained_active: Option<mpsc::Sender<usize>>,
  }

  impl RuntimeStateTestGuard {
    fn observe_drain(mut self, drained_active: mpsc::Sender<usize>) -> Self {
      self.drained_active = Some(drained_active);
      self
    }
  }

  impl Drop for RuntimeStateTestGuard {
    fn drop(&mut self) {
      let mut active = ACTIVE_BACKEND_WORK
        .0
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
      WAIT_FOR_ACTIVE_WORK_ON_SHUTDOWN.store(false, Ordering::SeqCst);
      ACTIVE_BACKEND_WORK.1.notify_all();
      while *active != 0 {
        active = ACTIVE_BACKEND_WORK
          .1
          .wait(active)
          .unwrap_or_else(std::sync::PoisonError::into_inner);
      }
      if let Some(drained_active) = self.drained_active.take() {
        let _ = drained_active.send(*active);
      }
    }
  }

  fn runtime_state_test_guard() -> RuntimeStateTestGuard {
    let guard = RUNTIME_STATE_TEST_LOCK
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner);
    DECLINE_SPAWN.store(false, Ordering::SeqCst);
    DROP_SPAWN_TASK.store(false, Ordering::SeqCst);
    QUEUE_SPAWN_TASK.store(false, Ordering::SeqCst);
    DECLINE_SPAWN_BLOCKING.store(false, Ordering::SeqCst);
    PANIC_SPAWN.store(false, Ordering::SeqCst);
    PANIC_AFTER_RETAINING_SPAWN.store(false, Ordering::SeqCst);
    PANIC_AFTER_POLLING_AND_RETAINING_SPAWN.store(false, Ordering::SeqCst);
    DRIVE_SPAWN_INLINE.store(false, Ordering::SeqCst);
    PANIC_AFTER_DRIVING_SPAWN.store(false, Ordering::SeqCst);
    PANIC_SPAWN_BLOCKING.store(false, Ordering::SeqCst);
    PANIC_AFTER_RETAINING_SPAWN_BLOCKING.store(false, Ordering::SeqCst);
    DRIVE_SPAWN_BLOCKING_INLINE.store(false, Ordering::SeqCst);
    PANIC_AFTER_DRIVING_SPAWN_BLOCKING.store(false, Ordering::SeqCst);
    PANIC_ENTER.store(false, Ordering::SeqCst);
    FAIL_ENTER.store(false, Ordering::SeqCst);
    PANIC_GUARD_DROP.store(false, Ordering::SeqCst);
    PANIC_BLOCK_ON.store(false, Ordering::SeqCst);
    FAIL_BLOCK_ON.store(false, Ordering::SeqCst);
    PANIC_BLOCK_ON_AFTER_COMPLETION.store(false, Ordering::SeqCst);
    RETURN_BLOCK_ON_EARLY.store(false, Ordering::SeqCst);
    DROP_BLOCKING_WORK.store(false, Ordering::SeqCst);
    QUEUE_BLOCKING_WORK.store(false, Ordering::SeqCst);
    SHUTDOWN_DURING_SPAWN.store(false, Ordering::SeqCst);
    START_DURING_SHUTDOWN.store(false, Ordering::SeqCst);
    USE_SYNCHRONOUS_LIFECYCLE_HOOKS.store(false, Ordering::SeqCst);
    WAIT_FOR_ACTIVE_WORK_ON_SHUTDOWN.store(false, Ordering::SeqCst);
    ACTIVE_BACKEND_WORK.1.notify_all();
    PAUSE_BACKEND_WORKER_START.store(false, Ordering::SeqCst);
    *BACKEND_WORKER_START
      .0
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner) = (0, false);
    assert!(
      QUEUED_TASK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .is_none(),
      "a previous test left queued async work behind"
    );
    assert!(
      QUEUED_BLOCKING
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .is_none(),
      "a previous test left queued blocking work behind"
    );
    *LIFECYCLE_REENTRY_ERROR
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner) = None;
    open_runtime_submissions();
    if CUSTOM_ASYNC_RUNTIME.get().is_some() {
      try_start_async_runtime().unwrap();
    }
    RuntimeStateTestGuard {
      _guard: guard,
      drained_active: None,
    }
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

  struct ActiveBackendWork;

  impl ActiveBackendWork {
    fn enter() -> Self {
      *ACTIVE_BACKEND_WORK
        .0
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner) += 1;
      Self
    }
  }

  impl Drop for ActiveBackendWork {
    fn drop(&mut self) {
      let mut active = ACTIVE_BACKEND_WORK
        .0
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
      *active -= 1;
      if *active == 0 {
        ACTIVE_BACKEND_WORK.1.notify_all();
      }
    }
  }

  fn wait_if_backend_worker_start_is_paused() {
    if !PAUSE_BACKEND_WORKER_START.load(Ordering::SeqCst) {
      return;
    }
    let mut state = BACKEND_WORKER_START
      .0
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner);
    state.0 += 1;
    BACKEND_WORKER_START.1.notify_all();
    while !state.1 {
      state = BACKEND_WORKER_START
        .1
        .wait(state)
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    }
  }

  fn wait_for_backend_workers_at_start(expected: usize) {
    let mut state = BACKEND_WORKER_START
      .0
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner);
    while state.0 != expected {
      state = BACKEND_WORKER_START
        .1
        .wait(state)
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    }
  }

  fn release_backend_worker_start() {
    PAUSE_BACKEND_WORKER_START.store(false, Ordering::SeqCst);
    let mut state = BACKEND_WORKER_START
      .0
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner);
    state.1 = true;
    BACKEND_WORKER_START.1.notify_all();
  }

  struct SelfWaitingShutdown;

  impl SelfWaitingShutdown {
    fn arm() -> Self {
      assert_eq!(
        *ACTIVE_BACKEND_WORK
          .0
          .lock()
          .unwrap_or_else(std::sync::PoisonError::into_inner),
        0,
        "the self-waiting backend test must start without active work"
      );
      WAIT_FOR_ACTIVE_WORK_ON_SHUTDOWN.store(true, Ordering::SeqCst);
      Self
    }
  }

  impl Drop for SelfWaitingShutdown {
    fn drop(&mut self) {
      WAIT_FOR_ACTIVE_WORK_ON_SHUTDOWN.store(false, Ordering::SeqCst);
      ACTIVE_BACKEND_WORK.1.notify_all();
    }
  }

  struct ShutdownOnDrop {
    result: Option<mpsc::Sender<Result<()>>>,
  }

  impl ShutdownOnDrop {
    fn new(result: mpsc::Sender<Result<()>>) -> Self {
      Self {
        result: Some(result),
      }
    }
  }

  impl Drop for ShutdownOnDrop {
    fn drop(&mut self) {
      if let Some(result) = self.result.take() {
        result.send(try_shutdown_async_runtime()).unwrap();
      }
    }
  }

  struct StartOnDrop {
    result: Option<mpsc::Sender<Result<()>>>,
  }

  impl StartOnDrop {
    fn new(result: mpsc::Sender<Result<()>>) -> Self {
      Self {
        result: Some(result),
      }
    }
  }

  impl Drop for StartOnDrop {
    fn drop(&mut self) {
      if let Some(result) = self.result.take() {
        result.send(try_start_async_runtime()).unwrap();
      }
    }
  }

  fn await_terminal_drop_and_shutdown(
    drop_result: mpsc::Receiver<Result<()>>,
    shutdown_result: mpsc::Receiver<Result<()>>,
    shutdown: std::thread::JoinHandle<()>,
  ) -> Error {
    let drop_result = match drop_result.recv_timeout(Duration::from_secs(5)) {
      Ok(result) => result,
      Err(error) => {
        {
          let mut lifecycle = runtime_lifecycle();
          if lifecycle.state == RuntimeLifecycleState::Stopping {
            lifecycle.state = RuntimeLifecycleState::Running;
            RUNTIME_LIFECYCLE.1.notify_all();
          }
        }
        let _ = shutdown_result.recv_timeout(Duration::from_secs(5));
        let _ = shutdown.join();
        let _ = try_start_async_runtime();
        panic!("terminal destructor deadlocked with shutdown joining its worker: {error}");
      }
    };
    shutdown_result
      .recv_timeout(Duration::from_secs(5))
      .expect("shutdown must finish after the terminal destructor returns")
      .expect("shutdown must succeed");
    shutdown.join().expect("shutdown thread must not panic");
    drop_result.expect_err("terminal lifecycle calls must be rejected")
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

  unsafe impl AsyncRuntime for InlineRuntime {
    fn spawn(
      &self,
      mut task: AsyncRuntimeTask,
    ) -> std::result::Result<(), AsyncRuntimeRejection<AsyncRuntimeTask>> {
      if SHUTDOWN_DURING_SPAWN.load(Ordering::SeqCst) {
        let error = try_shutdown_async_runtime()
          .expect_err("shutdown from a submission hook must fail instead of deadlocking");
        *LIFECYCLE_REENTRY_ERROR
          .lock()
          .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(error.reason);
      }
      if PANIC_AFTER_RETAINING_SPAWN.load(Ordering::SeqCst) {
        let previous = QUEUED_TASK
          .lock()
          .unwrap_or_else(std::sync::PoisonError::into_inner)
          .replace(task);
        assert!(previous.is_none(), "only one async task may be queued");
        panic!("backend spawn panic after retaining task");
      }
      if PANIC_AFTER_POLLING_AND_RETAINING_SPAWN.load(Ordering::SeqCst) {
        let waker = futures::task::noop_waker();
        let mut context = Context::from_waker(&waker);
        assert!(
          Pin::new(&mut task).poll(&mut context).is_pending(),
          "the committed task must remain pending for retained ownership coverage"
        );
        let previous = QUEUED_TASK
          .lock()
          .unwrap_or_else(std::sync::PoisonError::into_inner)
          .replace(task);
        assert!(previous.is_none(), "only one async task may be queued");
        panic!("backend spawn panic after polling and retaining task");
      }
      if PANIC_SPAWN.load(Ordering::SeqCst) {
        panic!("backend spawn panic");
      }
      if DECLINE_SPAWN.load(Ordering::SeqCst) {
        return Err(AsyncRuntimeRejection::new(
          task,
          Error::new(
            crate::Status::QueueFull,
            "InlineRuntime rejected the async task",
          ),
        ));
      }
      if DROP_SPAWN_TASK.load(Ordering::SeqCst) {
        drop(task);
        return Ok(());
      }
      if QUEUE_SPAWN_TASK.load(Ordering::SeqCst) {
        let previous = QUEUED_TASK
          .lock()
          .unwrap_or_else(std::sync::PoisonError::into_inner)
          .replace(task);
        assert!(previous.is_none(), "only one async task may be queued");
        return Ok(());
      }
      BACKEND_SPAWN_CALLS.fetch_add(1, Ordering::SeqCst);
      let drive_inline = DRIVE_SPAWN_INLINE.swap(false, Ordering::SeqCst);
      let panic_after_driving = PANIC_AFTER_DRIVING_SPAWN.swap(false, Ordering::SeqCst);
      if drive_inline || panic_after_driving {
        futures::executor::block_on(task);
        if panic_after_driving {
          panic!("backend spawn panic after driving task");
        }
        return Ok(());
      }
      let active = ActiveBackendWork::enter();
      std::thread::Builder::new()
        .name(BACKEND_WORKER_THREAD.to_owned())
        .spawn(move || {
          wait_if_backend_worker_start_is_paused();
          let _active = active;
          futures::executor::block_on(task);
        })
        .expect("failed to spawn the InlineRuntime worker thread");
      Ok(())
    }

    fn start(&self) -> Result<()> {
      BACKEND_START_CALLS.fetch_add(1, Ordering::SeqCst);
      if USE_SYNCHRONOUS_LIFECYCLE_HOOKS.load(Ordering::SeqCst) {
        try_block_on(async {})?;
        within_selected_async_runtime(|| Ok(()))?;
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
        within_selected_async_runtime(|| Ok(()))?;
      }
      let mut active = ACTIVE_BACKEND_WORK
        .0
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
      while WAIT_FOR_ACTIVE_WORK_ON_SHUTDOWN.load(Ordering::SeqCst) && *active != 0 {
        active = ACTIVE_BACKEND_WORK
          .1
          .wait(active)
          .unwrap_or_else(std::sync::PoisonError::into_inner);
      }
      drop(active);

      let task = QUEUED_TASK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .take();
      let blocking = QUEUED_BLOCKING
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .take();
      if task.is_some() || blocking.is_some() {
        std::thread::Builder::new()
          .name(BACKEND_CANCELLATION_THREAD.to_owned())
          .spawn(move || {
            drop(task);
            drop(blocking);
          })
          .map_err(|error| {
            Error::new(
              crate::Status::GenericFailure,
              format!("failed to spawn the cancellation worker: {error}"),
            )
          })?
          .join()
          .map_err(crate::bindgen_runtime::panic_to_error)?;
      }
      Ok(())
    }

    fn block_on(&self, future: Pin<&mut dyn Future<Output = ()>>) -> Result<()> {
      BACKEND_BLOCK_ON_CALLS.fetch_add(1, Ordering::SeqCst);
      if PANIC_BLOCK_ON.load(Ordering::SeqCst) {
        panic!("backend block_on panic");
      }
      if FAIL_BLOCK_ON.load(Ordering::SeqCst) {
        return Err(Error::new(
          crate::Status::InvalidArg,
          "backend block_on error",
        ));
      }
      if RETURN_BLOCK_ON_EARLY.load(Ordering::SeqCst) {
        return Ok(());
      }
      futures::executor::block_on(future);
      if PANIC_BLOCK_ON_AFTER_COMPLETION.load(Ordering::SeqCst) {
        panic!("backend block_on panic after completion");
      }
      Ok(())
    }

    fn enter(&self) -> Result<Box<dyn AsyncRuntimeGuard + '_>> {
      BACKEND_ENTER_CALLS.fetch_add(1, Ordering::SeqCst);
      if PANIC_ENTER.load(Ordering::SeqCst) {
        panic!("backend enter panic");
      }
      if FAIL_ENTER.load(Ordering::SeqCst) {
        return Err(Error::new(crate::Status::InvalidArg, "backend enter error"));
      }
      Ok(Box::new(InlineRuntimeGuard))
    }

    fn spawn_blocking(
      &self,
      work: Box<dyn FnOnce() + Send + 'static>,
    ) -> std::result::Result<(), AsyncRuntimeRejection<Box<dyn FnOnce() + Send + 'static>>> {
      if PANIC_AFTER_RETAINING_SPAWN_BLOCKING.load(Ordering::SeqCst) {
        let previous = QUEUED_BLOCKING
          .lock()
          .unwrap_or_else(std::sync::PoisonError::into_inner)
          .replace(work);
        assert!(
          previous.is_none(),
          "only one blocking closure may be queued"
        );
        panic!("backend spawn_blocking panic after retaining work");
      }
      if PANIC_SPAWN_BLOCKING.load(Ordering::SeqCst) {
        panic!("backend spawn_blocking panic");
      }
      if DECLINE_SPAWN_BLOCKING.load(Ordering::SeqCst) {
        return Err(AsyncRuntimeRejection::new(
          work,
          Error::new(
            crate::Status::QueueFull,
            "InlineRuntime rejected the blocking work",
          ),
        ));
      }
      if DROP_BLOCKING_WORK.load(Ordering::SeqCst) {
        drop(work);
        return Ok(());
      }
      if QUEUE_BLOCKING_WORK.load(Ordering::SeqCst) {
        let previous = QUEUED_BLOCKING
          .lock()
          .unwrap_or_else(std::sync::PoisonError::into_inner)
          .replace(work);
        assert!(
          previous.is_none(),
          "only one blocking closure may be queued"
        );
        return Ok(());
      }
      BACKEND_BLOCKING_CALLS.fetch_add(1, Ordering::SeqCst);
      let drive_inline = DRIVE_SPAWN_BLOCKING_INLINE.swap(false, Ordering::SeqCst);
      let panic_after_driving = PANIC_AFTER_DRIVING_SPAWN_BLOCKING.swap(false, Ordering::SeqCst);
      if drive_inline || panic_after_driving {
        work();
        if panic_after_driving {
          panic!("backend spawn_blocking panic after driving work");
        }
        return Ok(());
      }
      let active = ActiveBackendWork::enter();
      std::thread::Builder::new()
        .name(BACKEND_BLOCKING_THREAD.to_owned())
        .spawn(move || {
          wait_if_backend_worker_start_is_paused();
          let _active = active;
          work();
        })
        .expect("failed to spawn the InlineRuntime blocking thread");
      Ok(())
    }
  }

  /// Registers `InlineRuntime` exactly once for the linked test image.
  fn ensure_runtime() {
    static REGISTER: std::sync::Once = std::sync::Once::new();
    REGISTER.call_once(|| register_async_runtime(InlineRuntime));
  }

  #[test]
  fn runtime_state_test_guard_waits_for_reserved_backend_work() {
    ensure_runtime();
    let (reserved_work_tx, reserved_work_rx) = mpsc::channel();
    let (drained_active_tx, drained_active_rx) = mpsc::channel();
    let (self_wait_released_tx, self_wait_released_rx) = mpsc::channel();
    let (release_work_tx, release_work_rx) = mpsc::channel();

    let guard_owner = std::thread::spawn(move || {
      let guard = runtime_state_test_guard().observe_drain(drained_active_tx);
      WAIT_FOR_ACTIVE_WORK_ON_SHUTDOWN.store(true, Ordering::SeqCst);
      PAUSE_BACKEND_WORKER_START.store(true, Ordering::SeqCst);

      let self_waiting_worker = spawn(async move {
        let mut active = ACTIVE_BACKEND_WORK
          .0
          .lock()
          .unwrap_or_else(std::sync::PoisonError::into_inner);
        while WAIT_FOR_ACTIVE_WORK_ON_SHUTDOWN.load(Ordering::SeqCst) && *active != 0 {
          active = ACTIVE_BACKEND_WORK
            .1
            .wait(active)
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        }
        self_wait_released_tx.send(()).unwrap();
      });
      let delayed_worker = spawn_blocking(move || {
        release_work_rx.recv().unwrap();
      });

      wait_for_backend_workers_at_start(2);
      reserved_work_tx
        .send(
          *ACTIVE_BACKEND_WORK
            .0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner),
        )
        .unwrap();
      drop(guard);
      futures::executor::block_on(self_waiting_worker).unwrap();
      futures::executor::block_on(delayed_worker).unwrap();
    });

    let reserved_work = reserved_work_rx.recv().unwrap();
    release_backend_worker_start();

    let self_wait_released = self_wait_released_rx
      .recv_timeout(Duration::from_secs(5))
      .is_ok();
    if !self_wait_released {
      let active = ACTIVE_BACKEND_WORK
        .0
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
      WAIT_FOR_ACTIVE_WORK_ON_SHUTDOWN.store(false, Ordering::SeqCst);
      ACTIVE_BACKEND_WORK.1.notify_all();
      drop(active);
    }
    release_work_tx.send(()).unwrap();
    guard_owner.join().unwrap();
    let drained_active = drained_active_rx
      .recv_timeout(Duration::from_secs(5))
      .expect("the shared test guard must report its drained backend work");

    assert!(
      reserved_work == 2,
      "backend work must be reserved before its worker thread begins"
    );
    assert!(
      drained_active == 0,
      "the shared test guard must drain reserved backend work before returning"
    );
    assert!(
      self_wait_released,
      "test guard cleanup must release a backend self-waiting during shutdown"
    );
  }

  #[test]
  fn only_eligible_runtime_registration_reaches_publication() {
    let publications = AtomicUsize::new(0);
    for reason in [DUPLICATE_RUNTIME_ERROR, LATE_RUNTIME_REGISTRATION_ERROR] {
      let error = publish_async_runtime_if_eligible((), Some(reason), |()| {
        publications.fetch_add(1, Ordering::SeqCst);
        Ok(())
      })
      .expect_err("a pre-publication registration failure must reject the backend");
      assert_eq!(error.1, reason);
    }
    assert_eq!(publications.load(Ordering::SeqCst), 0);

    publish_async_runtime_if_eligible((), None, |()| {
      publications.fetch_add(1, Ordering::SeqCst);
      Ok(())
    })
    .expect("an eligible registration must publish the backend");
    assert_eq!(publications.load(Ordering::SeqCst), 1);
  }

  #[test]
  fn dual_runtime_shutdown_errors_preserve_both_failures() {
    let error = combine_runtime_shutdown_results(
      Err(Error::new(
        crate::Status::GenericFailure,
        "custom shutdown failed",
      )),
      Err(Error::new(
        crate::Status::GenericFailure,
        "Tokio shutdown failed",
      )),
    )
    .expect_err("both runtime shutdown failures must be reported");

    assert!(error.reason.contains("custom shutdown failed"));
    assert!(error.reason.contains("Tokio shutdown failed"));
  }

  #[test]
  fn failed_start_preserves_primary_error_and_both_cleanup_failures() {
    let cleanup = combine_runtime_shutdown_results(
      Err(Error::new(
        crate::Status::GenericFailure,
        "custom rollback failed",
      )),
      Err(Error::new(
        crate::Status::GenericFailure,
        "Tokio rollback failed",
      )),
    )
    .expect_err("both runtime rollback failures must be reported");
    let error = lifecycle_error(
      Error::new(crate::Status::GenericFailure, "custom start failed"),
      cleanup,
    );

    assert_eq!(
      error.reason,
      "custom start failed; additionally, lifecycle cleanup failed: \
       Custom async runtime shutdown failed: custom rollback failed; additionally, \
       Tokio runtime shutdown failed: Tokio rollback failed"
    );
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
  fn custom_runtime_hooks_may_drive_work_synchronously() {
    ensure_runtime();
    let _guard = runtime_state_test_guard();

    DRIVE_SPAWN_INLINE.store(true, Ordering::SeqCst);
    let handle = spawn(async { 42 });
    assert_eq!(
      futures::executor::block_on(handle).unwrap(),
      42,
      "a finite task driven inside AsyncRuntime::spawn must complete without waiting for the hook"
    );

    DRIVE_SPAWN_BLOCKING_INLINE.store(true, Ordering::SeqCst);
    let handle = spawn_blocking(|| 43);
    assert_eq!(
      futures::executor::block_on(handle).unwrap(),
      43,
      "work invoked inside AsyncRuntime::spawn_blocking must complete before the hook returns"
    );
  }

  #[test]
  fn work_started_synchronously_wins_over_a_later_hook_panic() {
    ensure_runtime();
    let _guard = runtime_state_test_guard();

    PANIC_AFTER_DRIVING_SPAWN.store(true, Ordering::SeqCst);
    let handle = spawn(async { 42 });
    assert_eq!(
      futures::executor::block_on(handle).unwrap(),
      42,
      "a hook panic cannot roll back a task that already completed"
    );

    PANIC_AFTER_DRIVING_SPAWN_BLOCKING.store(true, Ordering::SeqCst);
    let handle = spawn_blocking(|| 43);
    assert_eq!(
      futures::executor::block_on(handle).unwrap(),
      43,
      "a hook panic cannot replace blocking work that already completed"
    );
  }

  #[test]
  fn first_poll_commits_retained_task_despite_later_hook_panic() {
    ensure_runtime();
    let _guard = runtime_state_test_guard();
    let polls = Arc::new(AtomicUsize::new(0));
    let task_polls = Arc::clone(&polls);

    PANIC_AFTER_POLLING_AND_RETAINING_SPAWN.store(true, Ordering::SeqCst);
    let handle = spawn(std::future::poll_fn(move |_| {
      task_polls.fetch_add(1, Ordering::SeqCst);
      Poll::<u8>::Pending
    }));
    PANIC_AFTER_POLLING_AND_RETAINING_SPAWN.store(false, Ordering::SeqCst);

    assert_eq!(polls.load(Ordering::SeqCst), 1);
    let mut handle = Box::pin(handle);
    let waker = futures::task::noop_waker();
    let mut context = Context::from_waker(&waker);
    assert!(
      handle.as_mut().poll(&mut context).is_pending(),
      "a hook panic must not settle work after its first poll committed ownership"
    );

    let task = QUEUED_TASK
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner)
      .take()
      .expect("the backend must retain the task after its first poll");
    drop(task);

    let error = futures::executor::block_on(handle)
      .expect_err("dropping committed work must retain normal cancellation ownership");
    assert!(error.is_cancelled());
    assert_eq!(
      polls.load(Ordering::SeqCst),
      1,
      "dropping committed work must not poll user code again"
    );
  }

  #[test]
  fn explicit_custom_runtime_synchronous_helpers_route_to_backend() {
    ensure_runtime();
    let _guard = runtime_state_test_guard();
    let block_on_calls = BACKEND_BLOCK_ON_CALLS.load(Ordering::SeqCst);
    let enter_calls = BACKEND_ENTER_CALLS.load(Ordering::SeqCst);

    assert_eq!(try_block_on_custom_runtime(async { 41 + 1 }).unwrap(), 42);
    assert_eq!(block_on_custom_runtime(async { 42 + 1 }), 43);
    assert_eq!(
      BACKEND_BLOCK_ON_CALLS.load(Ordering::SeqCst),
      block_on_calls + 2,
      "explicit custom block_on helpers must route through AsyncRuntime::block_on"
    );

    assert_eq!(
      within_selected_async_runtime(|| Ok::<_, Error>(44)).unwrap(),
      44
    );
    assert_eq!(
      BACKEND_ENTER_CALLS.load(Ordering::SeqCst),
      enter_calls + 1,
      "explicit custom entry must route through AsyncRuntime::enter"
    );
  }

  #[test]
  fn declined_spawn_blocking_completes_with_rejection() {
    ensure_runtime();
    let _guard = runtime_state_test_guard();
    let calls_before = BACKEND_BLOCKING_CALLS.load(Ordering::SeqCst);
    let _decline = DeclineNextSpawnBlocking::arm();

    let handle = spawn_blocking(|| std::thread::current().name().map(str::to_owned));
    let error = futures::executor::block_on(handle)
      .expect_err("work declined by the backend must be reported as rejected");

    assert!(error.is_rejected());
    assert!(!error.is_cancelled());
    assert!(!error.is_runtime_error());
    let rejection = error.into_rejection_error();
    assert_eq!(rejection.status, crate::Status::QueueFull);
    assert_eq!(rejection.reason, "InlineRuntime rejected the blocking work");
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
  fn rejected_spawn_completes_with_rejection() {
    ensure_runtime();
    let _guard = runtime_state_test_guard();
    DECLINE_SPAWN.store(true, Ordering::SeqCst);
    let handle = spawn(async { 42 });
    DECLINE_SPAWN.store(false, Ordering::SeqCst);

    let error = futures::executor::block_on(handle)
      .expect_err("a rejected task must complete its join handle");
    assert!(error.is_rejected());
    assert!(!error.is_cancelled());
    assert!(!error.is_runtime_error());
    let rejection = error.into_rejection_error();
    assert_eq!(rejection.status, crate::Status::QueueFull);
    assert_eq!(rejection.reason, "InlineRuntime rejected the async task");
  }

  #[test]
  fn rejected_generated_task_preserves_the_submission_error() {
    ensure_runtime();
    let _guard = runtime_state_test_guard();
    let env = 0x9876usize as sys::napi_env;
    register_runtime_env_tasks(env);
    let cancellation = Arc::new(Mutex::new(None));
    let cancellation_result = Arc::clone(&cancellation);
    let task = env_async_task(env, std::future::pending::<()>(), move |env_open, error| {
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
        .is_some_and(|error| error.status == crate::Status::QueueFull
          && error.reason == "InlineRuntime rejected the async task"),
      "backend rejection must survive the cancellation path"
    );
    drop(cancellation);
    cancel_runtime_env_tasks(env).wait().unwrap();
  }

  #[test]
  fn generated_task_preserves_a_pre_submission_registration_error() {
    ensure_runtime();
    let _guard = runtime_state_test_guard();
    let env = 0x9878usize as sys::napi_env;
    register_runtime_env_tasks(env);
    let cancellation = Arc::new(Mutex::new(None));
    let cancellation_result = Arc::clone(&cancellation);
    let task = env_async_task(env, std::future::pending::<()>(), move |env_open, error| {
      *cancellation_result
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner) = Some((env_open, error));
    });

    let previous_error = {
      let mut lifecycle = runtime_lifecycle();
      lifecycle
        .registration_error
        .replace(DUPLICATE_RUNTIME_ERROR.to_owned())
    };
    submit_async_task(task);
    runtime_lifecycle().registration_error = previous_error;

    let cancellation = cancellation
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner);
    let (env_open, error) = cancellation
      .as_ref()
      .expect("registration failure must cancel the generated task");
    assert!(*env_open);
    assert!(
      error
        .as_ref()
        .is_some_and(|error| error.reason == DUPLICATE_RUNTIME_ERROR),
      "the recorded registration error must survive the cancellation path"
    );
    drop(cancellation);
    cancel_runtime_env_tasks(env).wait().unwrap();
  }

  #[test]
  fn panicking_spawn_backend_preserves_the_submission_error() {
    ensure_runtime();
    let _guard = runtime_state_test_guard();
    PANIC_SPAWN.store(true, Ordering::SeqCst);
    let handle = spawn(async { 42 });
    PANIC_SPAWN.store(false, Ordering::SeqCst);

    let error = futures::executor::block_on(handle)
      .expect_err("a backend panic must fail the submitted task");
    assert!(error.is_runtime_error());
    assert!(error.to_string().contains("backend spawn panic"));
  }

  #[test]
  fn panicking_spawn_backend_prevents_retained_task_from_running() {
    ensure_runtime();
    let _guard = runtime_state_test_guard();
    let ran = Arc::new(AtomicBool::new(false));
    let ran_in_task = Arc::clone(&ran);
    PANIC_AFTER_RETAINING_SPAWN.store(true, Ordering::SeqCst);
    let handle = spawn(async move {
      ran_in_task.store(true, Ordering::SeqCst);
      42
    });
    PANIC_AFTER_RETAINING_SPAWN.store(false, Ordering::SeqCst);

    let error = handle
      .now_or_never()
      .expect("a hook panic must settle the join before retained task release")
      .expect_err("a retained task must preserve the backend panic");
    assert!(error.is_runtime_error());
    assert!(error
      .to_string()
      .contains("backend spawn panic after retaining task"));

    let task = QUEUED_TASK
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner)
      .take()
      .expect("the panicking backend must retain the task");
    futures::executor::block_on(task);

    assert!(
      !ran.load(Ordering::SeqCst),
      "work retained by a panicking submission hook must not run"
    );
  }

  #[test]
  fn panicking_spawn_backend_rejects_generated_task_with_the_panic() {
    ensure_runtime();
    let _guard = runtime_state_test_guard();
    let env = 0x9877usize as sys::napi_env;
    register_runtime_env_tasks(env);
    let cancellation = Arc::new(Mutex::new(None));
    let cancellation_result = Arc::clone(&cancellation);
    let task = env_async_task(env, std::future::pending::<()>(), move |env_open, error| {
      *cancellation_result
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner) = Some((env_open, error));
    });

    PANIC_SPAWN.store(true, Ordering::SeqCst);
    submit_async_task(task);
    PANIC_SPAWN.store(false, Ordering::SeqCst);

    let cancellation = cancellation
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner);
    let (env_open, error) = cancellation
      .as_ref()
      .expect("backend panic must cancel the generated task");
    assert!(*env_open);
    assert!(
      error
        .as_ref()
        .is_some_and(|error| error.reason.contains("backend spawn panic")),
      "backend panic diagnostics must survive task destruction during unwinding"
    );
    drop(cancellation);
    cancel_runtime_env_tasks(env).wait().unwrap();
  }

  #[test]
  fn panicking_spawn_backend_immediately_rejects_a_retained_generated_task() {
    ensure_runtime();
    let _guard = runtime_state_test_guard();
    let env = 0x9878usize as sys::napi_env;
    register_runtime_env_tasks(env);
    let ran = Arc::new(AtomicBool::new(false));
    let ran_in_task = Arc::clone(&ran);
    let settlements = Arc::new(AtomicUsize::new(0));
    let settlements_in_callback = Arc::clone(&settlements);
    let (settled_tx, settled_rx) = mpsc::channel();
    let task = env_async_task(
      env,
      async move {
        ran_in_task.store(true, Ordering::SeqCst);
        std::future::pending::<()>().await;
      },
      move |env_open, error| {
        settlements_in_callback.fetch_add(1, Ordering::SeqCst);
        settled_tx
          .send((env_open, error.map(|error| error.reason)))
          .unwrap();
      },
    );

    PANIC_AFTER_RETAINING_SPAWN.store(true, Ordering::SeqCst);
    submit_async_task(task);
    PANIC_AFTER_RETAINING_SPAWN.store(false, Ordering::SeqCst);

    let (env_open, error) = settled_rx
      .recv_timeout(Duration::from_secs(5))
      .expect("a hook panic must settle generated work before retained task release");
    assert!(env_open);
    assert!(error.is_some_and(|error| error.contains("backend spawn panic after retaining task")));

    let task = QUEUED_TASK
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner)
      .take()
      .expect("the panicking backend must retain the generated task");
    futures::executor::block_on(task);

    assert!(
      !ran.load(Ordering::SeqCst),
      "a retained generated task must become inert after hook failure"
    );
    assert_eq!(
      settlements.load(Ordering::SeqCst),
      1,
      "later polling and dropping must not settle generated work twice"
    );
    cancel_runtime_env_tasks(env).wait().unwrap();
  }

  #[test]
  fn panicking_spawn_blocking_backend_preserves_the_submission_error() {
    ensure_runtime();
    let _guard = runtime_state_test_guard();
    PANIC_SPAWN_BLOCKING.store(true, Ordering::SeqCst);
    let handle = spawn_blocking(|| 42);
    PANIC_SPAWN_BLOCKING.store(false, Ordering::SeqCst);

    let error = futures::executor::block_on(handle)
      .expect_err("a backend panic must fail the submitted blocking task");
    assert!(error.is_runtime_error());
    assert!(error.to_string().contains("backend spawn_blocking panic"));
  }

  #[test]
  fn panicking_spawn_blocking_backend_prevents_retained_work_from_running() {
    ensure_runtime();
    let _guard = runtime_state_test_guard();
    let ran = Arc::new(AtomicBool::new(false));
    let ran_in_work = Arc::clone(&ran);
    PANIC_AFTER_RETAINING_SPAWN_BLOCKING.store(true, Ordering::SeqCst);
    let handle = spawn_blocking(move || {
      ran_in_work.store(true, Ordering::SeqCst);
      42
    });
    PANIC_AFTER_RETAINING_SPAWN_BLOCKING.store(false, Ordering::SeqCst);

    let error = handle
      .now_or_never()
      .expect("a hook panic must settle the join before retained work release")
      .expect_err("retained blocking work must preserve the backend panic");
    assert!(error.is_runtime_error());
    assert!(error
      .to_string()
      .contains("backend spawn_blocking panic after retaining work"));

    let work = QUEUED_BLOCKING
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner)
      .take()
      .expect("the panicking backend must retain the blocking work");
    work();

    assert!(
      !ran.load(Ordering::SeqCst),
      "work retained by a panicking submission hook must not run"
    );
  }

  struct PendingTaskFutureDropProbe {
    dropped: Arc<AtomicBool>,
  }

  impl Future for PendingTaskFutureDropProbe {
    type Output = AsyncTaskOutcome;

    fn poll(self: Pin<&mut Self>, _cx: &mut Context<'_>) -> Poll<Self::Output> {
      Poll::Pending
    }
  }

  impl Drop for PendingTaskFutureDropProbe {
    fn drop(&mut self) {
      self.dropped.store(true, Ordering::SeqCst);
    }
  }

  struct ReadyTaskFutureDropProbe {
    dropped: Arc<AtomicBool>,
    outcome: Option<AsyncTaskOutcome>,
  }

  impl Future for ReadyTaskFutureDropProbe {
    type Output = AsyncTaskOutcome;

    fn poll(mut self: Pin<&mut Self>, _cx: &mut Context<'_>) -> Poll<Self::Output> {
      Poll::Ready(
        self
          .outcome
          .take()
          .expect("ready task outcome is produced exactly once"),
      )
    }
  }

  impl Drop for ReadyTaskFutureDropProbe {
    fn drop(&mut self) {
      self.dropped.store(true, Ordering::SeqCst);
    }
  }

  #[test]
  fn cancellation_before_accept_remains_idempotent_when_polled() {
    let future_dropped = Arc::new(AtomicBool::new(false));
    let cancellation = Arc::new(Mutex::new(None));
    let cancellation_result = Arc::clone(&cancellation);
    let mut task = AsyncRuntimeTask::new(
      PendingTaskFutureDropProbe {
        dropped: Arc::clone(&future_dropped),
      },
      move |error| {
        *cancellation_result
          .lock()
          .unwrap_or_else(std::sync::PoisonError::into_inner) =
          Some(error.map(|error| error.reason));
      },
    );
    let submission = task.begin_submission();
    submission.cancel(Some(Error::from_reason("first cancellation")));
    let mut task = Box::pin(task);
    let waker = futures::task::noop_waker();
    let mut context = Context::from_waker(&waker);

    assert!(task.as_mut().poll(&mut context).is_ready());
    assert!(future_dropped.load(Ordering::SeqCst));
    assert!(cancellation
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner)
      .is_none());

    assert!(submission.accept());
    assert_eq!(
      cancellation
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .as_ref()
        .and_then(|error| error.as_deref()),
      Some("first cancellation")
    );
  }

  enum BlockingTerminalTaskOutcome {
    Completed(AsyncRuntimeCompletion),
    Cancelled,
    Panic,
  }

  struct BlockingTerminalTaskFuture {
    outcome: Option<BlockingTerminalTaskOutcome>,
    drop_entered: mpsc::Sender<()>,
    drop_release: mpsc::Receiver<()>,
  }

  impl Future for BlockingTerminalTaskFuture {
    type Output = AsyncTaskOutcome;

    fn poll(mut self: Pin<&mut Self>, _cx: &mut Context<'_>) -> Poll<Self::Output> {
      match self
        .outcome
        .take()
        .expect("terminal task outcome is produced exactly once")
      {
        BlockingTerminalTaskOutcome::Completed(completion) => {
          Poll::Ready(AsyncTaskOutcome::Completed(completion))
        }
        BlockingTerminalTaskOutcome::Cancelled => Poll::Ready(AsyncTaskOutcome::Cancelled),
        BlockingTerminalTaskOutcome::Panic => panic!("terminal task poll panic"),
      }
    }
  }

  impl Drop for BlockingTerminalTaskFuture {
    fn drop(&mut self) {
      self.drop_entered.send(()).unwrap();
      self
        .drop_release
        .recv_timeout(Duration::from_secs(5))
        .expect("terminal task future destruction must be released");
    }
  }

  fn poll_terminal_task(task: AsyncRuntimeTask) -> std::thread::JoinHandle<()> {
    std::thread::spawn(move || {
      let mut task = Box::pin(task);
      let waker = futures::task::noop_waker();
      let mut context = Context::from_waker(&waker);
      assert!(task.as_mut().poll(&mut context).is_ready());
    })
  }

  #[test]
  fn completed_task_claims_settlement_before_blocking_future_destruction() {
    let completion_ran = Arc::new(AtomicBool::new(false));
    let cancellation_ran = Arc::new(AtomicBool::new(false));
    let completion_result = Arc::clone(&completion_ran);
    let cancellation_result = Arc::clone(&cancellation_ran);
    let (drop_entered_tx, drop_entered_rx) = mpsc::channel();
    let (drop_release_tx, drop_release_rx) = mpsc::channel();
    let mut task = AsyncRuntimeTask::new(
      BlockingTerminalTaskFuture {
        outcome: Some(BlockingTerminalTaskOutcome::Completed(Box::new(
          move || {
            completion_result.store(true, Ordering::SeqCst);
          },
        ))),
        drop_entered: drop_entered_tx,
        drop_release: drop_release_rx,
      },
      move |_| cancellation_result.store(true, Ordering::SeqCst),
    );
    let submission = task.begin_submission();
    assert!(submission.accept());
    let poll = poll_terminal_task(task);
    drop_entered_rx
      .recv_timeout(Duration::from_secs(5))
      .expect("completed task future destruction must begin");

    submission.cancel(Some(Error::from_reason("unrelated shutdown")));
    assert!(!completion_ran.load(Ordering::SeqCst));
    assert!(!cancellation_ran.load(Ordering::SeqCst));

    drop_release_tx.send(()).unwrap();
    poll.join().unwrap();
    assert!(completion_ran.load(Ordering::SeqCst));
    assert!(!cancellation_ran.load(Ordering::SeqCst));
  }

  #[test]
  fn panicking_task_claims_error_before_blocking_future_destruction() {
    let cancellation = Arc::new(Mutex::new(None));
    let cancellation_result = Arc::clone(&cancellation);
    let (drop_entered_tx, drop_entered_rx) = mpsc::channel();
    let (drop_release_tx, drop_release_rx) = mpsc::channel();
    let mut task = AsyncRuntimeTask::new(
      BlockingTerminalTaskFuture {
        outcome: Some(BlockingTerminalTaskOutcome::Panic),
        drop_entered: drop_entered_tx,
        drop_release: drop_release_rx,
      },
      move |error| {
        *cancellation_result
          .lock()
          .unwrap_or_else(std::sync::PoisonError::into_inner) =
          Some(error.map(|error| error.reason));
      },
    );
    let submission = task.begin_submission();
    assert!(submission.accept());
    let poll = poll_terminal_task(task);
    drop_entered_rx
      .recv_timeout(Duration::from_secs(5))
      .expect("panicking task future destruction must begin");

    submission.cancel(Some(Error::from_reason("unrelated shutdown")));
    assert!(cancellation
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner)
      .is_none());

    drop_release_tx.send(()).unwrap();
    poll.join().unwrap();
    assert!(cancellation
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner)
      .as_ref()
      .is_some_and(|error| error
        .as_ref()
        .is_some_and(|reason| reason.contains("terminal task poll panic"))));
  }

  #[test]
  fn cancelled_task_claims_terminal_result_before_blocking_future_destruction() {
    let cancellation = Arc::new(Mutex::new(None));
    let cancellation_result = Arc::clone(&cancellation);
    let (drop_entered_tx, drop_entered_rx) = mpsc::channel();
    let (drop_release_tx, drop_release_rx) = mpsc::channel();
    let mut task = AsyncRuntimeTask::new(
      BlockingTerminalTaskFuture {
        outcome: Some(BlockingTerminalTaskOutcome::Cancelled),
        drop_entered: drop_entered_tx,
        drop_release: drop_release_rx,
      },
      move |error| {
        *cancellation_result
          .lock()
          .unwrap_or_else(std::sync::PoisonError::into_inner) =
          Some(error.map(|error| error.reason));
      },
    );
    let submission = task.begin_submission();
    assert!(submission.accept());
    let poll = poll_terminal_task(task);
    drop_entered_rx
      .recv_timeout(Duration::from_secs(5))
      .expect("cancelled task future destruction must begin");

    submission.cancel(Some(Error::from_reason("unrelated shutdown")));
    assert!(cancellation
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner)
      .is_none());

    drop_release_tx.send(()).unwrap();
    poll.join().unwrap();
    assert_eq!(
      *cancellation
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner),
      Some(None)
    );
  }

  #[test]
  fn accepted_task_drops_future_before_cancellation_callback() {
    let future_dropped = Arc::new(AtomicBool::new(false));
    let callback_saw_drop = Arc::new(AtomicBool::new(false));
    let callback_future_dropped = Arc::clone(&future_dropped);
    let callback_saw_drop_result = Arc::clone(&callback_saw_drop);
    let mut task = AsyncRuntimeTask::new(
      PendingTaskFutureDropProbe {
        dropped: Arc::clone(&future_dropped),
      },
      move |_| {
        callback_saw_drop_result.store(
          callback_future_dropped.load(Ordering::SeqCst),
          Ordering::SeqCst,
        );
      },
    );
    let submission = task.begin_submission();
    assert!(submission.accept());
    let mut task = Box::pin(task);
    let waker = futures::task::noop_waker();
    let mut context = Context::from_waker(&waker);
    assert!(task.as_mut().poll(&mut context).is_pending());

    drop(task);

    assert!(future_dropped.load(Ordering::SeqCst));
    assert!(callback_saw_drop.load(Ordering::SeqCst));
  }

  #[test]
  fn completed_task_drops_future_before_completion_callback() {
    let future_dropped = Arc::new(AtomicBool::new(false));
    let callback_saw_drop = Arc::new(AtomicBool::new(false));
    let callback_future_dropped = Arc::clone(&future_dropped);
    let callback_saw_drop_result = Arc::clone(&callback_saw_drop);
    let task = AsyncRuntimeTask::new(
      ReadyTaskFutureDropProbe {
        dropped: Arc::clone(&future_dropped),
        outcome: Some(AsyncTaskOutcome::Completed(Box::new(move || {
          callback_saw_drop_result.store(
            callback_future_dropped.load(Ordering::SeqCst),
            Ordering::SeqCst,
          );
        }))),
      },
      |_| {},
    );
    let mut task = Box::pin(task);
    let waker = futures::task::noop_waker();
    let mut context = Context::from_waker(&waker);

    assert!(task.as_mut().poll(&mut context).is_ready());
    assert!(future_dropped.load(Ordering::SeqCst));
    assert!(callback_saw_drop.load(Ordering::SeqCst));
  }

  #[test]
  fn submission_failure_drops_retained_unstarted_future_before_callback() {
    let future_dropped = Arc::new(AtomicBool::new(false));
    let callback_saw_drop = Arc::new(AtomicBool::new(false));
    let callback_future_dropped = Arc::clone(&future_dropped);
    let callback_saw_drop_result = Arc::clone(&callback_saw_drop);
    let mut task = AsyncRuntimeTask::new(
      PendingTaskFutureDropProbe {
        dropped: Arc::clone(&future_dropped),
      },
      move |_| {
        callback_saw_drop_result.store(
          callback_future_dropped.load(Ordering::SeqCst),
          Ordering::SeqCst,
        );
      },
    );
    let submission = task.begin_submission();

    submission.fail(Error::from_reason("injected submission failure"));

    assert!(future_dropped.load(Ordering::SeqCst));
    assert!(callback_saw_drop.load(Ordering::SeqCst));
    drop(task);
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
    let error = within_selected_async_runtime(|| Ok::<_, Error>(42))
      .expect_err("a backend enter panic must become a napi error");
    PANIC_ENTER.store(false, Ordering::SeqCst);

    assert!(error.reason.contains("backend enter panic"));
  }

  #[test]
  fn panicking_runtime_guard_drop_returns_an_error() {
    ensure_runtime();
    let _guard = runtime_state_test_guard();
    PANIC_GUARD_DROP.store(true, Ordering::SeqCst);
    let error = within_selected_async_runtime(|| Ok::<_, Error>(42))
      .expect_err("a guard destructor panic must become a napi error");
    PANIC_GUARD_DROP.store(false, Ordering::SeqCst);

    assert!(error.reason.contains("backend guard drop panic"));
  }

  #[test]
  fn closure_and_guard_panics_are_both_contained() {
    ensure_runtime();
    let _guard = runtime_state_test_guard();
    PANIC_GUARD_DROP.store(true, Ordering::SeqCst);
    let error = within_selected_async_runtime(|| -> Result<()> {
      panic!("runtime closure panic");
    })
    .expect_err("callback and guard panics must not escape");

    assert_eq!(error.status, crate::Status::GenericFailure);
    assert_eq!(
      error.reason,
      "runtime closure panic; additionally, async runtime guard cleanup failed: backend guard \
       drop panic"
    );

    let error = call_with_runtime_guard(InlineRuntimeGuard, || -> () {
      panic!("infallible runtime closure panic");
    })
    .expect_err("infallible callback and guard panics must not escape");
    PANIC_GUARD_DROP.store(false, Ordering::SeqCst);

    assert_eq!(error.status, crate::Status::GenericFailure);
    assert_eq!(
      error.reason,
      "infallible runtime closure panic; additionally, async runtime guard cleanup failed: \
       backend guard drop panic"
    );
  }

  #[test]
  fn callback_error_is_preserved_when_guard_drop_panics() {
    ensure_runtime();
    let _guard = runtime_state_test_guard();
    PANIC_GUARD_DROP.store(true, Ordering::SeqCst);
    let error = within_selected_async_runtime(|| {
      Err::<(), _>(Error::new(
        crate::Status::InvalidArg,
        "runtime callback error",
      ))
    })
    .expect_err("the callback error must remain primary when guard cleanup fails");
    PANIC_GUARD_DROP.store(false, Ordering::SeqCst);

    assert_eq!(error.status, crate::Status::InvalidArg);
    assert!(error.reason.contains("runtime callback error"));
    assert!(error.reason.contains("backend guard drop panic"));
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
  fn block_on_backend_error_is_preserved() {
    ensure_runtime();
    let _guard = runtime_state_test_guard();
    FAIL_BLOCK_ON.store(true, Ordering::SeqCst);
    let error =
      try_block_on(async { 42 }).expect_err("a backend block_on error must be returned directly");
    FAIL_BLOCK_ON.store(false, Ordering::SeqCst);

    assert_eq!(error.status, crate::Status::InvalidArg);
    assert_eq!(error.reason, "backend block_on error");
  }

  #[test]
  fn enter_backend_error_is_preserved() {
    ensure_runtime();
    let _guard = runtime_state_test_guard();
    FAIL_ENTER.store(true, Ordering::SeqCst);
    let error = within_selected_async_runtime(|| Ok::<_, Error>(42))
      .expect_err("a backend enter error must be returned directly");
    FAIL_ENTER.store(false, Ordering::SeqCst);

    assert_eq!(error.status, crate::Status::InvalidArg);
    assert_eq!(error.reason, "backend enter error");
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
      within_selected_async_runtime(move || {
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
    let error =
      futures::executor::block_on(handle).expect_err("the rejected task must complete as rejected");
    assert!(error.is_rejected());
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
  fn custom_runtime_helpers_are_rejected_before_start_and_after_shutdown() {
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

    let error = futures::executor::block_on(spawn(async { 42 })).unwrap_err();
    assert!(error.is_runtime_error());
    assert!(error.to_string().contains("not running"));
    let error = futures::executor::block_on(spawn_blocking(|| 43)).unwrap_err();
    assert!(error.is_runtime_error());
    assert!(error.to_string().contains("not running"));
    assert_eq!(BACKEND_SPAWN_CALLS.load(Ordering::SeqCst), spawn_calls);
    assert_eq!(
      BACKEND_BLOCKING_CALLS.load(Ordering::SeqCst),
      blocking_calls
    );
    assert!(
      try_block_on(async {}).is_err(),
      "synchronous block_on must wait until the backend has started"
    );
    assert!(
      within_selected_async_runtime(|| Ok::<_, Error>(())).is_err(),
      "custom runtime entry must wait until the backend has started"
    );

    try_shutdown_async_runtime().unwrap();
    assert_eq!(
      BACKEND_SHUTDOWN_CALLS.load(Ordering::SeqCst),
      shutdown_calls + 1,
      "explicit shutdown must let the registered backend clean up its resources"
    );
    let error = futures::executor::block_on(spawn(async { 44 })).unwrap_err();
    assert!(error.is_runtime_error());
    assert!(error.to_string().contains("not running"));
    let error = futures::executor::block_on(spawn_blocking(|| 45)).unwrap_err();
    assert!(error.is_runtime_error());
    assert!(error.to_string().contains("not running"));
    assert_eq!(BACKEND_SPAWN_CALLS.load(Ordering::SeqCst), spawn_calls);
    assert_eq!(
      BACKEND_BLOCKING_CALLS.load(Ordering::SeqCst),
      blocking_calls
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
  fn cleanup_owned_destructors_cannot_transition_the_runtime() {
    ensure_runtime();
    let _guard = runtime_state_test_guard();
    let (result_tx, result_rx) = mpsc::channel();

    let operation = RuntimeOperationGuard::enter();
    drop(ShutdownOnDrop::new(result_tx));
    drop(operation);

    let error = result_rx
      .recv_timeout(Duration::from_secs(5))
      .expect("the cleanup-owned destructor must return")
      .expect_err("runtime cleanup destructors must not start lifecycle transitions");
    assert!(error.reason.contains("inside an AsyncRuntime operation"));
    assert_eq!(runtime_lifecycle().state, RuntimeLifecycleState::Running);
  }

  #[test]
  fn rejected_synchronous_inputs_cannot_restart_the_runtime() {
    ensure_runtime();
    let _guard = runtime_state_test_guard();

    fn assert_rejected_input(call: impl FnOnce(StartOnDrop) -> Result<()>) {
      try_shutdown_async_runtime().unwrap();
      let (result_tx, result_rx) = mpsc::channel();

      let error = call(StartOnDrop::new(result_tx))
        .expect_err("a stopped runtime must reject synchronous work");
      assert!(error.reason.contains("not running"));

      let drop_error = result_rx
        .recv_timeout(Duration::from_secs(5))
        .expect("the rejected input destructor must return")
        .expect_err("a rejected input destructor must not restart the runtime");
      assert!(drop_error
        .reason
        .contains("inside an AsyncRuntime operation"));
      assert_eq!(runtime_lifecycle().state, RuntimeLifecycleState::Stopped);
      try_start_async_runtime().unwrap();
    }

    assert_rejected_input(|probe| {
      try_block_on_custom_runtime(async move {
        drop(probe);
      })
    });
    assert_rejected_input(|probe| {
      within_selected_async_runtime(move || {
        drop(probe);
        Ok(())
      })
    });
    assert_rejected_input(|probe| {
      try_block_on(async move {
        drop(probe);
      })
    });
    assert_rejected_input(|probe| {
      try_within_runtime_if_available(move || {
        drop(probe);
      })
    });
  }

  #[test]
  fn failed_runtime_entry_drops_inputs_inside_an_operation() {
    ensure_runtime();
    let _guard = runtime_state_test_guard();
    let (result_tx, result_rx) = mpsc::channel();
    let probe = ShutdownOnDrop::new(result_tx);
    PANIC_ENTER.store(true, Ordering::SeqCst);

    let error = within_selected_async_runtime(move || {
      drop(probe);
      Ok(())
    })
    .expect_err("a backend enter panic must reject the closure");

    PANIC_ENTER.store(false, Ordering::SeqCst);
    assert!(error.reason.contains("backend enter panic"));
    let drop_error = result_rx
      .recv_timeout(Duration::from_secs(5))
      .expect("the rejected closure destructor must return")
      .expect_err("the rejected closure destructor must not stop the runtime");
    assert!(drop_error
      .reason
      .contains("inside an AsyncRuntime operation"));
    assert_eq!(runtime_lifecycle().state, RuntimeLifecycleState::Running);
  }

  #[test]
  fn returned_values_can_transition_the_runtime() {
    ensure_runtime();
    let _guard = runtime_state_test_guard();
    let (result_tx, result_rx) = mpsc::channel();

    let value = try_block_on_custom_runtime(async move { ShutdownOnDrop::new(result_tx) }).unwrap();
    drop(value);

    result_rx
      .recv_timeout(Duration::from_secs(5))
      .expect("the returned value destructor must run")
      .expect("caller-owned values must not retain the runtime operation guard");
    assert_eq!(runtime_lifecycle().state, RuntimeLifecycleState::Stopped);
    try_start_async_runtime().unwrap();
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
      within_selected_async_runtime(|| {
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

    let error = within_selected_async_runtime(|| {
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
    let error = within_selected_async_runtime(|| Ok::<_, Error>(()))
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
  fn task_poll_rejects_shutdown_before_a_backend_can_wait_on_itself() {
    ensure_runtime();
    let _guard = runtime_state_test_guard();
    let mut self_wait = Some(SelfWaitingShutdown::arm());
    let shutdown_calls = BACKEND_SHUTDOWN_CALLS.load(Ordering::SeqCst);
    let (result_tx, result_rx) = mpsc::channel();
    let handle = spawn(async move {
      result_tx.send(try_shutdown_async_runtime()).unwrap();
    });

    let result = match result_rx.recv_timeout(Duration::from_secs(1)) {
      Ok(result) => result,
      Err(error) => {
        drop(self_wait.take());
        futures::executor::block_on(handle).unwrap();
        try_start_async_runtime().unwrap();
        panic!("shutdown from a task poll waited on the task itself: {error}");
      }
    };
    let error = result.expect_err("shutdown from a task poll must be rejected");
    futures::executor::block_on(handle).unwrap();
    drop(self_wait.take());

    assert!(error.reason.contains("inside an AsyncRuntime operation"));
    assert_eq!(
      BACKEND_SHUTDOWN_CALLS.load(Ordering::SeqCst),
      shutdown_calls,
      "reentrant shutdown must fail before entering the self-waiting backend hook"
    );
  }

  #[test]
  fn blocking_work_rejects_shutdown_before_a_backend_can_wait_on_itself() {
    ensure_runtime();
    let _guard = runtime_state_test_guard();
    let mut self_wait = Some(SelfWaitingShutdown::arm());
    let shutdown_calls = BACKEND_SHUTDOWN_CALLS.load(Ordering::SeqCst);
    let (result_tx, result_rx) = mpsc::channel();
    let handle = spawn_blocking(move || {
      result_tx.send(try_shutdown_async_runtime()).unwrap();
    });

    let result = match result_rx.recv_timeout(Duration::from_secs(1)) {
      Ok(result) => result,
      Err(error) => {
        drop(self_wait.take());
        futures::executor::block_on(handle).unwrap();
        try_start_async_runtime().unwrap();
        panic!("shutdown from blocking work waited on the work itself: {error}");
      }
    };
    let error = result.expect_err("shutdown from blocking work must be rejected");
    futures::executor::block_on(handle).unwrap();
    drop(self_wait.take());

    assert!(error.reason.contains("inside an AsyncRuntime operation"));
    assert_eq!(
      BACKEND_SHUTDOWN_CALLS.load(Ordering::SeqCst),
      shutdown_calls,
      "reentrant shutdown must fail before entering the self-waiting backend hook"
    );
  }

  #[test]
  fn shutdown_join_survives_queued_task_destructor_lifecycle_call() {
    ensure_runtime();
    let _guard = runtime_state_test_guard();
    let (drop_result_tx, drop_result_rx) = mpsc::channel();
    QUEUE_SPAWN_TASK.store(true, Ordering::SeqCst);
    let drop_probe = ShutdownOnDrop::new(drop_result_tx);
    let handle = spawn(async move {
      std::future::pending::<()>().await;
      drop(drop_probe);
      42
    });
    QUEUE_SPAWN_TASK.store(false, Ordering::SeqCst);

    let (shutdown_result_tx, shutdown_result_rx) = mpsc::channel();
    let shutdown = std::thread::spawn(move || {
      shutdown_result_tx
        .send(try_shutdown_async_runtime())
        .unwrap();
    });
    let error = await_terminal_drop_and_shutdown(drop_result_rx, shutdown_result_rx, shutdown);

    assert!(error.reason.contains("inside an AsyncRuntime operation"));
    assert!(futures::executor::block_on(handle)
      .expect_err("dropping a queued task must cancel its join handle")
      .is_cancelled());
    try_start_async_runtime().unwrap();
  }

  #[test]
  fn queued_unpolled_task_cancellation_rejects_reentrant_shutdown() {
    ensure_runtime();
    let _guard = runtime_state_test_guard();
    let shutdown_calls = BACKEND_SHUTDOWN_CALLS.load(Ordering::SeqCst);
    let (callback_result_tx, callback_result_rx) = mpsc::channel();
    let (destructor_result_tx, destructor_result_rx) = mpsc::channel();
    let destructor_probe = ShutdownOnDrop::new(destructor_result_tx);
    let task = AsyncRuntimeTask::new(std::future::pending::<AsyncTaskOutcome>(), move |_| {
      callback_result_tx
        .send(try_shutdown_async_runtime())
        .unwrap();
      drop(destructor_probe);
    });

    QUEUE_SPAWN_TASK.store(true, Ordering::SeqCst);
    submit_async_task(task);
    QUEUE_SPAWN_TASK.store(false, Ordering::SeqCst);
    let task = QUEUED_TASK
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner)
      .take()
      .expect("the backend must retain the unpolled task");
    std::thread::Builder::new()
      .name(BACKEND_CANCELLATION_THREAD.to_owned())
      .spawn(move || drop(task))
      .expect("failed to spawn the cancellation worker")
      .join()
      .expect("the cancellation worker must not panic");

    for result in [callback_result_rx, destructor_result_rx] {
      let error = result
        .recv_timeout(Duration::from_secs(5))
        .expect("the cancellation action must attempt shutdown")
        .expect_err("cancellation actions must not reenter runtime shutdown");
      assert!(error.reason.contains("inside an AsyncRuntime operation"));
    }
    assert_eq!(
      BACKEND_SHUTDOWN_CALLS.load(Ordering::SeqCst),
      shutdown_calls,
      "cancellation actions must fail before entering the backend shutdown hook"
    );

    try_shutdown_async_runtime().unwrap();
    try_start_async_runtime().unwrap();
  }

  #[test]
  fn shutdown_join_survives_queued_blocking_destructor_lifecycle_call() {
    ensure_runtime();
    let _guard = runtime_state_test_guard();
    let (drop_result_tx, drop_result_rx) = mpsc::channel();
    QUEUE_BLOCKING_WORK.store(true, Ordering::SeqCst);
    let drop_probe = ShutdownOnDrop::new(drop_result_tx);
    let handle = spawn_blocking(move || {
      drop(drop_probe);
      42
    });
    QUEUE_BLOCKING_WORK.store(false, Ordering::SeqCst);

    let (shutdown_result_tx, shutdown_result_rx) = mpsc::channel();
    let shutdown = std::thread::spawn(move || {
      shutdown_result_tx
        .send(try_shutdown_async_runtime())
        .unwrap();
    });
    let error = await_terminal_drop_and_shutdown(drop_result_rx, shutdown_result_rx, shutdown);

    assert!(error.reason.contains("inside an AsyncRuntime operation"));
    assert!(futures::executor::block_on(handle)
      .expect_err("dropping queued blocking work must cancel its join handle")
      .is_cancelled());
    try_start_async_runtime().unwrap();
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
    assert!(error.contains("already in progress"));
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

  struct EnvTaskEntriesLockProbe {
    tasks: Arc<EnvTasks>,
    lock_was_available: AtomicBool,
  }

  impl ArcWake for EnvTaskEntriesLockProbe {
    fn wake_by_ref(arc_self: &Arc<Self>) {
      arc_self.lock_was_available.store(
        arc_self.tasks.entries.try_lock().is_ok(),
        std::sync::atomic::Ordering::SeqCst,
      );
    }
  }

  fn poll_pending_env_task(
    env: sys::napi_env,
    probe: &Arc<EnvTasksLockProbe>,
  ) -> Pin<Box<AsyncRuntimeTask>> {
    let mut task = Box::pin(env_async_task(env, std::future::pending::<()>(), |_, _| {}));
    let waker = futures::task::waker(Arc::clone(probe));
    let mut context = Context::from_waker(&waker);
    assert!(task.as_mut().poll(&mut context).is_pending());
    task
  }

  #[test]
  fn duplicate_environment_task_registration_is_idempotent_and_cleanup_wakes_without_registry_lock()
  {
    let _guard = runtime_state_test_guard();

    let duplicate_env = 0x1111usize as sys::napi_env;
    assert!(register_runtime_env_tasks(duplicate_env));
    let duplicate_probe = Arc::new(EnvTasksLockProbe {
      lock_was_available: AtomicBool::new(false),
    });
    let mut duplicate_task = poll_pending_env_task(duplicate_env, &duplicate_probe);
    assert!(!register_runtime_env_tasks(duplicate_env));
    assert!(!duplicate_probe.lock_was_available.load(Ordering::SeqCst));
    let waker = futures::task::waker(Arc::clone(&duplicate_probe));
    let mut context = Context::from_waker(&waker);
    assert!(duplicate_task.as_mut().poll(&mut context).is_pending());

    let duplicate_cleanup = cancel_runtime_env_tasks(duplicate_env);
    assert!(duplicate_probe.lock_was_available.load(Ordering::SeqCst));
    assert!(duplicate_task.as_mut().poll(&mut context).is_ready());
    drop(duplicate_task);
    duplicate_cleanup.wait().unwrap();

    assert!(register_runtime_env_tasks(duplicate_env));
    let fresh_probe = Arc::new(EnvTasksLockProbe {
      lock_was_available: AtomicBool::new(false),
    });
    let fresh_task = poll_pending_env_task(duplicate_env, &fresh_probe);
    let fresh_cleanup = cancel_runtime_env_tasks(duplicate_env);
    assert!(fresh_probe.lock_was_available.load(Ordering::SeqCst));
    drop(fresh_task);
    fresh_cleanup.wait().unwrap();

    let removed_env = 0x2222usize as sys::napi_env;
    assert!(register_runtime_env_tasks(removed_env));
    let removed_probe = Arc::new(EnvTasksLockProbe {
      lock_was_available: AtomicBool::new(false),
    });
    let removed_task = poll_pending_env_task(removed_env, &removed_probe);
    let removed_cleanup = cancel_runtime_env_tasks(removed_env);
    assert!(removed_probe.lock_was_available.load(Ordering::SeqCst));
    drop(removed_task);
    removed_cleanup.wait().unwrap();

    let shutdown_env = 0x3333usize as sys::napi_env;
    assert!(register_runtime_env_tasks(shutdown_env));
    let shutdown_probe = Arc::new(EnvTasksLockProbe {
      lock_was_available: AtomicBool::new(false),
    });
    let shutdown_task = poll_pending_env_task(shutdown_env, &shutdown_probe);
    cancel_all_env_tasks();
    assert!(shutdown_probe.lock_was_available.load(Ordering::SeqCst));
    drop(shutdown_task);
    cancel_runtime_env_tasks(shutdown_env).wait().unwrap();
  }

  #[test]
  fn close_race_aborts_without_environment_task_lock() {
    let tasks = Arc::new(EnvTasks::new());
    let (abort_handle, abort_registration) = AbortHandle::new_pair();
    let id = tasks.next_id.fetch_add(1, Ordering::Relaxed);
    tasks
      .entries
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner)
      .insert(
        id,
        EnvTaskEntry {
          abort_handle: Some(abort_handle),
          task_future: None,
          task_submission: None,
        },
      );

    let probe = Arc::new(EnvTaskEntriesLockProbe {
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
    let _guard = runtime_state_test_guard();

    let env = 0x1234usize as sys::napi_env;
    register_runtime_env_tasks(env);
    let cancellation = Arc::new(Mutex::new(None));
    let cancellation_result = Arc::clone(&cancellation);
    let mut task = env_async_task(env, std::future::pending::<()>(), move |env_open, error| {
      *cancellation_result.lock().unwrap() = Some((env_open, error));
    });
    let submission = task.begin_submission();
    assert!(submission.accept());
    let mut task = Box::pin(task);
    let waker = futures::task::noop_waker();
    let mut context = Context::from_waker(&waker);

    assert!(task.as_mut().poll(&mut context).is_pending());
    let cleanup = cancel_runtime_env_tasks(env);
    assert!(task.as_mut().poll(&mut context).is_ready());
    cleanup.wait().unwrap();
    let cancellation = cancellation.lock().unwrap();
    assert_eq!(
      cancellation.as_ref().map(|(env_open, _)| *env_open),
      Some(false)
    );
    assert!(cancellation.as_ref().unwrap().1.is_none());
  }

  #[test]
  fn runtime_shutdown_cancels_pending_tasks_with_environment_still_open() {
    let _guard = runtime_state_test_guard();

    let env = 0x5678usize as sys::napi_env;
    register_runtime_env_tasks(env);
    let cancellation = Arc::new(Mutex::new(None));
    let cancellation_result = Arc::clone(&cancellation);
    let mut task = env_async_task(env, std::future::pending::<()>(), move |env_open, error| {
      *cancellation_result.lock().unwrap() = Some((env_open, error));
    });
    let submission = task.begin_submission();
    assert!(submission.accept());
    let mut task = Box::pin(task);
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
    cancel_runtime_env_tasks(env).wait().unwrap();
  }

  #[test]
  fn wasm_dispose_settles_pending_tasks_before_closing_the_environment() {
    let _guard = runtime_state_test_guard();

    let env = 0x6789usize as sys::napi_env;
    let env_id = env as usize;
    assert!(register_runtime_env_tasks(env));
    let cancellation = Arc::new(Mutex::new(None));
    let cancellation_result = Arc::clone(&cancellation);
    let mut task = env_async_task(env, std::future::pending::<()>(), move |env_open, error| {
      let env = env_id as sys::napi_env;
      *cancellation_result.lock().unwrap() = Some((
        env_open,
        runtime_env_is_disposing_on_owner_thread(env),
        error,
      ));
    });
    let submission = task.begin_submission();
    assert!(submission.accept());
    let mut task = Box::pin(task);
    let waker = futures::task::noop_waker();
    let mut context = Context::from_waker(&waker);

    assert!(task.as_mut().poll(&mut context).is_pending());
    cancel_and_wait_runtime_env_tasks_before_wasm_dispose(env);
    assert!(task.as_mut().poll(&mut context).is_ready());
    let cancellation = cancellation.lock().unwrap();
    let (env_open, owner_thread_disposal, error) = cancellation
      .as_ref()
      .expect("pre-dispose cancellation must run");
    assert!(*env_open);
    assert!(*owner_thread_disposal);
    assert!(error.is_none());
    assert!(runtime_env_is_open(&runtime_env_tasks(env)));
    drop(cancellation);
    drop(task);
    cancel_runtime_env_tasks(env).wait().unwrap();
  }

  struct PanickingWaker;

  impl ArcWake for PanickingWaker {
    fn wake_by_ref(_arc_self: &Arc<Self>) {
      panic!("backend waker panic");
    }
  }

  struct TrackingWaker {
    wakes: Arc<AtomicUsize>,
    drops: Arc<AtomicUsize>,
  }

  impl ArcWake for TrackingWaker {
    fn wake_by_ref(arc_self: &Arc<Self>) {
      arc_self.wakes.fetch_add(1, Ordering::SeqCst);
    }
  }

  impl Drop for TrackingWaker {
    fn drop(&mut self) {
      self.drops.fetch_add(1, Ordering::SeqCst);
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
  fn dropping_a_pending_join_releases_only_its_consumer_waker() {
    let state = Arc::new(JoinState::<u32>::new());
    let mut handle = Box::pin(JoinHandle {
      state: Arc::clone(&state),
    });
    let wakes = Arc::new(AtomicUsize::new(0));
    let drops = Arc::new(AtomicUsize::new(0));
    let waker_owner = Arc::new(TrackingWaker {
      wakes: Arc::clone(&wakes),
      drops: Arc::clone(&drops),
    });
    let waker = futures::task::waker(Arc::clone(&waker_owner));
    drop(waker_owner);
    {
      let mut context = Context::from_waker(&waker);
      assert!(handle.as_mut().poll(&mut context).is_pending());
    }
    drop(waker);
    assert_eq!(
      drops.load(Ordering::SeqCst),
      0,
      "the pending handle must own the remaining consumer waker"
    );

    drop(handle);

    assert_eq!(drops.load(Ordering::SeqCst), 1);
    {
      let inner = state
        .inner
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
      assert!(!inner.completed);
      assert!(inner.result.is_none());
      assert!(inner.waker.is_none());
    }

    state.complete(Ok(42));
    assert_eq!(
      wakes.load(Ordering::SeqCst),
      0,
      "completion after detachment must not wake the dropped consumer"
    );
    let inner = state
      .inner
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner);
    assert!(inner.completed);
    assert!(inner.result.is_some());
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
  static CUSTOM_START_USES_TOKIO: AtomicBool = AtomicBool::new(false);
  static FAIL_CUSTOM_START: AtomicBool = AtomicBool::new(false);
  static FAIL_CUSTOM_SHUTDOWN_AFTER_TOKIO_USE: AtomicBool = AtomicBool::new(false);
  static CUSTOM_STARTS: AtomicUsize = AtomicUsize::new(0);
  static CUSTOM_SHUTDOWNS: AtomicUsize = AtomicUsize::new(0);
  static CUSTOM_BLOCK_ON_CALLS: AtomicUsize = AtomicUsize::new(0);
  static CUSTOM_ENTER_CALLS: AtomicUsize = AtomicUsize::new(0);
  static START_BLOCK: (Mutex<(bool, bool, bool)>, Condvar) =
    (Mutex::new((false, false, false)), Condvar::new());
  static SHUTDOWN_BLOCK: (Mutex<(bool, bool, bool)>, Condvar) =
    (Mutex::new((false, false, false)), Condvar::new());

  #[cfg(any(
    not(target_family = "wasm"),
    all(target_family = "wasm", tokio_unstable)
  ))]
  struct DropProbe(Arc<AtomicBool>);

  #[cfg(any(
    not(target_family = "wasm"),
    all(target_family = "wasm", tokio_unstable)
  ))]
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

  struct StartOnDropProbe {
    result: Option<mpsc::Sender<Result<()>>>,
  }

  impl StartOnDropProbe {
    fn new(result: mpsc::Sender<Result<()>>) -> Self {
      Self {
        result: Some(result),
      }
    }
  }

  impl Drop for StartOnDropProbe {
    fn drop(&mut self) {
      if let Some(result) = self.result.take() {
        result.send(try_start_async_runtime()).unwrap();
      }
    }
  }

  struct CombinedRuntimeGuard;

  impl AsyncRuntimeGuard for CombinedRuntimeGuard {}

  #[cfg(any(
    not(target_family = "wasm"),
    all(target_family = "wasm", tokio_unstable)
  ))]
  #[test]
  fn retirement_spawn_failure_returns_the_undropped_value() {
    let dropped = Arc::new(AtomicBool::new(false));
    let probe = DropProbe(Arc::clone(&dropped));

    let error = launch_background_drop(probe, |worker| {
      drop(worker);
      Err(std::io::Error::other("injected thread creation failure"))
    })
    .expect_err("the injected retirement spawn must fail");

    assert!(!dropped.load(Ordering::SeqCst));
    assert!(error
      .0
      .to_string()
      .contains("injected thread creation failure"));
    std::mem::forget(error.1);
  }

  unsafe impl AsyncRuntime for CombinedRuntime {
    fn spawn(
      &self,
      task: AsyncRuntimeTask,
    ) -> std::result::Result<(), AsyncRuntimeRejection<AsyncRuntimeTask>> {
      std::thread::spawn(move || futures::executor::block_on(task));
      Ok(())
    }

    fn spawn_blocking(
      &self,
      work: Box<dyn FnOnce() + Send + 'static>,
    ) -> std::result::Result<(), AsyncRuntimeRejection<Box<dyn FnOnce() + Send + 'static>>> {
      std::thread::Builder::new()
        .name("combined-custom-runtime-blocking".to_owned())
        .spawn(work)
        .expect("failed to spawn the combined custom runtime blocking thread");
      Ok(())
    }

    fn block_on(&self, future: Pin<&mut dyn Future<Output = ()>>) -> Result<()> {
      CUSTOM_BLOCK_ON_CALLS.fetch_add(1, Ordering::SeqCst);
      futures::executor::block_on(future);
      Ok(())
    }

    fn enter(&self) -> Result<Box<dyn AsyncRuntimeGuard + '_>> {
      CUSTOM_ENTER_CALLS.fetch_add(1, Ordering::SeqCst);
      Ok(Box::new(CombinedRuntimeGuard))
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
      if CUSTOM_START_USES_TOKIO.load(Ordering::SeqCst) {
        try_block_on(async {}).expect("custom start hook must be able to use its Tokio peer");
      }
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
      if FAIL_CUSTOM_SHUTDOWN_AFTER_TOKIO_USE.swap(false, Ordering::SeqCst) {
        return Err(Error::new(
          crate::Status::GenericFailure,
          "injected custom runtime shutdown failure after Tokio use",
        ));
      }
      Ok(())
    }
  }

  fn ensure_runtime() {
    static REGISTER: Once = Once::new();
    REGISTER.call_once(|| try_register_async_runtime(CombinedRuntime).unwrap());
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
    loop {
      tokio_runtime_retirement_waiter()
        .wait()
        .expect("the old Tokio generation must retire cleanly");
      match try_start_async_runtime() {
        Ok(()) => return,
        Err(error) if error.status == crate::Status::WouldDeadlock => continue,
        Err(error) => panic!("runtime did not retire cleanly: {error}"),
      }
    }
  }

  fn wait_for_retirement() {
    tokio_runtime_retirement_waiter()
      .wait()
      .expect("Tokio runtime did not retire cleanly");
  }

  fn tokio_generation() -> Option<usize> {
    TOKIO_RUNTIME_STATE
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner)
      .generation
      .as_ref()
      .map(|generation| generation.retirement.generation)
  }

  #[test]
  fn combined_runtime_lifecycle_is_atomic_and_does_not_hold_tokio_locks_over_user_code() {
    ensure_runtime();
    try_start_async_runtime().unwrap();
    assert!(CUSTOM_RUNNING.load(Ordering::SeqCst));
    {
      let tokio_state = TOKIO_RUNTIME_STATE
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
      assert!(matches!(
        tokio_state.lifecycle,
        TokioRuntimeLifecycle::Uninitialized
      ));
      assert!(tokio_state.generation.is_none());
      assert!(tokio_state.retiring.is_none());
    }
    assert!(
      !tokio_runtime_requires_module_retention(),
      "custom runtime activation must not create or retain a Tokio generation"
    );

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

    let custom_block_on_calls = CUSTOM_BLOCK_ON_CALLS.load(Ordering::SeqCst);
    assert_eq!(try_block_on_custom_runtime(async { 42 }).unwrap(), 42);
    assert_eq!(
      CUSTOM_BLOCK_ON_CALLS.load(Ordering::SeqCst),
      custom_block_on_calls + 1,
      "the explicit custom block_on helper must not switch to Tokio under feature unification"
    );
    let custom_enter_calls = CUSTOM_ENTER_CALLS.load(Ordering::SeqCst);
    assert_eq!(
      within_selected_async_runtime(|| Ok::<_, Error>(43)).unwrap(),
      43
    );
    assert_eq!(
      CUSTOM_ENTER_CALLS.load(Ordering::SeqCst),
      custom_enter_calls + 1,
      "the explicit custom entry helper must not switch to Tokio under feature unification"
    );
    assert!(
      tokio_generation().is_none(),
      "custom-only work must not construct the Tokio compatibility runtime"
    );

    try_block_on(async {}).expect("first Tokio compatibility use must start its runtime lazily");
    let first_tokio_generation =
      tokio_generation().expect("first Tokio compatibility use must publish a generation");
    assert!(
      tokio_runtime_requires_module_retention(),
      "creating a Tokio generation must conservatively require native module retention"
    );
    try_within_runtime_if_available(|| ())
      .expect("a second Tokio compatibility helper must reuse the running generation");
    assert_eq!(
      tokio_generation(),
      Some(first_tokio_generation),
      "Tokio compatibility helpers must construct exactly one generation per lifecycle"
    );

    try_shutdown_async_runtime().unwrap();
    wait_for_retirement();
    start_after_retirement();
    {
      let tokio_state = TOKIO_RUNTIME_STATE
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
      assert!(matches!(
        tokio_state.lifecycle,
        TokioRuntimeLifecycle::Stopped
      ));
      assert!(tokio_state.generation.is_none());
      assert!(tokio_state.retiring.is_none());
    }
    try_block_on(async {})
      .expect("first Tokio compatibility use after custom restart must start lazily");
    let restarted_tokio_generation =
      tokio_generation().expect("Tokio compatibility use after restart must publish a generation");
    assert_ne!(
      restarted_tokio_generation, first_tokio_generation,
      "a custom restart must create a fresh Tokio generation only when compatibility work resumes"
    );
    try_within_runtime_if_available(|| ())
      .expect("subsequent Tokio compatibility use after restart must reuse its generation");
    assert_eq!(
      tokio_generation(),
      Some(restarted_tokio_generation),
      "the restarted lifecycle must also construct Tokio exactly once"
    );
    CUSTOM_START_USES_TOKIO.store(true, Ordering::SeqCst);

    FAIL_CUSTOM_SHUTDOWN_AFTER_TOKIO_USE.store(true, Ordering::SeqCst);
    let error = try_shutdown_async_runtime()
      .expect_err("a custom shutdown failure after Tokio use must be reported");
    assert!(error
      .reason
      .contains("injected custom runtime shutdown failure after Tokio use"));
    assert!(matches!(
      TOKIO_RUNTIME_STATE
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .lifecycle,
      TokioRuntimeLifecycle::Stopped
    ));
    assert!(
      TOKIO_RUNTIME_STATE
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .retiring
        .is_some(),
      "custom shutdown failure must still retire the Tokio generation"
    );
    let error =
      try_start_async_runtime().expect_err("start must remain blocked until shutdown is retried");
    assert!(error
      .reason
      .contains("injected custom runtime shutdown failure after Tokio use"));
    wait_for_retirement();
    try_shutdown_async_runtime().expect(
      "the custom shutdown hook may lazily start a Tokio peer and retire it after returning",
    );
    wait_for_retirement();
    try_start_async_runtime().unwrap();

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
    let (blocking_waiter_tx, blocking_waiter_rx) = mpsc::channel();
    let (blocking_result_tx, blocking_result_rx) = mpsc::channel();
    let blocking = spawn_blocking(move || {
      blocking_started_tx.send(()).unwrap();
      let waiter: TokioRuntimeRetirementWaiter = blocking_waiter_rx.recv().unwrap();
      blocking_result_tx.send(waiter.wait()).unwrap();
    });
    blocking_started_rx
      .recv_timeout(Duration::from_secs(5))
      .expect("blocking task must start");
    try_shutdown_async_runtime().unwrap();
    let error =
      try_start_async_runtime().expect_err("restart must wait for old-generation blocking work");
    assert_eq!(error.status, crate::Status::WouldDeadlock);
    assert!(error.reason.contains("still shutting down"));
    blocking_waiter_tx
      .send(tokio_runtime_retirement_waiter())
      .unwrap();
    let error = blocking_result_rx
      .recv_timeout(Duration::from_secs(5))
      .expect("self-wait must not block")
      .expect_err("retiring-generation work must reject its own wait");
    assert_eq!(error.status, crate::Status::WouldDeadlock);
    futures::executor::block_on(blocking).unwrap();
    start_after_retirement();

    let (direct_started_tx, direct_started_rx) = mpsc::channel();
    let (direct_waiter_tx, direct_waiter_rx) = mpsc::channel();
    let (direct_result_tx, direct_result_rx) = mpsc::channel();
    let direct = try_within_runtime_if_available(|| {
      tokio::task::spawn_blocking(move || {
        direct_started_tx.send(()).unwrap();
        let waiter: TokioRuntimeRetirementWaiter = direct_waiter_rx.recv().unwrap();
        direct_result_tx.send(waiter.wait()).unwrap();
      })
    })
    .unwrap();
    direct_started_rx
      .recv_timeout(Duration::from_secs(5))
      .expect("direct Tokio blocking task must start");
    try_shutdown_async_runtime().unwrap();
    let error = try_start_async_runtime()
      .expect_err("direct Tokio work must keep its old generation retiring");
    assert_eq!(error.status, crate::Status::WouldDeadlock);
    assert!(error.reason.contains("still shutting down"));
    direct_waiter_tx
      .send(tokio_runtime_retirement_waiter())
      .unwrap();
    let error = direct_result_rx
      .recv_timeout(Duration::from_secs(5))
      .expect("direct Tokio self-wait must not block")
      .expect_err("direct Tokio work must reject its own retirement wait");
    assert_eq!(error.status, crate::Status::WouldDeadlock);
    futures::executor::block_on(direct).unwrap();
    start_after_retirement();

    try_shutdown_async_runtime().unwrap();
    wait_for_retirement();
    FAIL_CUSTOM_START.store(true, Ordering::SeqCst);
    FAIL_CUSTOM_SHUTDOWN_AFTER_TOKIO_USE.store(true, Ordering::SeqCst);
    let shutdowns_before_failed_start = CUSTOM_SHUTDOWNS.load(Ordering::SeqCst);
    let error = try_start_async_runtime().expect_err("custom startup failure must be reported");
    assert!(error
      .reason
      .contains("injected custom runtime start failure"));
    assert!(error
      .reason
      .contains("injected custom runtime shutdown failure after Tokio use"));
    assert_eq!(
      CUSTOM_SHUTDOWNS.load(Ordering::SeqCst),
      shutdowns_before_failed_start + 1,
      "a failed custom start must be rolled back through the shutdown hook"
    );
    assert!(!CUSTOM_RUNNING.load(Ordering::SeqCst));
    let tokio_state = TOKIO_RUNTIME_STATE
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner);
    assert!(matches!(
      tokio_state.lifecycle,
      TokioRuntimeLifecycle::Stopped
    ));
    assert!(
      tokio_state.retiring.is_some(),
      "a custom rollback failure must not skip Tokio retirement"
    );
    drop(tokio_state);
    let error = std::panic::catch_unwind(|| spawn(async {}))
      .expect_err("failed combined startup must roll Tokio back to stopped");
    let error = crate::bindgen_runtime::panic_to_error(error);
    assert!(error
      .reason
      .contains("injected custom runtime start failure"));
    assert!(error
      .reason
      .contains("injected custom runtime shutdown failure after Tokio use"));
    FAIL_CUSTOM_START.store(false, Ordering::SeqCst);
    let error = try_start_async_runtime()
      .expect_err("failed-start rollback must be retried before the runtime can start");
    assert!(error
      .reason
      .contains("injected custom runtime shutdown failure after Tokio use"));
    wait_for_retirement();
    try_shutdown_async_runtime()
      .expect("failed-start rollback may lazily start a Tokio peer in the custom shutdown hook");
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
      within_selected_async_runtime(|| Ok::<_, Error>(())).is_err(),
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
      within_selected_async_runtime(|| Ok::<_, Error>(())).is_err(),
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

    for call in [
      |probe| {
        try_block_on_custom_runtime(async move {
          drop(probe);
        })
      },
      |probe| {
        within_selected_async_runtime(move || {
          drop(probe);
          Ok(())
        })
      },
      |probe| {
        try_block_on(async move {
          drop(probe);
        })
      },
      |probe| {
        try_within_runtime_if_available(move || {
          drop(probe);
        })
      },
    ] {
      let (result_tx, result_rx) = mpsc::channel();
      let error = call(StartOnDropProbe::new(result_tx))
        .expect_err("a stopped combined runtime must reject synchronous work");
      assert!(error.reason.contains("not running"));
      let drop_error = result_rx
        .recv_timeout(Duration::from_secs(5))
        .expect("the rejected combined input destructor must return")
        .expect_err("a rejected combined input must not restart the runtime");
      assert!(drop_error
        .reason
        .contains("inside an AsyncRuntime operation"));
      assert_eq!(runtime_lifecycle().state, RuntimeLifecycleState::Stopped);
    }

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

    let (blocking_started_tx, blocking_started_rx) = mpsc::channel();
    let (release_blocking_tx, release_blocking_rx) = mpsc::channel();
    let blocking = spawn_blocking(move || {
      blocking_started_tx.send(()).unwrap();
      release_blocking_rx.recv().unwrap();
    });
    blocking_started_rx
      .recv_timeout(Duration::from_secs(5))
      .expect("the final-cleanup blocker must start");
    FAIL_CUSTOM_SHUTDOWN_AFTER_TOKIO_USE.store(true, Ordering::SeqCst);
    try_shutdown_async_runtime()
      .expect_err("the injected custom shutdown failure must leave Tokio retiring");
    assert!(
      !custom_runtime_shutdown_quiescence_unproven(),
      "an ordinary shutdown error still satisfies the unsafe quiescence contract"
    );
    {
      let mut lifecycle = runtime_lifecycle();
      assert_eq!(lifecycle.state, RuntimeLifecycleState::ShutdownFailed);
      lifecycle.active_envs = 1;
      lifecycle.auto_start_enabled = true;
    }
    let shutdowns_after_failure = CUSTOM_SHUTDOWNS.load(Ordering::SeqCst);

    let (cleanup_result_tx, cleanup_result_rx) = mpsc::channel();
    let cleanup = std::thread::spawn(move || {
      cleanup_result_tx
        .send(unregister_async_runtime_env_with_retirement(|| {}))
        .unwrap();
    });
    cleanup_result_rx
      .recv_timeout(Duration::from_secs(5))
      .expect("last-environment cleanup must not wait for the retiring Tokio generation")
      .expect("last-environment cleanup must defer an already-failed shutdown");
    cleanup.join().unwrap();
    assert_eq!(
      CUSTOM_SHUTDOWNS.load(Ordering::SeqCst),
      shutdowns_after_failure,
      "final cleanup must not retry the custom shutdown without its Tokio peer"
    );
    assert_eq!(
      runtime_lifecycle().state,
      RuntimeLifecycleState::ShutdownFailed
    );
    assert!(
      !custom_runtime_shutdown_quiescence_unproven(),
      "deferring a normally returning shutdown error must preserve its quiescence proof"
    );

    release_blocking_tx.send(()).unwrap();
    futures::executor::block_on(blocking).unwrap();
    wait_for_retirement();
    try_shutdown_async_runtime()
      .expect("an explicit retry may lazily start Tokio after the old generation retires");
    assert!(
      !custom_runtime_shutdown_quiescence_unproven(),
      "a normally returning shutdown retry must clear the panic marker"
    );
    wait_for_retirement();
    start_after_retirement();

    {
      let mut lifecycle = runtime_lifecycle();
      lifecycle.active_envs = 2;
      lifecycle.state = RuntimeLifecycleState::Running;
      lifecycle.startup_error = None;
    }
    let (retirement_entered_tx, retirement_entered_rx) = mpsc::channel();
    let (start_result_tx, start_result_rx) = mpsc::channel();
    let (cleanup, start, start_while_registry_locked) =
      crate::bindgen_runtime::with_runtime_env_registry_lock_for_test(|| {
        let cleanup = std::thread::spawn(move || {
          unregister_async_runtime_env_with_retirement(|| {
            retirement_entered_tx.send(()).unwrap();
            crate::bindgen_runtime::with_runtime_env_registry_lock_for_test(|| {});
          })
        });
        retirement_entered_rx
          .recv_timeout(Duration::from_secs(5))
          .expect("environment retirement must reach the registry acquisition");

        let start = std::thread::spawn(move || {
          start_result_tx.send(try_start_async_runtime()).unwrap();
        });
        let start_while_registry_locked = start_result_rx.recv_timeout(Duration::from_secs(5));
        (cleanup, start, start_while_registry_locked)
      });
    let start_result = match start_while_registry_locked {
      Ok(result) => result,
      Err(error) => {
        let delayed_result = start_result_rx
          .recv_timeout(Duration::from_secs(5))
          .expect("explicit start must return after the registry lock is released");
        cleanup.join().unwrap().unwrap();
        start.join().unwrap();
        panic!(
          "environment retirement held the runtime lifecycle mutex while waiting for the registry: \
           {error}; delayed start result: {delayed_result:?}"
        );
      }
    };
    let error =
      start_result.expect_err("explicit start must observe the environment retirement transition");
    assert_eq!(error.status, crate::Status::WouldDeadlock);
    cleanup.join().unwrap().unwrap();
    start.join().unwrap();
    assert_eq!(runtime_lifecycle().state, RuntimeLifecycleState::Running);
    assert_eq!(runtime_lifecycle().active_envs, 1);

    {
      let mut lifecycle = runtime_lifecycle();
      lifecycle.active_envs = 0;
      lifecycle.state = RuntimeLifecycleState::Running;
      lifecycle.startup_error = None;
    }
    let shutdowns_before_unowned_cleanup = CUSTOM_SHUTDOWNS.load(Ordering::SeqCst);
    let unowned_retirement_ran = Arc::new(AtomicBool::new(false));
    let unowned_retirement_marker = Arc::clone(&unowned_retirement_ran);
    unregister_async_runtime_env_with_retirement(move || {
      unowned_retirement_marker.store(true, Ordering::SeqCst);
    })
    .expect("cleanup without an active environment must still retire its module");
    assert!(unowned_retirement_ran.load(Ordering::SeqCst));
    assert_eq!(
      CUSTOM_SHUTDOWNS.load(Ordering::SeqCst),
      shutdowns_before_unowned_cleanup,
      "cleanup without an active environment must not shut down the runtime"
    );
    assert_eq!(runtime_lifecycle().state, RuntimeLifecycleState::Running);

    let retirement_ran = Arc::new(AtomicBool::new(false));
    {
      let mut lifecycle = runtime_lifecycle();
      lifecycle.active_envs = 1;
      lifecycle.state = RuntimeLifecycleState::Stopping;
    }
    let retirement_marker = Arc::clone(&retirement_ran);
    let error = {
      let _transition = RuntimeTransitionGuard::enter();
      unregister_async_runtime_env_with_retirement(move || {
        retirement_marker.store(true, Ordering::SeqCst);
      })
      .expect_err("recursive cleanup must reject lifecycle waiting")
    };
    assert!(error
      .reason
      .contains("cannot wait recursively from a runtime hook"));
    assert!(
      retirement_ran.load(Ordering::SeqCst),
      "recursive cleanup rejection must not skip module retirement"
    );
    {
      let mut lifecycle = runtime_lifecycle();
      lifecycle.active_envs = 0;
      lifecycle.state = RuntimeLifecycleState::Running;
      lifecycle.startup_error = None;
    }
  }
}
