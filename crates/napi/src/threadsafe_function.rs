#![allow(clippy::single_component_path_imports)]

use std::marker::PhantomData;
use std::os::raw::c_void;
use std::ptr::{self, null_mut};
use std::sync::{
  self,
  atomic::{AtomicBool, AtomicPtr, AtomicU8, AtomicUsize, Ordering},
  Arc, Condvar, Mutex, MutexGuard, RwLock, RwLockReadGuard, RwLockWriteGuard, TryLockError,
};
#[cfg(not(target_family = "wasm"))]
use std::thread::ThreadId;

use futures::channel::oneshot::{channel, Receiver};

use crate::{
  bindgen_runtime::{FromNapiValue, JsValuesTupleIntoVec, TypeName, Unknown, ValidateNapiValue},
  check_status, extract_error_cause, get_error_message_and_stack_trace, sys, Env, Error, JsError,
  Result, Status,
};

#[cfg(target_family = "wasm")]
#[link(wasm_import_module = "env")]
extern "C" {
  fn _emnapi_is_main_browser_thread() -> i32;
  fn _emnapi_is_main_runtime_thread() -> i32;
}

#[cfg(target_family = "wasm")]
#[repr(u8)]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum WasmHostAgent {
  BrowserWindow = 1,
  MainRuntime = 2,
  Worker = 3,
}

#[cfg(target_family = "wasm")]
impl WasmHostAgent {
  fn current() -> Self {
    if unsafe { _emnapi_is_main_browser_thread() != 0 } {
      Self::BrowserWindow
    } else if unsafe { _emnapi_is_main_runtime_thread() != 0 } {
      Self::MainRuntime
    } else {
      Self::Worker
    }
  }

  fn atomic_wait_forbidden(self) -> bool {
    self == Self::BrowserWindow
  }

  fn is_identifiable_owner(self) -> bool {
    self != Self::Worker
  }
}

#[cfg(target_family = "wasm")]
fn current_agent_atomic_wait_forbidden() -> bool {
  WasmHostAgent::current().atomic_wait_forbidden()
}

#[cfg(not(target_family = "wasm"))]
fn current_agent_atomic_wait_forbidden() -> bool {
  false
}

fn checked_update_atomic(
  value: &AtomicUsize,
  update: impl Fn(usize) -> Option<usize>,
) -> std::result::Result<usize, usize> {
  let mut current = value.load(Ordering::Acquire);
  loop {
    let Some(next) = update(current) else {
      return Err(current);
    };
    match value.compare_exchange_weak(current, next, Ordering::AcqRel, Ordering::Acquire) {
      Ok(previous) => return Ok(previous),
      Err(actual) => current = actual,
    }
  }
}

#[deprecated(since = "2.17.0", note = "Please use `ThreadsafeFunction` instead")]
pub type ThreadSafeCallContext<T> = ThreadsafeCallContext<T>;

/// ThreadSafeFunction Context object
/// the `value` is the value passed to `call` method
pub struct ThreadsafeCallContext<T: 'static> {
  pub env: Env,
  pub value: T,
}

#[repr(u8)]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ThreadsafeFunctionCallMode {
  NonBlocking,
  Blocking,
}

impl From<ThreadsafeFunctionCallMode> for sys::napi_threadsafe_function_call_mode {
  fn from(value: ThreadsafeFunctionCallMode) -> Self {
    match value {
      ThreadsafeFunctionCallMode::Blocking => sys::ThreadsafeFunctionCallMode::blocking,
      ThreadsafeFunctionCallMode::NonBlocking => sys::ThreadsafeFunctionCallMode::nonblocking,
    }
  }
}

fn native_enqueue_mode(
  requested_mode: ThreadsafeFunctionCallMode,
  max_queue_size: usize,
) -> ThreadsafeFunctionCallMode {
  if max_queue_size == 0 {
    // Node-API guarantees an unlimited queue cannot block. Use its nonblocking
    // path so only bounded calls participate in waiter serialization.
    ThreadsafeFunctionCallMode::NonBlocking
  } else {
    requested_mode
  }
}

fn should_wait_for_blocking_call(atomic_wait_forbidden: bool) -> bool {
  !atomic_wait_forbidden
}

const TSFN_OWNER_ACTIVE: u8 = 0;
const TSFN_OWNER_RELEASE_PENDING: u8 = 1;
const TSFN_OWNER_ABORT_PENDING: u8 = 2;
const TSFN_OWNER_RETIRED: u8 = 3;

#[cfg(all(
  feature = "__internal_test_tsfn_blocking_state",
  target_family = "wasm"
))]
type ThreadsafeFunctionBlockingWaitObserver = Arc<dyn Fn() -> bool + Send + Sync + 'static>;

struct ThreadsafeFunctionHandle {
  state: Arc<ThreadsafeFunctionHandleState>,
}

struct ThreadsafeFunctionFinalizeContext {
  state: Arc<ThreadsafeFunctionHandleState>,
}

#[cfg_attr(
  all(target_family = "wasm", feature = "noop"),
  allow(
    dead_code,
    reason = "noop WASI builds cannot register env cleanup hooks"
  )
)]
struct ThreadsafeFunctionOwnerCleanupContext {
  state: Arc<ThreadsafeFunctionHandleState>,
}

#[cfg(all(
  feature = "__internal_test_tsfn_blocking_state",
  target_family = "wasm"
))]
static THREADSAFE_FUNCTION_OWNER_CLEANUP_CONTEXTS: AtomicUsize = AtomicUsize::new(0);

impl ThreadsafeFunctionOwnerCleanupContext {
  fn into_raw(state: Arc<ThreadsafeFunctionHandleState>) -> *mut Self {
    #[cfg(all(
      feature = "__internal_test_tsfn_blocking_state",
      target_family = "wasm"
    ))]
    THREADSAFE_FUNCTION_OWNER_CLEANUP_CONTEXTS.fetch_add(1, Ordering::AcqRel);
    Box::into_raw(Box::new(Self { state }))
  }
}

impl Drop for ThreadsafeFunctionOwnerCleanupContext {
  fn drop(&mut self) {
    #[cfg(all(
      feature = "__internal_test_tsfn_blocking_state",
      target_family = "wasm"
    ))]
    if checked_update_atomic(&THREADSAFE_FUNCTION_OWNER_CLEANUP_CONTEXTS, |count| {
      count.checked_sub(1)
    })
    .is_err()
    {
      std::process::abort();
    }
  }
}

type ThreadsafeFunctionFinalizeCallback = Box<dyn FnOnce() + Send + 'static>;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ThreadsafeFunctionFinalizeResult {
  Unregistered,
  ReturnedNormally,
  Panicked,
  AlreadyFinalized,
}

impl ThreadsafeFunctionFinalizeResult {
  fn proves_quiescence(self) -> bool {
    // A zero Rust-handle count only proves that wrapper drop glue completed.
    // The thread that dropped the last wrapper may still be executing addon
    // code, so only an explicit quiescence handshake can make unload safe.
    matches!(self, Self::ReturnedNormally)
  }
}

struct ThreadsafeFunctionHandleState {
  raw: AtomicPtr<sys::napi_threadsafe_function__>,
  max_queue_size: usize,
  owner_env: usize,
  owner_cleanup_context: AtomicPtr<ThreadsafeFunctionOwnerCleanupContext>,
  lifecycle: RwLock<()>,
  blocking_call: Mutex<()>,
  blocking_active: AtomicUsize,
  blocking_waiter: Mutex<()>,
  blocking_idle: Condvar,
  #[cfg(all(
    feature = "__internal_test_tsfn_blocking_state",
    target_family = "wasm"
  ))]
  blocking_wait_observer: Mutex<Option<ThreadsafeFunctionBlockingWaitObserver>>,
  #[cfg(not(target_family = "wasm"))]
  owner_thread: ThreadId,
  #[cfg(target_family = "wasm")]
  owner_agent: WasmHostAgent,
  closing: AtomicBool,
  referred: AtomicBool,
  finalizer: AtomicPtr<ThreadsafeFunctionFinalizeCallback>,
  finalizer_registration_claimed: AtomicBool,
  finalization_started: AtomicBool,
  rust_handle_count: AtomicUsize,
  outstanding_payloads: AtomicUsize,
  begin_finalize_succeeded: AtomicBool,
  quiescence_callback_succeeded: AtomicBool,
  callback_dropped_normally: AtomicBool,
  owner_retirement: AtomicU8,
}

struct ThreadsafeFunctionLifecycleReadGuard<'a> {
  state: &'a ThreadsafeFunctionHandleState,
  guard: Option<RwLockReadGuard<'a, ()>>,
}

impl Drop for ThreadsafeFunctionLifecycleReadGuard<'_> {
  fn drop(&mut self) {
    drop(self.guard.take());
    let _ = self.state.try_finish_pending_retirement();
  }
}

struct ThreadsafeFunctionLifecycleWriteGuard<'a> {
  state: &'a ThreadsafeFunctionHandleState,
  guard: Option<RwLockWriteGuard<'a, ()>>,
}

impl Drop for ThreadsafeFunctionLifecycleWriteGuard<'_> {
  fn drop(&mut self) {
    drop(self.guard.take());
    let _ = self.state.try_finish_pending_retirement();
  }
}

impl ThreadsafeFunctionHandle {
  fn new_with_max_queue_size(
    raw: sys::napi_threadsafe_function,
    max_queue_size: usize,
    owner_env: sys::napi_env,
  ) -> Arc<Self> {
    Arc::new(Self {
      state: Arc::new(ThreadsafeFunctionHandleState {
        raw: AtomicPtr::new(raw),
        max_queue_size,
        owner_env: owner_env as usize,
        owner_cleanup_context: AtomicPtr::new(ptr::null_mut()),
        lifecycle: RwLock::new(()),
        blocking_call: Mutex::new(()),
        blocking_active: AtomicUsize::new(0),
        blocking_waiter: Mutex::new(()),
        blocking_idle: Condvar::new(),
        #[cfg(all(
          feature = "__internal_test_tsfn_blocking_state",
          target_family = "wasm"
        ))]
        blocking_wait_observer: Mutex::new(None),
        #[cfg(not(target_family = "wasm"))]
        owner_thread: std::thread::current().id(),
        #[cfg(target_family = "wasm")]
        owner_agent: WasmHostAgent::current(),
        closing: AtomicBool::new(false),
        referred: AtomicBool::new(true),
        finalizer: AtomicPtr::new(ptr::null_mut()),
        finalizer_registration_claimed: AtomicBool::new(false),
        finalization_started: AtomicBool::new(false),
        rust_handle_count: AtomicUsize::new(0),
        outstanding_payloads: AtomicUsize::new(0),
        begin_finalize_succeeded: AtomicBool::new(false),
        quiescence_callback_succeeded: AtomicBool::new(false),
        callback_dropped_normally: AtomicBool::new(false),
        owner_retirement: AtomicU8::new(TSFN_OWNER_ACTIVE),
      }),
    })
  }

  #[allow(clippy::arc_with_non_send_sync)]
  fn null_with_max_queue_size(max_queue_size: usize, owner_env: sys::napi_env) -> Arc<Self> {
    Self::new_with_max_queue_size(null_mut(), max_queue_size, owner_env)
  }

  fn read_lifecycle(&self) -> ThreadsafeFunctionLifecycleReadGuard<'_> {
    self.state.read_lifecycle()
  }

  fn write_lifecycle(&self) -> ThreadsafeFunctionLifecycleWriteGuard<'_> {
    self.state.write_lifecycle()
  }

  fn lock_blocking_call(&self) -> std::result::Result<MutexGuard<'_, ()>, sys::napi_status> {
    self.state.lock_blocking_call()
  }

  fn owner_thread_must_not_block(&self) -> bool {
    self.state.owner_thread_must_not_block()
  }

  fn retire(&self, mode: sys::napi_threadsafe_function_release_mode) -> sys::napi_status {
    self.state.retire(mode)
  }

  fn mark_closing(&self) {
    self.state.mark_closing();
  }

  fn is_closing(&self) -> bool {
    self.state.is_closing()
  }

  fn start_blocking_call(&self) -> ThreadsafeFunctionBlockingCall<'_> {
    self.state.start_blocking_call()
  }

  fn acquire_call_slot_locked(
    &self,
  ) -> std::result::Result<ThreadsafeFunctionCallSlot<'_>, sys::napi_status> {
    self.state.acquire_call_slot_locked()
  }

  fn owner_retired(&self) -> bool {
    self.state.owner_retired()
  }

  fn get_raw(&self) -> sys::napi_threadsafe_function {
    self.state.get_raw()
  }

  fn set_raw(&self, raw: sys::napi_threadsafe_function) {
    self.state.set_raw(raw);
  }

  fn is_referred(&self) -> bool {
    self.state.referred.load(Ordering::Relaxed)
  }

  fn set_referred(&self, referred: bool) {
    self.state.referred.store(referred, Ordering::Relaxed);
  }

  fn ensure_owner_access(&self, env: sys::napi_env) -> Result<()> {
    self.state.ensure_owner_access(env)
  }

  fn register_finalizer(&self, callback: ThreadsafeFunctionFinalizeCallback) -> Result<()> {
    self.state.register_finalizer(callback)
  }

  #[cfg(all(
    feature = "__internal_test_tsfn_blocking_state",
    target_family = "wasm"
  ))]
  fn register_blocking_wait_observer(
    &self,
    observer: ThreadsafeFunctionBlockingWaitObserver,
  ) -> Result<()> {
    self.state.register_blocking_wait_observer(observer)
  }

  fn new_payload_guard(&self) -> ThreadsafeFunctionPayloadGuard {
    ThreadsafeFunctionPayloadGuard::new(Arc::clone(&self.state))
  }
}

impl ThreadsafeFunctionHandleState {
  fn ensure_owner_access(&self, env: sys::napi_env) -> Result<()> {
    if self.owner_env != env as usize {
      return Err(Error::new(
        Status::InvalidArg,
        "A ThreadsafeFunction cannot be referenced through a different napi_env".to_owned(),
      ));
    }
    if !self.is_owner_agent() {
      return Err(Error::new(
        Status::InvalidArg,
        "A ThreadsafeFunction can only be referenced from its owner agent".to_owned(),
      ));
    }
    Ok(())
  }

  fn read_lifecycle(&self) -> ThreadsafeFunctionLifecycleReadGuard<'_> {
    ThreadsafeFunctionLifecycleReadGuard {
      state: self,
      guard: Some(
        self
          .lifecycle
          .read()
          .unwrap_or_else(std::sync::PoisonError::into_inner),
      ),
    }
  }

  fn write_lifecycle(&self) -> ThreadsafeFunctionLifecycleWriteGuard<'_> {
    ThreadsafeFunctionLifecycleWriteGuard {
      state: self,
      guard: Some(
        self
          .lifecycle
          .write()
          .unwrap_or_else(std::sync::PoisonError::into_inner),
      ),
    }
  }

  fn lock_blocking_call(&self) -> std::result::Result<MutexGuard<'_, ()>, sys::napi_status> {
    if self.is_owner_agent() {
      match self.blocking_call.try_lock() {
        Ok(guard) => Ok(guard),
        Err(TryLockError::Poisoned(error)) => Ok(error.into_inner()),
        Err(TryLockError::WouldBlock) => Err(sys::Status::napi_would_deadlock),
      }
    } else {
      Ok(
        self
          .blocking_call
          .lock()
          .unwrap_or_else(std::sync::PoisonError::into_inner),
      )
    }
  }

  fn owner_thread_must_not_block(&self) -> bool {
    self.max_queue_size != 0 && (self.is_owner_agent() || current_agent_atomic_wait_forbidden())
  }

  fn is_owner_agent(&self) -> bool {
    #[cfg(not(target_family = "wasm"))]
    {
      self.owner_thread == std::thread::current().id()
    }
    #[cfg(target_family = "wasm")]
    {
      self.owner_agent.is_identifiable_owner() && self.owner_agent == WasmHostAgent::current()
    }
  }

  fn request_retirement(&self, mode: sys::napi_threadsafe_function_release_mode) {
    let requested = if mode == sys::ThreadsafeFunctionReleaseMode::abort {
      TSFN_OWNER_ABORT_PENDING
    } else {
      TSFN_OWNER_RELEASE_PENDING
    };
    let mut current = self.owner_retirement.load(Ordering::Acquire);
    loop {
      let next = match current {
        TSFN_OWNER_ACTIVE => requested,
        TSFN_OWNER_RELEASE_PENDING if requested == TSFN_OWNER_ABORT_PENDING => requested,
        TSFN_OWNER_RELEASE_PENDING | TSFN_OWNER_ABORT_PENDING | TSFN_OWNER_RETIRED => return,
        _ => std::process::abort(),
      };
      match self.owner_retirement.compare_exchange_weak(
        current,
        next,
        Ordering::AcqRel,
        Ordering::Acquire,
      ) {
        Ok(_) => return,
        Err(actual) => current = actual,
      }
    }
  }

  fn finish_pending_retirement_locked(&self) -> sys::napi_status {
    let mut current = self.owner_retirement.load(Ordering::Acquire);
    loop {
      let mode = match current {
        TSFN_OWNER_ACTIVE | TSFN_OWNER_RETIRED => return sys::Status::napi_ok,
        TSFN_OWNER_RELEASE_PENDING => sys::ThreadsafeFunctionReleaseMode::release,
        TSFN_OWNER_ABORT_PENDING => sys::ThreadsafeFunctionReleaseMode::abort,
        _ => std::process::abort(),
      };
      match self.owner_retirement.compare_exchange_weak(
        current,
        TSFN_OWNER_RETIRED,
        Ordering::AcqRel,
        Ordering::Acquire,
      ) {
        Ok(_) => {
          let status = unsafe { sys::napi_release_threadsafe_function(self.get_raw(), mode) };
          if status != sys::Status::napi_ok {
            self.owner_retirement.store(current, Ordering::Release);
          }
          return status;
        }
        Err(actual) => current = actual,
      }
    }
  }

  fn try_finish_pending_retirement(&self) -> Option<sys::napi_status> {
    match self.lifecycle.try_write() {
      Ok(_guard) => Some(self.finish_pending_retirement_locked()),
      Err(TryLockError::Poisoned(error)) => {
        let _guard = error.into_inner();
        Some(self.finish_pending_retirement_locked())
      }
      Err(TryLockError::WouldBlock) => None,
    }
  }

  fn retire(&self, mode: sys::napi_threadsafe_function_release_mode) -> sys::napi_status {
    let atomic_wait_forbidden = current_agent_atomic_wait_forbidden();
    if mode == sys::ThreadsafeFunctionReleaseMode::abort {
      self.mark_closing();
    }
    self.request_retirement(mode);
    let status = if atomic_wait_forbidden {
      // Browser-window agents cannot wait for a contended Rust synchronization
      // primitive. The last lifecycle guard completes this pending retirement.
      self
        .try_finish_pending_retirement()
        .unwrap_or(sys::Status::napi_ok)
    } else {
      let _lifecycle_guard = self.write_lifecycle();
      self.finish_pending_retirement_locked()
    };
    if mode == sys::ThreadsafeFunctionReleaseMode::abort && status == sys::Status::napi_ok {
      // Native and worker-thread abort callers wait for the one serialized
      // Blocking call, including callers that raced with an abort already in
      // progress. A browser window agent must never enter an atomic wait.
      self.wait_for_blocking_call_if_allowed();
    }
    status
  }

  fn owner_retired(&self) -> bool {
    self.owner_retirement.load(Ordering::Acquire) == TSFN_OWNER_RETIRED
  }

  fn record_begin_finalize_result(&self, succeeded: bool) {
    self
      .begin_finalize_succeeded
      .store(succeeded, Ordering::Release);
  }

  fn record_callback_drop_result(&self, succeeded: bool) {
    self
      .callback_dropped_normally
      .store(succeeded, Ordering::Release);
  }

  fn quiescence_proven(&self) -> bool {
    self.begin_finalize_succeeded.load(Ordering::Acquire)
      && self.quiescence_callback_succeeded.load(Ordering::Acquire)
      && self.callback_dropped_normally.load(Ordering::Acquire)
      && self.rust_handle_count() == 0
      && self.outstanding_payloads() == 0
  }

  fn mark_closing(&self) {
    self.closing.store(true, Ordering::Release);
  }

  fn is_closing(&self) -> bool {
    self.closing.load(Ordering::Acquire)
  }

  fn start_blocking_call(&self) -> ThreadsafeFunctionBlockingCall<'_> {
    let previous = self.blocking_active.swap(1, Ordering::AcqRel);
    debug_assert!(previous == 0, "Blocking TSFN calls must be serialized");
    ThreadsafeFunctionBlockingCall { handle: self }
  }

  fn wait_for_blocking_call_if_allowed(&self) {
    if !should_wait_for_blocking_call(current_agent_atomic_wait_forbidden())
      || self.blocking_active.load(Ordering::Acquire) == 0
    {
      return;
    }
    let mut waiter = self
      .blocking_waiter
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner);
    #[cfg(all(
      feature = "__internal_test_tsfn_blocking_state",
      target_family = "wasm"
    ))]
    if self.blocking_active.load(Ordering::Acquire) != 0 {
      let observer = self
        .blocking_wait_observer
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .clone();
      if observer.is_some_and(|observer| !observer()) {
        return;
      }
    }
    while self.blocking_active.load(Ordering::Acquire) != 0 {
      waiter = self
        .blocking_idle
        .wait(waiter)
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    }
  }

  #[cfg(all(
    feature = "__internal_test_tsfn_blocking_state",
    target_family = "wasm"
  ))]
  fn register_blocking_wait_observer(
    &self,
    observer: ThreadsafeFunctionBlockingWaitObserver,
  ) -> Result<()> {
    let mut registered = self
      .blocking_wait_observer
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner);
    if registered.is_some() {
      return Err(Error::new(
        Status::InvalidArg,
        "Threadsafe Function blocking wait observer has already been registered",
      ));
    }
    *registered = Some(observer);
    Ok(())
  }

  fn register_finalizer(&self, callback: ThreadsafeFunctionFinalizeCallback) -> Result<()> {
    self.register_finalizer_with_publish_hook(callback, || {})
  }

  fn register_finalizer_with_publish_hook(
    &self,
    callback: ThreadsafeFunctionFinalizeCallback,
    after_publish: impl FnOnce(),
  ) -> Result<()> {
    let _lifecycle_guard = self.write_lifecycle();
    if self.is_closing() || self.owner_retired() {
      return Err(Error::new(
        Status::Closing,
        "Threadsafe Function finalizer cannot be registered after closing has started",
      ));
    }

    if self
      .finalizer_registration_claimed
      .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
      .is_err()
    {
      return Err(if self.finalization_started.load(Ordering::SeqCst) {
        Error::new(
          Status::Closing,
          "Threadsafe Function finalizer cannot be registered after finalization",
        )
      } else {
        Error::new(
          Status::InvalidArg,
          "Threadsafe Function finalizer has already been registered",
        )
      });
    }
    if self.finalization_started.load(Ordering::SeqCst) {
      return Err(Error::new(
        Status::Closing,
        "Threadsafe Function finalizer cannot be registered after finalization",
      ));
    }

    let callback = Box::into_raw(Box::new(callback));
    self.finalizer.store(callback, Ordering::SeqCst);
    after_publish();
    if self.finalization_started.load(Ordering::SeqCst) {
      match self.finalizer.compare_exchange(
        callback,
        ptr::null_mut(),
        Ordering::SeqCst,
        Ordering::SeqCst,
      ) {
        Ok(_) => {
          // Finalization completed its one atomic take before this callback was
          // published. Registration did not commit, so return ownership to the
          // caller as a Closing error.
          drop(unsafe { Box::from_raw(callback) });
          Err(Error::new(
            Status::Closing,
            "Threadsafe Function finalizer cannot be registered after finalization",
          ))
        }
        Err(actual) if actual.is_null() => {
          // Finalization took the callback after publication. That atomic take
          // is the successful registration linearization point.
          Ok(())
        }
        Err(_) => {
          // Only this registration can publish a non-null callback pointer.
          std::process::abort();
        }
      }
    } else {
      Ok(())
    }
  }

  fn run_finalizer(&self) -> ThreadsafeFunctionFinalizeResult {
    if self.finalization_started.swap(true, Ordering::SeqCst) {
      return ThreadsafeFunctionFinalizeResult::AlreadyFinalized;
    }
    let callback = self.finalizer.swap(ptr::null_mut(), Ordering::SeqCst);
    if callback.is_null() {
      return ThreadsafeFunctionFinalizeResult::Unregistered;
    }
    let callback = *unsafe { Box::from_raw(callback) };

    let mut returned_normally = false;
    crate::bindgen_runtime::catch_unwind_safely(|| {
      callback();
      returned_normally = true;
    });
    let result = if returned_normally {
      ThreadsafeFunctionFinalizeResult::ReturnedNormally
    } else {
      ThreadsafeFunctionFinalizeResult::Panicked
    };
    self
      .quiescence_callback_succeeded
      .store(result.proves_quiescence(), Ordering::Release);
    result
  }

  fn begin_finalize(&self) {
    if current_agent_atomic_wait_forbidden() {
      // Native N-API is already finalizing this owner. Publish closure without
      // entering a potentially blocking Rust lock on the browser window.
      self.mark_closing();
      self
        .owner_retirement
        .store(TSFN_OWNER_RETIRED, Ordering::Release);
    } else {
      // Node owns the TSFN while invoking this callback and deletes it after
      // the callback returns. Retire Rust's initial owner before running any
      // user finalizer or callback Drop, because either can synchronously drop
      // the last Rust handle and must not reenter
      // `napi_release_threadsafe_function` for Node's active finalizer.
      let _lifecycle_guard = self.write_lifecycle();
      self.mark_closing();
      self
        .owner_retirement
        .store(TSFN_OWNER_RETIRED, Ordering::Release);
    }
    self.wait_for_blocking_call_if_allowed();
  }

  fn finish_finalize(&self) {
    if current_agent_atomic_wait_forbidden() {
      self.set_raw(ptr::null_mut());
    } else {
      let _lifecycle_guard = self.write_lifecycle();
      self.set_raw(ptr::null_mut());
    }
  }

  fn increment_rust_handle_count(&self) {
    if checked_update_atomic(&self.rust_handle_count, |count| count.checked_add(1)).is_err() {
      std::process::abort();
    }
  }

  fn decrement_rust_handle_count(&self) {
    if checked_update_atomic(&self.rust_handle_count, |count| count.checked_sub(1)).is_err() {
      std::process::abort();
    }
  }

  fn rust_handle_count(&self) -> usize {
    self.rust_handle_count.load(Ordering::Acquire)
  }

  fn increment_outstanding_payloads(&self) {
    if checked_update_atomic(&self.outstanding_payloads, |count| count.checked_add(1)).is_err() {
      std::process::abort();
    }
  }

  fn decrement_outstanding_payloads(&self) {
    if checked_update_atomic(&self.outstanding_payloads, |count| count.checked_sub(1)).is_err() {
      std::process::abort();
    }
  }

  fn outstanding_payloads(&self) -> usize {
    self.outstanding_payloads.load(Ordering::Acquire)
  }

  fn acquire_call_slot_locked(
    &self,
  ) -> std::result::Result<ThreadsafeFunctionCallSlot<'_>, sys::napi_status> {
    if self.owner_retirement.load(Ordering::Acquire) != TSFN_OWNER_ACTIVE || self.is_closing() {
      return Err(sys::Status::napi_closing);
    }
    let raw = self.get_raw();
    if raw.is_null() {
      return Err(sys::Status::napi_closing);
    }
    let status = unsafe { sys::napi_acquire_threadsafe_function(raw) };
    if status == sys::Status::napi_ok {
      return Ok(ThreadsafeFunctionCallSlot {
        handle: self,
        raw,
        acquired: true,
      });
    }
    if status == sys::Status::napi_closing {
      // A failed acquire did not add or consume a native slot. It only tells
      // later calls to stay out of N-API until the owner slot is retired.
      self.mark_closing();
    }
    Err(status)
  }

  fn get_raw(&self) -> sys::napi_threadsafe_function {
    self.raw.load(Ordering::SeqCst)
  }

  fn set_raw(&self, raw: sys::napi_threadsafe_function) {
    self.raw.store(raw, Ordering::SeqCst)
  }

  fn release_owner_cleanup_context(&self, env: sys::napi_env) -> bool {
    let cleanup_context = self
      .owner_cleanup_context
      .swap(ptr::null_mut(), Ordering::AcqRel);
    if cleanup_context.is_null() {
      true
    } else {
      let status = unsafe { remove_threadsafe_function_owner_cleanup_hook(env, cleanup_context) };
      if status == sys::Status::napi_ok {
        drop(unsafe { Box::from_raw(cleanup_context) });
        true
      } else {
        // The hook still owns this box. Keep it reachable in case the
        // environment invokes the hook later.
        self
          .owner_cleanup_context
          .store(cleanup_context, Ordering::Release);
        false
      }
    }
  }
}

impl Drop for ThreadsafeFunctionHandleState {
  fn drop(&mut self) {
    let callback = self.finalizer.swap(ptr::null_mut(), Ordering::AcqRel);
    if !callback.is_null() {
      drop(unsafe { Box::from_raw(callback) });
    }
  }
}

unsafe fn add_threadsafe_function_owner_cleanup_hook(
  env: sys::napi_env,
  data: *mut ThreadsafeFunctionOwnerCleanupContext,
) -> sys::napi_status {
  #[cfg(not(target_family = "wasm"))]
  {
    unsafe {
      sys::napi_add_env_cleanup_hook(env, Some(threadsafe_function_owner_cleanup), data.cast())
    }
  }
  #[cfg(all(target_family = "wasm", not(feature = "noop")))]
  {
    unsafe {
      crate::napi_add_env_cleanup_hook(env, Some(threadsafe_function_owner_cleanup), data.cast())
    }
  }
  #[cfg(all(target_family = "wasm", feature = "noop"))]
  {
    let _ = (env, data);
    sys::Status::napi_generic_failure
  }
}

unsafe fn remove_threadsafe_function_owner_cleanup_hook(
  env: sys::napi_env,
  data: *mut ThreadsafeFunctionOwnerCleanupContext,
) -> sys::napi_status {
  #[cfg(not(target_family = "wasm"))]
  {
    unsafe {
      sys::napi_remove_env_cleanup_hook(env, Some(threadsafe_function_owner_cleanup), data.cast())
    }
  }
  #[cfg(all(target_family = "wasm", not(feature = "noop")))]
  {
    unsafe {
      crate::napi_remove_env_cleanup_hook(env, Some(threadsafe_function_owner_cleanup), data.cast())
    }
  }
  #[cfg(all(target_family = "wasm", feature = "noop"))]
  {
    let _ = (env, data);
    sys::Status::napi_generic_failure
  }
}

fn retain_threadsafe_function_ownership_for_unload_safety() {
  #[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
  crate::bindgen_runtime::retain_current_module_for_unload_safety();
  // WebAssembly code is owned by the current agent's instance rather than a
  // dynamically loaded native image. The instance remains available while
  // that agent can execute Rust code, and terminating the agent stops that
  // execution. There is therefore no native unload race to pin on wasm.
}

#[cfg_attr(
  all(target_family = "wasm", feature = "noop"),
  allow(
    dead_code,
    reason = "noop WASI builds cannot register env cleanup hooks"
  )
)]
unsafe extern "C" fn threadsafe_function_owner_cleanup(data: *mut c_void) {
  let context = unsafe { Box::<ThreadsafeFunctionOwnerCleanupContext>::from_raw(data.cast()) };
  let state = &context.state;
  state
    .owner_cleanup_context
    .store(ptr::null_mut(), Ordering::Release);

  let mut owner_retired = false;
  crate::bindgen_runtime::catch_unwind_safely(|| {
    owner_retired = state.retire(sys::ThreadsafeFunctionReleaseMode::abort) == sys::Status::napi_ok
      && state.owner_retired();
  });
  if !owner_retired {
    retain_threadsafe_function_ownership_for_unload_safety();
  }
}

struct ThreadsafeFunctionHandleLease {
  state: Arc<ThreadsafeFunctionHandleState>,
}

impl ThreadsafeFunctionHandleLease {
  fn new(state: Arc<ThreadsafeFunctionHandleState>) -> Self {
    state.increment_rust_handle_count();
    Self { state }
  }
}

impl Drop for ThreadsafeFunctionHandleLease {
  fn drop(&mut self) {
    self.state.decrement_rust_handle_count();
  }
}

struct ThreadsafeFunctionPayloadGuard {
  state: Arc<ThreadsafeFunctionHandleState>,
}

impl ThreadsafeFunctionPayloadGuard {
  fn new(state: Arc<ThreadsafeFunctionHandleState>) -> Self {
    state.increment_outstanding_payloads();
    Self { state }
  }
}

impl Drop for ThreadsafeFunctionPayloadGuard {
  fn drop(&mut self) {
    self.state.decrement_outstanding_payloads();
  }
}

struct ThreadsafeFunctionCallSlot<'a> {
  handle: &'a ThreadsafeFunctionHandleState,
  raw: sys::napi_threadsafe_function,
  acquired: bool,
}

struct ThreadsafeFunctionBlockingCall<'a> {
  handle: &'a ThreadsafeFunctionHandleState,
}

impl Drop for ThreadsafeFunctionBlockingCall<'_> {
  fn drop(&mut self) {
    let _waiter = self
      .handle
      .blocking_waiter
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner);
    self.handle.blocking_active.store(0, Ordering::Release);
    self.handle.blocking_idle.notify_all();
  }
}

impl ThreadsafeFunctionCallSlot<'_> {
  fn raw(&self) -> sys::napi_threadsafe_function {
    self.raw
  }

  fn release_locked(&mut self) {
    if !self.acquired {
      return;
    }
    let status = unsafe {
      sys::napi_release_threadsafe_function(self.raw, sys::ThreadsafeFunctionReleaseMode::release)
    };
    self.acquired = false;
    debug_assert_eq!(status, sys::Status::napi_ok);
  }

  fn finish(&mut self, status: sys::napi_status) {
    if status == sys::Status::napi_closing {
      // Native Push consumed this call's acquired slot. The initial owner
      // slot is independent and remains for explicit abort, owner Drop, or
      // Node's native finalization.
      self.acquired = false;
      self.handle.mark_closing();
    } else {
      self.release_locked();
    }
  }
}

impl Drop for ThreadsafeFunctionCallSlot<'_> {
  fn drop(&mut self) {
    if self.acquired {
      let handle = self.handle;
      let _lifecycle_guard = handle.read_lifecycle();
      self.release_locked();
    }
  }
}

fn call_nonblocking_threadsafe_function_with_owned_data<T: Send + 'static>(
  handle: &Arc<ThreadsafeFunctionHandle>,
  data: T,
) -> sys::napi_status {
  let mut pending_data = Some(data);
  let mut rejected_call_data = None;
  let status = {
    // Keep finalization, abort, refer, and unref excluded through acquisition,
    // Push, and release. This also makes Node 22's finalizer-before-drain
    // deletion wait until the native call no longer owns a slot.
    let _lifecycle_guard = handle.read_lifecycle();
    match handle.acquire_call_slot_locked() {
      Ok(mut call_slot) => {
        let data = Box::into_raw(Box::new(ThreadsafeFunctionCallData {
          handle: Arc::downgrade(handle),
          data: pending_data
            .take()
            .expect("Threadsafe Function call data must be available before enqueue"),
          payload_guard: handle.new_payload_guard(),
        }));
        let status = unsafe {
          sys::napi_call_threadsafe_function(
            call_slot.raw(),
            data.cast(),
            ThreadsafeFunctionCallMode::NonBlocking.into(),
          )
        };
        if status != sys::Status::napi_ok {
          // N-API only takes ownership after a successful enqueue.
          rejected_call_data =
            Some(unsafe { Box::<ThreadsafeFunctionCallData<T>>::from_raw(data) });
        }
        call_slot.finish(status);
        status
      }
      Err(status) => status,
    }
  };
  drop(rejected_call_data);
  drop(pending_data);
  status
}

fn call_blocking_threadsafe_function_with_owned_data<
  T: Send + 'static,
  BeforeNative: FnOnce(),
  AfterNative: FnOnce(sys::napi_status),
>(
  handle: &Arc<ThreadsafeFunctionHandle>,
  data: T,
  before_native: BeforeNative,
  after_native: AfterNative,
) -> sys::napi_status {
  if handle.owner_thread_must_not_block() {
    // Node cannot drain a bounded queue while its JavaScript thread is blocked.
    // Preserve successful owner-thread calls by enqueueing nonblocking, but
    // report a full queue as the deadlock that Blocking mode would cause.
    let status = call_nonblocking_threadsafe_function_with_owned_data(handle, data);
    return if status == sys::Status::napi_queue_full {
      sys::Status::napi_would_deadlock
    } else {
      status
    };
  }

  // Node's abort path wakes one native queue waiter. Keep at most one
  // Blocking call inside N-API so the remaining callers can observe the local
  // aborted state without entering the native wait queue.
  let blocking_guard = match handle.lock_blocking_call() {
    Ok(guard) => guard,
    Err(status) => {
      drop(data);
      return status;
    }
  };
  let acquired_call = {
    let _lifecycle_guard = handle.read_lifecycle();
    handle
      .acquire_call_slot_locked()
      .map(|call_slot| (call_slot, handle.start_blocking_call()))
  };
  let (mut call_slot, active_call) = match acquired_call {
    Ok(call) => call,
    Err(status) => {
      drop(blocking_guard);
      drop(data);
      return status;
    }
  };
  let data = Box::into_raw(Box::new(ThreadsafeFunctionCallData {
    handle: Arc::downgrade(handle),
    data,
    payload_guard: handle.new_payload_guard(),
  }));
  before_native();
  let status = unsafe {
    sys::napi_call_threadsafe_function(
      call_slot.raw(),
      data.cast(),
      ThreadsafeFunctionCallMode::Blocking.into(),
    )
  };
  after_native(status);
  if status == sys::Status::napi_closing {
    // Blocking calls cannot retain the lifecycle read lock while waiting,
    // because abort needs the write lock to wake them. Publish native closing
    // immediately on return so refer/unref cannot enter during slot cleanup.
    handle.mark_closing();
  }
  let rejected_call_data = if status != sys::Status::napi_ok {
    // N-API only takes ownership after a successful enqueue.
    Some(unsafe { Box::<ThreadsafeFunctionCallData<T>>::from_raw(data) })
  } else {
    None
  };
  {
    // Release a successful/failed call slot before `active_call` wakes a
    // finalizer. A closing Push already consumed the slot itself.
    let _lifecycle_guard = handle.read_lifecycle();
    call_slot.finish(status);
  }
  drop(call_slot);
  drop(active_call);
  drop(blocking_guard);
  drop(rejected_call_data);
  status
}

fn call_threadsafe_function_with_owned_data<T: Send + 'static>(
  handle: &Arc<ThreadsafeFunctionHandle>,
  data: T,
  mode: ThreadsafeFunctionCallMode,
) -> sys::napi_status {
  match native_enqueue_mode(mode, handle.state.max_queue_size) {
    ThreadsafeFunctionCallMode::NonBlocking => {
      call_nonblocking_threadsafe_function_with_owned_data(handle, data)
    }
    ThreadsafeFunctionCallMode::Blocking => {
      call_blocking_threadsafe_function_with_owned_data(handle, data, || {}, |_| {})
    }
  }
}

impl Drop for ThreadsafeFunctionHandle {
  fn drop(&mut self) {
    // If ThreadsafeFunction::create failed, the raw value remains null and
    // there is no native owner slot to retire.
    if self.get_raw().is_null() {
      return;
    }
    let release_status = self.retire(sys::ThreadsafeFunctionReleaseMode::release);
    if release_status != sys::Status::napi_ok {
      // Drop can run from a Node callback or native destructor, so unwinding
      // here could cross an FFI boundary. Keep callback code mapped when the
      // native owner could not be retired.
      retain_threadsafe_function_ownership_for_unload_safety();
    }
  }
}

#[repr(u8)]
pub enum ThreadsafeFunctionCallVariant {
  Direct,
  WithCallback,
}

pub struct ThreadsafeFunctionCallJsBackData<T, Return = Unknown<'static>> {
  pub data: T,
  pub call_variant: ThreadsafeFunctionCallVariant,
  pub callback: Box<dyn FnOnce(Result<Return>, Env) -> Result<()> + Send>,
}

struct ThreadsafeFunctionCallData<T> {
  handle: sync::Weak<ThreadsafeFunctionHandle>,
  data: T,
  payload_guard: ThreadsafeFunctionPayloadGuard,
}

type ThreadsafeFunctionCallResult<T, Return, ErrorStatus> = (
  Option<Arc<ThreadsafeFunctionHandle>>,
  Result<ThreadsafeFunctionCallJsBackData<T, Return>, ErrorStatus>,
  ThreadsafeFunctionPayloadGuard,
);

async fn receive_call_async_result<Return: Send>(
  receiver: Receiver<Result<Return>>,
) -> Result<Return> {
  receiver.await.map_err(|_| {
    crate::Error::new(
      Status::GenericFailure,
      "Receive value from threadsafe function sender failed",
    )
  })?
}

/// Communicate with the addon's main thread by invoking a JavaScript function from other threads.
///
/// ## Lifecycle example
///
/// ```rust
/// use std::{
///   sync::{mpsc, Arc, Mutex},
///   thread,
///   time::Duration,
/// };
///
/// use napi::{
///   bindgen_prelude::Function,
///   threadsafe_function::ThreadsafeFunctionCallMode,
///   Result, Status,
/// };
/// use napi_derive::napi;
///
/// #[napi]
/// pub fn start_threadsafe_function(callback: Function<u32, ()>) -> Result<()> {
///   let tsfn = callback
///     .build_threadsafe_function::<u32>()
///     .weak::<true>()
///     .build_callback(|ctx| Ok(ctx.value))?;
///   let (stop_tx, stop_rx) = mpsc::channel();
///   let worker = Arc::new(Mutex::new(None));
///   let worker_slot = Arc::clone(&worker);
///   let worker_tsfn = tsfn.clone();
///
///   *worker.lock().unwrap() = Some(thread::spawn(move || {
///     let mut value = 0;
///     while stop_rx.recv_timeout(Duration::from_millis(10)).is_err() {
///       if worker_tsfn.call(value, ThreadsafeFunctionCallMode::NonBlocking) != Status::Ok {
///         break;
///       }
///       value += 1;
///     }
///   }));
///
///   // SAFETY: This callback stops and joins the only native worker that can
///   // use the TSFN, recovering a poisoned mutex so unwinding cannot skip the
///   // join. It does not wait for queued JavaScript callbacks.
///   unsafe {
///     tsfn.register_finalizer(move || {
///       let _ = stop_tx.send(());
///       let worker = worker_slot
///         .lock()
///         .unwrap_or_else(std::sync::PoisonError::into_inner)
///         .take();
///       if let Some(worker) = worker {
///         let _ = worker.join();
///       }
///     })
///   }?;
///   Ok(())
/// }
/// ```
pub struct ThreadsafeFunction<
  T: 'static,
  Return: 'static + FromNapiValue = Unknown<'static>,
  CallJsBackArgs: 'static + JsValuesTupleIntoVec = T,
  ErrorStatus: AsRef<str> + From<Status> = Status,
  const CalleeHandled: bool = true,
  const Weak: bool = false,
  const MaxQueueSize: usize = 0,
> {
  // Keep this field before `_handle_lease`: if dropping the last Arc synchronously invokes the
  // native finalizer, the lease must remain visible until ThreadsafeFunctionHandle::drop returns.
  handle: Arc<ThreadsafeFunctionHandle>,
  _handle_lease: ThreadsafeFunctionHandleLease,
  _phantom: PhantomData<(T, CallJsBackArgs, Return, ErrorStatus)>,
}

impl<
    T: 'static,
    Return: FromNapiValue,
    CallJsBackArgs: 'static + JsValuesTupleIntoVec,
    ErrorStatus: AsRef<str> + From<Status>,
    const CalleeHandled: bool,
    const Weak: bool,
    const MaxQueueSize: usize,
  > Clone
  for ThreadsafeFunction<
    T,
    Return,
    CallJsBackArgs,
    ErrorStatus,
    { CalleeHandled },
    { Weak },
    { MaxQueueSize },
  >
{
  fn clone(&self) -> Self {
    Self {
      handle: Arc::clone(&self.handle),
      _handle_lease: ThreadsafeFunctionHandleLease::new(Arc::clone(&self.handle.state)),
      _phantom: PhantomData,
    }
  }
}

unsafe impl<
    T: 'static,
    Return: FromNapiValue,
    CallJsBackArgs: 'static + JsValuesTupleIntoVec,
    ErrorStatus: AsRef<str> + From<Status>,
    const CalleeHandled: bool,
    const Weak: bool,
    const MaxQueueSize: usize,
  > Send
  for ThreadsafeFunction<
    T,
    Return,
    CallJsBackArgs,
    ErrorStatus,
    { CalleeHandled },
    { Weak },
    { MaxQueueSize },
  >
{
}

unsafe impl<
    T: 'static,
    Return: FromNapiValue,
    CallJsBackArgs: 'static + JsValuesTupleIntoVec,
    ErrorStatus: AsRef<str> + From<Status>,
    const CalleeHandled: bool,
    const Weak: bool,
    const MaxQueueSize: usize,
  > Sync
  for ThreadsafeFunction<
    T,
    Return,
    CallJsBackArgs,
    ErrorStatus,
    { CalleeHandled },
    { Weak },
    { MaxQueueSize },
  >
{
}

impl<
    T: 'static + JsValuesTupleIntoVec,
    Return: FromNapiValue,
    ErrorStatus: AsRef<str> + From<Status>,
    const CalleeHandled: bool,
    const Weak: bool,
    const MaxQueueSize: usize,
  > FromNapiValue
  for ThreadsafeFunction<T, Return, T, ErrorStatus, { CalleeHandled }, { Weak }, { MaxQueueSize }>
{
  unsafe fn from_napi_value(env: sys::napi_env, napi_val: sys::napi_value) -> Result<Self> {
    Self::create(env, napi_val, |ctx| Ok(ctx.value))
  }
}

impl<
    T: 'static + JsValuesTupleIntoVec,
    Return: FromNapiValue,
    ErrorStatus: AsRef<str> + From<Status>,
    const CalleeHandled: bool,
    const Weak: bool,
    const MaxQueueSize: usize,
  > TypeName
  for ThreadsafeFunction<T, Return, T, ErrorStatus, { CalleeHandled }, { Weak }, { MaxQueueSize }>
{
  fn type_name() -> &'static str {
    "ThreadsafeFunction"
  }

  fn value_type() -> crate::ValueType {
    crate::ValueType::Function
  }
}

impl<
    T: 'static + JsValuesTupleIntoVec,
    Return: FromNapiValue,
    ErrorStatus: AsRef<str> + From<Status>,
    const CalleeHandled: bool,
    const Weak: bool,
    const MaxQueueSize: usize,
  > ValidateNapiValue
  for ThreadsafeFunction<T, Return, T, ErrorStatus, { CalleeHandled }, { Weak }, { MaxQueueSize }>
{
}

/// Non-generic core of [`ThreadsafeFunction::create`].
///
/// All of the heavy FFI setup (async resource name creation and the
/// `napi_create_threadsafe_function` call) is
/// type-independent, so it is extracted here to be emitted once instead of
/// being monomorphized for every `<T, Return, CallJsBackArgs, ...>`
/// combination. The only per-type parts — the boxed user callback and the two
/// `extern "C"` trampolines — are passed in as raw pointers / function
/// pointers by the generic `create` shell.
fn create_raw(
  env: sys::napi_env,
  func: sys::napi_value,
  max_queue_size: usize,
  callback_ptr: *mut c_void,
  thread_finalize_cb: sys::napi_finalize,
  call_js_cb: sys::napi_threadsafe_function_call_js,
) -> Result<Arc<ThreadsafeFunctionHandle>> {
  let mut async_resource_name = ptr::null_mut();
  static THREAD_SAFE_FUNCTION_ASYNC_RESOURCE_NAME: &str = "napi_rs_threadsafe_function";

  #[cfg(feature = "napi10")]
  {
    let mut copied = false;
    check_status!(
      unsafe {
        sys::node_api_create_external_string_latin1(
          env,
          THREAD_SAFE_FUNCTION_ASYNC_RESOURCE_NAME.as_ptr().cast(),
          27,
          None,
          ptr::null_mut(),
          &mut async_resource_name,
          &mut copied,
        )
      },
      "Create external string latin1 in ThreadsafeFunction::create failed"
    )?;
  }

  #[cfg(not(feature = "napi10"))]
  {
    check_status!(
      unsafe {
        sys::napi_create_string_utf8(
          env,
          THREAD_SAFE_FUNCTION_ASYNC_RESOURCE_NAME.as_ptr().cast(),
          27,
          &mut async_resource_name,
        )
      },
      "Create string utf8 in ThreadsafeFunction::create failed"
    )?;
  }

  let mut raw_tsfn = ptr::null_mut();
  let handle = ThreadsafeFunctionHandle::null_with_max_queue_size(max_queue_size, env);
  let finalize_context = Box::into_raw(Box::new(ThreadsafeFunctionFinalizeContext {
    state: Arc::clone(&handle.state),
  }));
  let create_status = unsafe {
    sys::napi_create_threadsafe_function(
      env,
      func,
      ptr::null_mut(),
      async_resource_name,
      max_queue_size,
      1,
      finalize_context.cast(),
      thread_finalize_cb,
      callback_ptr,
      call_js_cb,
      &mut raw_tsfn,
    )
  };
  if create_status != sys::Status::napi_ok {
    drop(unsafe { Box::from_raw(finalize_context) });
  }
  check_status!(
    create_status,
    "Create threadsafe function in ThreadsafeFunction::create failed"
  )?;
  handle.set_raw(raw_tsfn);

  let cleanup_context = ThreadsafeFunctionOwnerCleanupContext::into_raw(Arc::clone(&handle.state));
  let cleanup_status = unsafe { add_threadsafe_function_owner_cleanup_hook(env, cleanup_context) };
  if cleanup_status == sys::Status::napi_ok {
    handle
      .state
      .owner_cleanup_context
      .store(cleanup_context, Ordering::Release);
  } else {
    drop(unsafe { Box::from_raw(cleanup_context) });
    // Native creation already transferred callback ownership to Node, so
    // creation cannot be rolled back without racing its finalizer. Keep the
    // API usable but fail closed if this environment later tears down with
    // the initial owner still active.
    retain_threadsafe_function_ownership_for_unload_safety();
  }

  Ok(handle)
}

impl<
    T: 'static,
    Return: FromNapiValue,
    CallJsBackArgs: 'static + JsValuesTupleIntoVec,
    ErrorStatus: AsRef<str> + From<Status>,
    const CalleeHandled: bool,
    const Weak: bool,
    const MaxQueueSize: usize,
  >
  ThreadsafeFunction<
    T,
    Return,
    CallJsBackArgs,
    ErrorStatus,
    { CalleeHandled },
    { Weak },
    { MaxQueueSize },
  >
{
  // See [napi_create_threadsafe_function](https://nodejs.org/api/n-api.html#n_api_napi_create_threadsafe_function)
  // for more information.
  pub(crate) fn create<
    NewArgs: 'static + JsValuesTupleIntoVec,
    R: 'static + FnMut(ThreadsafeCallContext<T>) -> Result<NewArgs>,
  >(
    env: sys::napi_env,
    func: sys::napi_value,
    callback: R,
  ) -> Result<
    ThreadsafeFunction<
      T,
      Return,
      NewArgs,
      ErrorStatus,
      { CalleeHandled },
      { Weak },
      { MaxQueueSize },
    >,
  > {
    let callback_ptr = Box::into_raw(Box::new(callback));
    // `napi_create_threadsafe_function` only takes ownership of `callback_ptr`
    // (registering `thread_finalize_cb` to reclaim it) once it succeeds. If
    // `create_raw` returns early on any FFI error, neither N-API nor Rust owns
    // the box, so reclaim it here to avoid leaking the callback.
    let handle = create_raw(
      env,
      func,
      MaxQueueSize,
      callback_ptr.cast(),
      Some(thread_finalize_cb::<T, NewArgs, R>),
      Some(call_js_cb::<T, Return, NewArgs, ErrorStatus, R, CalleeHandled>),
    )
    .inspect_err(|_| {
      drop(unsafe { Box::from_raw(callback_ptr) });
    })?;

    // Successful native creation transferred `callback_ptr` to the registered
    // finalizer. If unref fails, dropping `handle` starts native retirement and
    // that finalizer remains the sole callback owner.
    let tsfn = ThreadsafeFunction {
      _handle_lease: ThreadsafeFunctionHandleLease::new(Arc::clone(&handle.state)),
      handle,
      _phantom: PhantomData,
    };

    if Weak {
      check_status!(
        unsafe { sys::napi_unref_threadsafe_function(env, tsfn.handle.get_raw()) },
        "Unref threadsafe function failed in Weak mode"
      )?;
      // The tsfn is now unreferenced at the N-API level, so keep `referred` in
      // sync. Otherwise the deprecated `refer`/`unref` would read a stale `true`
      // and `refer` would skip its `napi_ref_threadsafe_function` call.
      tsfn.handle.set_referred(false);
    }

    Ok(tsfn)
  }

  #[deprecated(
    since = "2.17.0",
    note = "Please use `ThreadsafeFunction::clone` instead of manually increasing the reference count"
  )]
  /// See [napi_ref_threadsafe_function](https://nodejs.org/api/n-api.html#n_api_napi_ref_threadsafe_function)
  /// for more information.
  ///
  /// "ref" is a keyword so that we use "refer" here.
  pub fn refer(&mut self, env: &Env) -> Result<()> {
    self.handle.ensure_owner_access(env.0)?;
    let _lifecycle_guard = self.handle.write_lifecycle();
    if !self.handle.owner_retired() && !self.handle.is_closing() && !self.handle.is_referred() {
      check_status!(unsafe { sys::napi_ref_threadsafe_function(env.0, self.handle.get_raw()) })?;
      self.handle.set_referred(true);
    }
    Ok(())
  }

  #[deprecated(
    since = "2.17.0",
    note = "Please use `ThreadsafeFunction::clone` instead of manually decreasing the reference count"
  )]
  /// See [napi_unref_threadsafe_function](https://nodejs.org/api/n-api.html#n_api_napi_unref_threadsafe_function)
  /// for more information.
  pub fn unref(&mut self, env: &Env) -> Result<()> {
    self.handle.ensure_owner_access(env.0)?;
    let _lifecycle_guard = self.handle.write_lifecycle();
    if !self.handle.owner_retired() && !self.handle.is_closing() && self.handle.is_referred() {
      check_status!(unsafe { sys::napi_unref_threadsafe_function(env.0, self.handle.get_raw()) })?;
      self.handle.set_referred(false);
    }
    Ok(())
  }

  pub fn aborted(&self) -> bool {
    self.handle.is_closing() || self.handle.owner_retired()
  }

  /// Register the callback that quiesces native threads using this thread-safe function.
  ///
  /// The callback runs exactly once on Node's main loop thread after new calls have been closed
  /// before the JavaScript callback closure and its captures are destroyed and before the native
  /// N-API finalizer returns. Native finalization waits for an in-flight bounded blocking call to
  /// return. Threaded browser WASI finalization only closes and wakes that call because the
  /// owner/window agent is forbidden from entering an atomic wait. Browser workers must therefore
  /// already be quiescent, or use a nonblocking ownership protocol, before owner-agent
  /// finalization begins. On native targets the callback should signal and join every thread that
  /// can call, clone, or drop this thread-safe function. It must not wait for JavaScript callbacks
  /// or queued TSFN payloads. For example, Node 26.0 drains an aborted queue only after the native
  /// finalizer returns, while Node 26.1 drains it first; finalizers must not depend on either
  /// ordering.
  ///
  /// Registration is serialized with abort and finalization. If concurrent registrations race,
  /// exactly one succeeds and the others return [`Status::InvalidArg`]. Registration after abort
  /// or finalization has started returns [`Status::Closing`]. On unwind-enabled builds, a panic
  /// from the registered callback is contained at the FFI boundary and the remaining finalizer
  /// cleanup still runs. The callback must still arrange for worker joins during unwinding; panic
  /// containment alone does not establish quiescence. If the callback unwinds or a Rust handle
  /// still survives afterward, native builds retain the addon image rather than allow potentially
  /// live native code to be unloaded. WebAssembly instances instead remain owned by their
  /// executing agent and do not have an equivalent native image-unload race.
  ///
  /// Without a registered callback, dropping the last Rust handle cannot prove that its thread
  /// has returned from addon code. Native builds therefore retain the addon image at finalization.
  /// WebAssembly hosts keep each agent's instance alive for as long as that agent can execute it,
  /// so they do not need an equivalent loader reference.
  ///
  /// # Safety
  ///
  /// Before the callback returns, it must ensure that every native thread or task that can call,
  /// clone, or drop this thread-safe function, or otherwise execute code from the addon image, is
  /// quiescent. This guarantee must also hold if the callback panics or unwinds. The callback must
  /// not wait for JavaScript callbacks or queued TSFN payloads, because some Node versions process
  /// them only after the native finalizer returns. Destructors of values captured by the JavaScript
  /// callback run afterward on the same thread and must not start new addon work.
  ///
  /// A thread-safe function is referenced by default and therefore keeps the event loop alive. If
  /// this callback is responsible for stopping a worker that retains the thread-safe function,
  /// build it with `ThreadsafeFunctionBuilder::weak::<true>()` or unref it first; otherwise natural
  /// environment teardown may never begin and this callback will not run.
  pub unsafe fn register_finalizer<F>(&self, callback: F) -> Result<()>
  where
    F: FnOnce() + Send + 'static,
  {
    self.handle.register_finalizer(Box::new(callback))
  }

  /// Abort this thread-safe function and wake a bounded [`ThreadsafeFunctionCallMode::Blocking`]
  /// caller.
  ///
  /// Abort is shared and idempotent. It closes the native queue through the serialized lifecycle
  /// path and wakes an in-flight bounded blocking call. Native and non-owner callers wait until
  /// that call has returned. On threaded browser WASI, an owner/window-agent call returns after
  /// issuing the abort because the window agent is forbidden from entering an atomic wait.
  /// Dropping all Rust references normally releases the TSFN, but it does not replace abort when
  /// teardown must wake a caller blocked on a full bounded queue.
  pub fn abort(&self) -> Result<()> {
    check_status!(self
      .handle
      .retire(sys::ThreadsafeFunctionReleaseMode::abort))
  }

  #[cfg(all(
    feature = "__internal_test_tsfn_blocking_state",
    target_family = "wasm"
  ))]
  #[doc(hidden)]
  pub fn __test_register_blocking_wait_observer<F>(&self, observer: F) -> Result<()>
  where
    F: Fn() -> bool + Send + Sync + 'static,
  {
    self
      .handle
      .register_blocking_wait_observer(Arc::new(observer))
  }

  #[cfg(all(
    feature = "__internal_test_tsfn_blocking_state",
    target_family = "wasm"
  ))]
  #[doc(hidden)]
  pub fn __test_blocking_call_state(&self) -> (bool, u8, u8, bool) {
    let current_agent = WasmHostAgent::current();
    (
      self.handle.state.blocking_active.load(Ordering::Acquire) != 0,
      self.handle.state.owner_agent as u8,
      current_agent as u8,
      self.handle.state.owner_agent.is_identifiable_owner()
        && self.handle.state.owner_agent == current_agent,
    )
  }

  #[cfg(all(
    feature = "__internal_test_tsfn_blocking_state",
    target_family = "wasm"
  ))]
  #[doc(hidden)]
  pub fn __test_handle_state_ptr(&self) -> usize {
    Arc::as_ptr(&self.handle.state) as usize
  }

  #[cfg(all(
    feature = "__internal_test_tsfn_blocking_state",
    target_family = "wasm"
  ))]
  #[doc(hidden)]
  pub fn __test_with_lifecycle_read_lock<F: FnOnce()>(&self, callback: F) {
    let _lifecycle_guard = self.handle.read_lifecycle();
    callback();
  }

  #[cfg(all(
    feature = "__internal_test_tsfn_blocking_state",
    target_family = "wasm"
  ))]
  #[doc(hidden)]
  pub fn __test_owner_cleanup_context_count() -> usize {
    THREADSAFE_FUNCTION_OWNER_CLEANUP_CONTEXTS.load(Ordering::Acquire)
  }
}

impl<
    T: 'static + Send,
    Return: FromNapiValue,
    CallJsBackArgs: 'static + JsValuesTupleIntoVec,
    ErrorStatus: 'static + AsRef<str> + From<Status> + Send,
    const Weak: bool,
    const MaxQueueSize: usize,
  > ThreadsafeFunction<T, Return, CallJsBackArgs, ErrorStatus, true, { Weak }, { MaxQueueSize }>
{
  /// See [napi_call_threadsafe_function](https://nodejs.org/api/n-api.html#n_api_napi_call_threadsafe_function)
  /// for more information.
  pub fn call(&self, value: Result<T, ErrorStatus>, mode: ThreadsafeFunctionCallMode) -> Status {
    call_threadsafe_function_with_owned_data(
      &self.handle,
      value.map(|data| ThreadsafeFunctionCallJsBackData {
        data,
        call_variant: ThreadsafeFunctionCallVariant::Direct,
        callback: Box::new(|_d: Result<Return>, _| Ok(())),
      }),
      mode,
    )
    .into()
  }

  /// Call the ThreadsafeFunction, and handle the return value with a callback
  pub fn call_with_return_value<F: 'static + Send + FnOnce(Result<Return>, Env) -> Result<()>>(
    &self,
    value: Result<T, ErrorStatus>,
    mode: ThreadsafeFunctionCallMode,
    cb: F,
  ) -> Status {
    call_threadsafe_function_with_owned_data(
      &self.handle,
      value.map(|data| ThreadsafeFunctionCallJsBackData {
        data,
        call_variant: ThreadsafeFunctionCallVariant::WithCallback,
        callback: Box::new(move |d: Result<Return>, env: Env| cb(d, env)),
      }),
      mode,
    )
    .into()
  }

  /// Call the ThreadsafeFunction, and handle the return value with in `async` way
  pub async fn call_async(&self, value: Result<T, ErrorStatus>) -> Result<Return>
  where
    Return: Send,
  {
    let (sender, receiver) = channel::<Result<Return>>();

    check_status!(
      call_threadsafe_function_with_owned_data(
        &self.handle,
        value.map(|data| ThreadsafeFunctionCallJsBackData {
          data,
          call_variant: ThreadsafeFunctionCallVariant::WithCallback,
          callback: Box::new(move |d: Result<Return>, _| {
            sender
              .send(d)
              // The only reason for send to return Err is if the receiver isn't listening
              // Not hiding the error would result in a napi_fatal_error call, it's safe to ignore it instead.
              .or(Ok(()))
          }),
        }),
        ThreadsafeFunctionCallMode::NonBlocking,
      ),
      "Threadsafe function call_async failed"
    )?;
    receive_call_async_result(receiver).await
  }

  /// Call the ThreadsafeFunction the same way `call_async` does, with explicit
  /// "catch the JavaScript throw" semantics.
  ///
  /// Provided so callers can use the same method name regardless of the `CalleeHandled` value.
  pub async fn call_async_catch(&self, value: Result<T, ErrorStatus>) -> Result<Return>
  where
    Return: Send,
  {
    self.call_async(value).await
  }
}

impl<
    T: 'static + Send,
    Return: FromNapiValue,
    CallJsBackArgs: 'static + JsValuesTupleIntoVec,
    ErrorStatus: AsRef<str> + From<Status>,
    const Weak: bool,
    const MaxQueueSize: usize,
  > ThreadsafeFunction<T, Return, CallJsBackArgs, ErrorStatus, false, { Weak }, { MaxQueueSize }>
{
  /// See [napi_call_threadsafe_function](https://nodejs.org/api/n-api.html#n_api_napi_call_threadsafe_function)
  /// for more information.
  pub fn call(&self, value: T, mode: ThreadsafeFunctionCallMode) -> Status {
    call_threadsafe_function_with_owned_data(
      &self.handle,
      ThreadsafeFunctionCallJsBackData {
        data: value,
        call_variant: ThreadsafeFunctionCallVariant::Direct,
        callback: Box::new(|_d: Result<Return>, _: Env| Ok(())),
      },
      mode,
    )
    .into()
  }

  #[cfg(all(
    feature = "__internal_test_tsfn_blocking_state",
    target_family = "wasm"
  ))]
  #[doc(hidden)]
  pub fn __test_call_bounded_blocking<BeforeNative: FnOnce(), AfterNative: FnOnce(Status)>(
    &self,
    value: T,
    before_native: BeforeNative,
    after_native: AfterNative,
  ) -> Status {
    call_blocking_threadsafe_function_with_owned_data(
      &self.handle,
      ThreadsafeFunctionCallJsBackData {
        data: value,
        call_variant: ThreadsafeFunctionCallVariant::Direct,
        callback: Box::new(|_d: Result<Return>, _: Env| Ok(())),
      },
      before_native,
      |status| after_native(status.into()),
    )
    .into()
  }

  /// Call the ThreadsafeFunction, and handle the return value with a callback
  pub fn call_with_return_value<F: 'static + Send + FnOnce(Result<Return>, Env) -> Result<()>>(
    &self,
    value: T,
    mode: ThreadsafeFunctionCallMode,
    cb: F,
  ) -> Status {
    call_threadsafe_function_with_owned_data(
      &self.handle,
      ThreadsafeFunctionCallJsBackData {
        data: value,
        call_variant: ThreadsafeFunctionCallVariant::WithCallback,
        callback: Box::new(cb),
      },
      mode,
    )
    .into()
  }

  /// Call the ThreadsafeFunction in an `async` way and return the JavaScript
  /// callback's resolved value.
  ///
  /// **Warning:** if the JavaScript callback throws, this method will route
  /// the captured exception through `napi_fatal_exception`, which terminates
  /// the host process. Use [`call_async_catch`](Self::call_async_catch)
  /// if you need to handle JavaScript-thrown errors as `Err(napi::Error)`.
  pub async fn call_async(&self, value: T) -> Result<Return>
  where
    Return: Send,
  {
    let (sender, receiver) = channel::<Return>();

    check_status!(call_threadsafe_function_with_owned_data(
      &self.handle,
      ThreadsafeFunctionCallJsBackData {
        data: value,
        call_variant: ThreadsafeFunctionCallVariant::WithCallback,
        callback: Box::new(move |d, _| {
          d.and_then(|d| {
            sender
              .send(d)
              // The only reason for send to return Err is if the receiver isn't listening
              // Not hiding the error would result in a napi_fatal_error call, it's safe to ignore it instead.
              .or(Ok(()))
          })
        }),
      },
      ThreadsafeFunctionCallMode::NonBlocking,
    ))?;

    receiver
      .await
      .map_err(|err| crate::Error::new(Status::GenericFailure, format!("{err}")))
  }

  /// Call the ThreadsafeFunction in an `async` way and catch JavaScript-thrown
  /// errors as `Err(napi::Error)` instead of crashing the host process.
  ///
  /// The returned `Err` carries `status == Status::PendingException` when it
  /// originated from a JS throw. The original JS exception object is preserved
  /// via `error.maybe_raw` (a `napi_ref`); callers that need to inspect the
  /// typed JS value can recover it via:
  ///
  /// ```ignore
  /// let js_value: Unknown = JsError::from(err).into_unknown(env);
  /// ```
  pub async fn call_async_catch(&self, value: T) -> Result<Return>
  where
    Return: Send,
  {
    let (sender, receiver) = channel::<Result<Return>>();

    check_status!(
      call_threadsafe_function_with_owned_data(
        &self.handle,
        ThreadsafeFunctionCallJsBackData {
          data: value,
          call_variant: ThreadsafeFunctionCallVariant::WithCallback,
          callback: Box::new(move |d: Result<Return>, _| {
            sender
              .send(d)
              // The only reason for send to return Err is if the receiver isn't listening
              // Not hiding the error would result in a napi_fatal_error call, it's safe to ignore it instead.
              .or(Ok(()))
          }),
        },
        ThreadsafeFunctionCallMode::NonBlocking,
      ),
      "Threadsafe function call_async_catch failed"
    )?;
    receive_call_async_result(receiver).await
  }
}

unsafe extern "C" fn thread_finalize_cb<T: 'static, V: 'static + JsValuesTupleIntoVec, R>(
  env: sys::napi_env,
  finalize_data: *mut c_void,
  finalize_hint: *mut c_void,
) where
  R: 'static + FnMut(ThreadsafeCallContext<T>) -> Result<V>,
{
  crate::bindgen_runtime::with_runtime_finalizer_guard(env, || {
    let context =
      unsafe { Box::<ThreadsafeFunctionFinalizeContext>::from_raw(finalize_data.cast()) };
    let state = &context.state;

    let mut begin_finalize_succeeded = false;
    crate::bindgen_runtime::catch_unwind_safely(|| {
      state.begin_finalize();
      begin_finalize_succeeded = true;
    });
    state.record_begin_finalize_result(begin_finalize_succeeded);

    let finalizer_result = state.run_finalizer();

    let callback = unsafe { Box::<R>::from_raw(finalize_hint.cast()) };
    let mut callback_dropped_normally = false;
    crate::bindgen_runtime::catch_unwind_safely(|| {
      drop(callback);
      callback_dropped_normally = true;
    });
    state.record_callback_drop_result(callback_dropped_normally);

    let mut cleanup_context_released = false;
    crate::bindgen_runtime::catch_unwind_safely(|| {
      cleanup_context_released = state.release_owner_cleanup_context(env);
    });

    let mut finish_finalize_succeeded = false;
    crate::bindgen_runtime::catch_unwind_safely(|| {
      state.finish_finalize();
      finish_finalize_succeeded = true;
    });

    let quiescence_proven = begin_finalize_succeeded
      && finish_finalize_succeeded
      && finalizer_result.proves_quiescence()
      && state.quiescence_proven()
      && state.owner_retired()
      && cleanup_context_released;
    if !quiescence_proven {
      retain_threadsafe_function_ownership_for_unload_safety();
    }
    drop(context);
  });
}

unsafe fn take_call_js_back_data<
  T: 'static,
  Return: FromNapiValue,
  ErrorStatus: AsRef<str> + From<Status>,
  const CalleeHandled: bool,
>(
  data: *mut c_void,
) -> ThreadsafeFunctionCallResult<T, Return, ErrorStatus> {
  if CalleeHandled {
    let ThreadsafeFunctionCallData {
      handle,
      data,
      payload_guard,
    } = unsafe {
      *Box::<
        ThreadsafeFunctionCallData<
          Result<ThreadsafeFunctionCallJsBackData<T, Return>, ErrorStatus>,
        >,
      >::from_raw(data.cast())
    };
    (handle.upgrade(), data, payload_guard)
  } else {
    let ThreadsafeFunctionCallData {
      handle,
      data,
      payload_guard,
    } = unsafe {
      *Box::<ThreadsafeFunctionCallData<ThreadsafeFunctionCallJsBackData<T, Return>>>::from_raw(
        data.cast(),
      )
    };
    (handle.upgrade(), Ok(data), payload_guard)
  }
}

unsafe extern "C" fn call_js_cb<
  T: 'static,
  Return: FromNapiValue,
  V: 'static + JsValuesTupleIntoVec,
  ErrorStatus: AsRef<str> + From<Status>,
  R,
  const CalleeHandled: bool,
>(
  raw_env: sys::napi_env,
  js_callback: sys::napi_value,
  context: *mut c_void,
  data: *mut c_void,
) where
  R: 'static + FnMut(ThreadsafeCallContext<T>) -> Result<V>,
{
  let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| unsafe {
    call_js_cb_inner::<T, Return, V, ErrorStatus, R, CalleeHandled>(
      raw_env,
      js_callback,
      context,
      data,
    );
  }));
  if let Err(reason) = result {
    if raw_env.is_null() || js_callback.is_null() {
      crate::bindgen_runtime::catch_unwind_safely(|| drop(reason));
      return;
    }
    crate::bindgen_runtime::catch_unwind_safely(|| {
      let error = crate::bindgen_runtime::panic_to_error(reason);
      unsafe {
        sys::napi_fatal_exception(raw_env, JsError::from(error).into_value(raw_env));
      }
    });
  }
}

unsafe fn call_js_cb_inner<
  T: 'static,
  Return: FromNapiValue,
  V: 'static + JsValuesTupleIntoVec,
  ErrorStatus: AsRef<str> + From<Status>,
  R,
  const CalleeHandled: bool,
>(
  raw_env: sys::napi_env,
  js_callback: sys::napi_value,
  context: *mut c_void,
  data: *mut c_void,
) where
  R: 'static + FnMut(ThreadsafeCallContext<T>) -> Result<V>,
{
  if data.is_null() {
    return;
  }
  let (handle, val, payload_guard) =
    unsafe { take_call_js_back_data::<T, Return, ErrorStatus, CalleeHandled>(data) };

  // Node drains queued TSFN calls with a null env/callback during teardown.
  // Mark closing before destroying the payload: newer Node versions can
  // detach the drain queue before the native TSFN reports closing, and user
  // Drop implementations may reenter this handle.
  if raw_env.is_null() || js_callback.is_null() {
    if let Some(handle) = handle {
      let _lifecycle_guard = handle.write_lifecycle();
      handle.mark_closing();
    }
    crate::bindgen_runtime::catch_unwind_safely(|| drop(val));
    drop(payload_guard);
    return;
  }

  let callback: &mut R = unsafe { Box::leak(Box::from_raw(context.cast())) };

  let mut recv = ptr::null_mut();
  unsafe { sys::napi_get_undefined(raw_env, &mut recv) };

  let ret = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
    val.and_then(|v| {
      (callback)(ThreadsafeCallContext {
        env: Env::from_raw(raw_env),
        value: v.data,
      })
      .and_then(|ret| Ok((ret.into_vec(raw_env)?, v.call_variant, v.callback)))
      .map_err(|err| Error::new(err.status.into(), err.reason.clone()))
    })
  }))
  .map_err(|reason| {
    let error = crate::bindgen_runtime::panic_to_error(reason);
    Error::new(ErrorStatus::from(error.status), error.reason)
  })
  .and_then(|result| result);

  // Follow async callback conventions: https://nodejs.org/en/knowledge/errors/what-are-the-error-conventions/
  // Check if the Result is okay, if so, pass a null as the first (error) argument automatically.
  // If the Result is an error, pass that as the first argument.
  let status = match ret {
    Ok((values, call_variant, callback)) => {
      let args: Vec<sys::napi_value> = if CalleeHandled {
        let mut js_null = ptr::null_mut();
        unsafe { sys::napi_get_null(raw_env, &mut js_null) };
        core::iter::once(js_null).chain(values).collect()
      } else {
        values
      };
      let mut return_value = ptr::null_mut();
      #[allow(unused_mut)]
      let mut status = sys::napi_call_function(
        raw_env,
        recv,
        js_callback,
        args.len(),
        args.as_ptr(),
        &mut return_value,
      );
      if let ThreadsafeFunctionCallVariant::WithCallback = call_variant {
        // throw Error in JavaScript callback
        let callback_arg = if status == sys::Status::napi_pending_exception {
          let mut exception = ptr::null_mut();
          unsafe { sys::napi_get_and_clear_last_exception(raw_env, &mut exception) };
          let raw_status = status;
          // Referencing the exception object is not allowed on wasm targets: the
          // returned `Error` is sent to the calling thread, and un-referencing it
          // there crashes because the reference belongs to the JS thread's env.
          // The message and stack trace are still captured in `reason` below.
          // See the `From<Unknown> for Error` impls in `error.rs` (#2975).
          #[cfg(target_family = "wasm")]
          let maybe_ref = {
            status = sys::Status::napi_ok;
            None
          };
          #[cfg(not(target_family = "wasm"))]
          let maybe_ref = {
            let mut error_reference = ptr::null_mut();
            status =
              unsafe { sys::napi_create_reference(raw_env, exception, 1, &mut error_reference) };
            // Only own a reference when creation actually succeeded; on failure
            // `error_reference` stays null, so keep `maybe_ref: None` (the message
            // and stack are still captured in `reason` below) rather than wrapping
            // a null ref that `ErrorRef::drop` would blindly release — mirrors the
            // early guard in `From<Unknown> for Error`. `call_js_cb` runs on the
            // env's JS thread, so `ErrorRef::new` captures the owning env's
            // custom-GC handle for the (typically off-thread) release.
            if status == sys::Status::napi_ok {
              Some(std::sync::Arc::new(crate::error::ErrorRef::new(
                error_reference,
                raw_env,
              )))
            } else {
              None
            }
          };

          get_error_message_and_stack_trace(raw_env, exception).and_then(|reason| {
            Err(Error {
              maybe_ref,
              // SAFETY: `raw_env` and `exception` are valid pointers obtained from
              // `napi_get_and_clear_last_exception` above, which guarantees they are
              // non-null and live for the duration of this callback.
              cause: extract_error_cause(unsafe {
                Unknown::from_raw_unchecked(raw_env, exception)
              })
              .unwrap_or(None),
              status: Status::from(raw_status),
              reason,
            })
          })
        } else if status == sys::Status::napi_ok {
          unsafe { Return::from_napi_value(raw_env, return_value) }
        } else {
          Err(Error::new(
            Status::from(status),
            "Call JavaScript callback failed in threadsafe function",
          ))
        };
        let callback_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
          callback(callback_arg, Env::from_raw(raw_env))
        }))
        .map_err(crate::bindgen_runtime::panic_to_error)
        .and_then(|result| result);
        if let Err(err) = callback_result {
          unsafe { sys::napi_fatal_exception(raw_env, JsError::from(err).into_value(raw_env)) };
        }
      }
      status
    }
    Err(e) if !CalleeHandled => unsafe {
      sys::napi_fatal_exception(raw_env, JsError::from(e).into_value(raw_env))
    },
    Err(e) => unsafe {
      sys::napi_call_function(
        raw_env,
        recv,
        js_callback,
        1,
        [JsError::from(e).into_value(raw_env)].as_mut_ptr(),
        ptr::null_mut(),
      )
    },
  };
  handle_call_js_cb_status(status, raw_env);
  drop(payload_guard);
}

fn handle_call_js_cb_status(status: sys::napi_status, raw_env: sys::napi_env) {
  if status == sys::Status::napi_ok {
    return;
  }
  if status == sys::Status::napi_pending_exception {
    let mut error_result = ptr::null_mut();
    if unsafe { sys::napi_get_and_clear_last_exception(raw_env, &mut error_result) }
      != sys::Status::napi_ok
    {
      return;
    }

    // When shutting down, napi_fatal_exception sometimes returns another exception
    unsafe { sys::napi_fatal_exception(raw_env, error_result) };
  } else {
    // During environment shutdown (e.g. Ctrl+C in a worker thread), any NAPI call
    // can fail. Bail out gracefully instead of panicking if we can't construct the
    // error object — there's nothing useful we can do in a half-torn-down env.
    let error_code: Status = status.into();
    let mut error_code_value = ptr::null_mut();
    if unsafe {
      sys::napi_create_string_utf8(
        raw_env,
        error_code.as_ref().as_ptr().cast(),
        error_code.as_ref().len() as isize,
        &mut error_code_value,
      )
    } != sys::Status::napi_ok
    {
      return;
    }
    const ERROR_MSG: &str = "Call JavaScript callback failed in threadsafe function";
    let mut error_msg_value = ptr::null_mut();
    if unsafe {
      sys::napi_create_string_utf8(
        raw_env,
        ERROR_MSG.as_ptr().cast(),
        ERROR_MSG.len() as isize,
        &mut error_msg_value,
      )
    } != sys::Status::napi_ok
    {
      return;
    }
    let mut error_value = ptr::null_mut();
    if unsafe {
      sys::napi_create_error(raw_env, error_code_value, error_msg_value, &mut error_value)
    } != sys::Status::napi_ok
    {
      return;
    }
    // When shutting down, napi_fatal_exception sometimes returns another exception
    unsafe { sys::napi_fatal_exception(raw_env, error_value) };
  }
}

/// This is a placeholder type that is used to indicate that the return value of a threadsafe function is unknown.
/// Use this type when you don't care about the return value of a threadsafe function.
///
/// And you can't get the value of it as well because it's just a placeholder.
pub struct UnknownReturnValue;

impl TypeName for UnknownReturnValue {
  fn type_name() -> &'static str {
    "UnknownReturnValue"
  }

  fn value_type() -> crate::ValueType {
    crate::ValueType::Unknown
  }
}

impl ValidateNapiValue for UnknownReturnValue {}

impl FromNapiValue for UnknownReturnValue {
  unsafe fn from_napi_value(_env: sys::napi_env, _napi_val: sys::napi_value) -> Result<Self> {
    Ok(UnknownReturnValue)
  }
}

#[cfg(test)]
mod tests {
  use std::{
    ptr,
    sync::{atomic::AtomicUsize, mpsc, Arc},
  };

  use super::{
    native_enqueue_mode, should_wait_for_blocking_call, Ordering, ThreadsafeFunctionCallMode,
    ThreadsafeFunctionFinalizeResult, ThreadsafeFunctionHandle,
  };

  #[test]
  fn unlimited_blocking_calls_use_the_nonblocking_native_enqueue_path() {
    assert_eq!(
      native_enqueue_mode(ThreadsafeFunctionCallMode::Blocking, 0),
      ThreadsafeFunctionCallMode::NonBlocking
    );
    assert_eq!(
      native_enqueue_mode(ThreadsafeFunctionCallMode::Blocking, 1),
      ThreadsafeFunctionCallMode::Blocking
    );
    assert_eq!(
      native_enqueue_mode(ThreadsafeFunctionCallMode::NonBlocking, 0),
      ThreadsafeFunctionCallMode::NonBlocking
    );
    assert_eq!(
      native_enqueue_mode(ThreadsafeFunctionCallMode::NonBlocking, 1),
      ThreadsafeFunctionCallMode::NonBlocking
    );
  }

  #[test]
  fn threaded_wasi_owner_policy_skips_blocking_call_waits() {
    assert!(!should_wait_for_blocking_call(true));
    assert!(should_wait_for_blocking_call(false));
  }

  #[test]
  fn non_owner_waiter_observes_atomic_blocking_call_completion() {
    let handle = ThreadsafeFunctionHandle::null_with_max_queue_size(1, ptr::null_mut());
    let blocking_call = handle.start_blocking_call();
    assert_ne!(handle.state.blocking_active.load(Ordering::Acquire), 0);

    let state = Arc::clone(&handle.state);
    let (entered_tx, entered_rx) = mpsc::channel();
    let (completed_tx, completed_rx) = mpsc::channel();
    let waiter = std::thread::spawn(move || {
      entered_tx.send(()).unwrap();
      state.wait_for_blocking_call_if_allowed();
      completed_tx.send(()).unwrap();
    });
    entered_rx.recv().unwrap();

    assert_ne!(handle.state.blocking_active.load(Ordering::Acquire), 0);
    assert_eq!(completed_rx.try_recv(), Err(mpsc::TryRecvError::Empty));

    drop(blocking_call);
    completed_rx.recv().unwrap();
    waiter.join().unwrap();
  }

  #[test]
  fn finalization_observes_a_callback_published_by_concurrent_registration() {
    let handle = ThreadsafeFunctionHandle::null_with_max_queue_size(0, ptr::null_mut());
    let state = Arc::clone(&handle.state);
    let callback_calls = Arc::new(AtomicUsize::new(0));
    let registered_callback_calls = Arc::clone(&callback_calls);
    let (published_tx, published_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel();

    let registration = std::thread::spawn(move || {
      state.register_finalizer_with_publish_hook(
        Box::new(move || {
          registered_callback_calls.fetch_add(1, Ordering::SeqCst);
        }),
        move || {
          published_tx.send(()).unwrap();
          release_rx.recv().unwrap();
        },
      )
    });
    published_rx
      .recv()
      .expect("registration must publish before returning");

    assert_eq!(
      handle.state.run_finalizer(),
      ThreadsafeFunctionFinalizeResult::ReturnedNormally
    );
    release_tx.send(()).unwrap();
    registration
      .join()
      .unwrap()
      .expect("a callback taken by finalization is successfully registered");
    assert_eq!(callback_calls.load(Ordering::SeqCst), 1);
    assert_eq!(
      handle.state.run_finalizer(),
      ThreadsafeFunctionFinalizeResult::AlreadyFinalized
    );
    assert_eq!(callback_calls.load(Ordering::SeqCst), 1);
  }
}
