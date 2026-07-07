use std::cell::RefCell;
use std::collections::{hash_map::Entry, HashMap, HashSet};
use std::os::raw::c_void;
use std::ptr;
use std::{
  marker::PhantomData,
  sync::{
    atomic::{AtomicBool, AtomicPtr, AtomicUsize, Ordering},
    Arc, Mutex, RwLock,
  },
  thread::{self, ThreadId},
};

#[cfg(feature = "deferred_trace")]
use crate::{bindgen_runtime::JsObjectValue, JsValue};
use crate::{
  bindgen_runtime::{Object, ToNapiValue},
  check_status, sys, Env, Error, Result,
};

#[cfg(feature = "deferred_trace")]
/// A javascript error which keeps a stack trace
/// to the original caller in an asynchronous context.
/// This is required as the stack trace is lost when
/// an error is created in a different thread.
///
/// See this issue for more details:
/// https://github.com/nodejs/node-addon-api/issues/595
#[repr(transparent)]
#[derive(Clone)]
struct DeferredTrace(sys::napi_ref);

#[cfg(feature = "deferred_trace")]
impl DeferredTrace {
  fn new(raw_env: sys::napi_env) -> Result<Self> {
    let env = Env::from_raw(raw_env);
    let reason = env.create_string("none")?;

    let mut js_error = ptr::null_mut();
    check_status!(
      unsafe { sys::napi_create_error(raw_env, ptr::null_mut(), reason.raw(), &mut js_error) },
      "Create error in DeferredTrace failed"
    )?;

    let mut result = ptr::null_mut();
    check_status!(
      unsafe { sys::napi_create_reference(raw_env, js_error, 1, &mut result) },
      "Create reference in DeferredTrace failed"
    )?;

    Ok(Self(result))
  }

  fn into_rejected(self, raw_env: sys::napi_env, err: Error) -> Result<sys::napi_value> {
    let env = Env::from_raw(raw_env);
    let mut raw = ptr::null_mut();
    check_status!(
      unsafe { sys::napi_get_reference_value(raw_env, self.0, &mut raw) },
      "Failed to get referenced value in DeferredTrace"
    )?;

    // Reuse the original JS rejection value when it is safe to read on this thread;
    // the shared `napi_ref` is released when `err` drops at the end of the call.
    let err_value = if let Some(err_raw_value) = unsafe { err.referenced_value(raw_env) } {
      Ok(err_raw_value)
    } else {
      let mut obj = Object::from_raw(raw_env, raw);
      obj.set_named_property("message", &err.reason)?;
      obj.set_named_property(
        "code",
        env.create_string_from_std(format!("{}", err.status))?,
      )?;
      Ok(raw)
    };
    check_status!(
      unsafe { sys::napi_delete_reference(raw_env, self.0) },
      "Failed to get referenced value in DeferredTrace"
    )?;
    err_value
  }
}

type FinalizeCallbackId = usize;
type EnvId = usize;
type FinalizeCallback = Box<dyn FnOnce(sys::napi_env)>;
type FinalizeCallbackIdentity = Arc<()>;

struct FinalizeCallbackEntry {
  #[cfg_attr(feature = "noop", allow(dead_code))]
  env: EnvId,
  identity: FinalizeCallbackIdentity,
  callback: Option<FinalizeCallback>,
}

impl Drop for FinalizeCallbackEntry {
  fn drop(&mut self) {
    if let Some(callback) = self.callback.take() {
      crate::bindgen_runtime::catch_unwind_safely(|| drop(callback));
    }
  }
}

thread_local! {
  static FINALIZE_CALLBACKS: RefCell<HashMap<FinalizeCallbackId, FinalizeCallbackEntry>> =
    RefCell::new(HashMap::new());
  static FINALIZE_CLEANUP_ENVS: RefCell<HashSet<EnvId>> = RefCell::new(HashSet::new());
  static FINALIZE_CLOSING_ENVS: RefCell<HashSet<EnvId>> = RefCell::new(HashSet::new());
  static FINALIZE_CLEANUP_COMPLETION_ENVS: RefCell<HashSet<EnvId>> =
    RefCell::new(HashSet::new());
}

static NEXT_FINALIZE_CALLBACK_ID: AtomicUsize = AtomicUsize::new(1);

struct FinalizeCallbackHandle {
  id: FinalizeCallbackId,
  identity: FinalizeCallbackIdentity,
}

impl FinalizeCallbackHandle {
  fn new(env: sys::napi_env, callback: FinalizeCallback) -> Self {
    let identity = Arc::new(());
    if FINALIZE_CLOSING_ENVS.with(|envs| envs.borrow().contains(&(env as EnvId))) {
      crate::bindgen_runtime::catch_unwind_safely(|| drop(callback));
      return Self { id: 0, identity };
    }
    let mut callback = Some(callback);
    let id = FINALIZE_CALLBACKS.with(|callbacks| loop {
      let id = NEXT_FINALIZE_CALLBACK_ID.fetch_add(1, Ordering::Relaxed);
      if id == 0 {
        continue;
      }
      if let Entry::Vacant(entry) = callbacks.borrow_mut().entry(id) {
        entry.insert(FinalizeCallbackEntry {
          env: env as EnvId,
          identity: Arc::clone(&identity),
          callback: callback.take(),
        });
        break id;
      }
    });
    Self { id, identity }
  }

  fn run(self, env: sys::napi_env) {
    let entry = FINALIZE_CALLBACKS
      .with(|callbacks| remove_finalize_callback(&mut callbacks.borrow_mut(), &self));
    if let Some(mut entry) = entry {
      if let Some(callback) = entry.callback.take() {
        crate::bindgen_runtime::catch_unwind_safely(|| callback(env));
      }
    }
  }
}

impl Drop for FinalizeCallbackHandle {
  fn drop(&mut self) {
    if let Ok(Some(entry)) = FINALIZE_CALLBACKS
      .try_with(|callbacks| remove_finalize_callback(&mut callbacks.borrow_mut(), self))
    {
      drop(entry);
    }
  }
}

fn remove_finalize_callback(
  callbacks: &mut HashMap<FinalizeCallbackId, FinalizeCallbackEntry>,
  handle: &FinalizeCallbackHandle,
) -> Option<FinalizeCallbackEntry> {
  match callbacks.entry(handle.id) {
    Entry::Occupied(entry) if Arc::ptr_eq(&entry.get().identity, &handle.identity) => {
      Some(entry.remove())
    }
    _ => None,
  }
}

#[derive(Default)]
struct DeferredFinalizeCallbackSlot {
  callback: Option<FinalizeCallbackHandle>,
  closed: bool,
}

type SharedFinalizeCallback = Arc<Mutex<DeferredFinalizeCallbackSlot>>;

#[derive(Clone, Default)]
struct DeferredSettlement(Arc<AtomicBool>);

impl DeferredSettlement {
  fn try_claim(&self) -> bool {
    !self.0.swap(true, Ordering::AcqRel)
  }
}

#[cfg_attr(
  all(target_family = "wasm", feature = "noop"),
  allow(
    dead_code,
    reason = "noop WASI builds cannot register env cleanup hooks"
  )
)]
struct DeferredTsfnOwnerCleanupContext {
  state: Arc<DeferredTsfnState>,
}

struct DeferredTsfnState {
  raw: AtomicPtr<sys::napi_threadsafe_function__>,
  owner_cleanup_context: AtomicPtr<DeferredTsfnOwnerCleanupContext>,
  owner_retired: AtomicBool,
  closing: AtomicBool,
  rust_handle_count: AtomicUsize,
  outstanding_payloads: AtomicUsize,
  lifecycle: RwLock<()>,
}

impl DeferredTsfnState {
  fn new() -> Self {
    Self {
      raw: AtomicPtr::new(ptr::null_mut()),
      owner_cleanup_context: AtomicPtr::new(ptr::null_mut()),
      owner_retired: AtomicBool::new(false),
      closing: AtomicBool::new(false),
      rust_handle_count: AtomicUsize::new(0),
      outstanding_payloads: AtomicUsize::new(0),
      lifecycle: RwLock::new(()),
    }
  }

  fn set_raw(&self, raw: sys::napi_threadsafe_function) {
    let _lifecycle = self
      .lifecycle
      .write()
      .unwrap_or_else(std::sync::PoisonError::into_inner);
    self.raw.store(raw, Ordering::Release);
  }

  fn raw(&self) -> sys::napi_threadsafe_function {
    self.raw.load(Ordering::Acquire)
  }

  fn increment_rust_handle_count(&self) {
    if self
      .rust_handle_count
      .fetch_update(Ordering::AcqRel, Ordering::Acquire, |count| {
        count.checked_add(1)
      })
      .is_err()
    {
      std::process::abort();
    }
  }

  fn decrement_rust_handle_count(&self) {
    if self
      .rust_handle_count
      .fetch_update(Ordering::AcqRel, Ordering::Acquire, |count| {
        count.checked_sub(1)
      })
      .is_err()
    {
      std::process::abort();
    }
  }

  fn increment_outstanding_payloads(&self) {
    if self
      .outstanding_payloads
      .fetch_update(Ordering::AcqRel, Ordering::Acquire, |count| {
        count.checked_add(1)
      })
      .is_err()
    {
      std::process::abort();
    }
  }

  fn decrement_outstanding_payloads(&self) {
    if self
      .outstanding_payloads
      .fetch_update(Ordering::AcqRel, Ordering::Acquire, |count| {
        count.checked_sub(1)
      })
      .is_err()
    {
      std::process::abort();
    }
  }

  fn rust_activity_quiescent(&self) -> bool {
    self.rust_handle_count.load(Ordering::Acquire) == 0
      && self.outstanding_payloads.load(Ordering::Acquire) == 0
  }

  fn acquire_call_slot_locked(
    &self,
    raw: sys::napi_threadsafe_function,
  ) -> std::result::Result<DeferredTsfnCallSlot<'_>, sys::napi_status> {
    if self.owner_retired.load(Ordering::Acquire)
      || self.closing.load(Ordering::Acquire)
      || raw.is_null()
    {
      return Err(sys::Status::napi_closing);
    }
    let status = unsafe { sys::napi_acquire_threadsafe_function(raw) };
    if status == sys::Status::napi_ok {
      Ok(DeferredTsfnCallSlot {
        state: self,
        raw,
        acquired: true,
      })
    } else {
      if status == sys::Status::napi_closing {
        self.closing.store(true, Ordering::Release);
      }
      Err(status)
    }
  }

  fn call(&self, data: *mut c_void) -> sys::napi_status {
    let _lifecycle = self
      .lifecycle
      .read()
      .unwrap_or_else(std::sync::PoisonError::into_inner);
    let raw = self.raw();
    let mut call_slot = match self.acquire_call_slot_locked(raw) {
      Ok(call_slot) => call_slot,
      Err(status) => return status,
    };
    let status = unsafe {
      sys::napi_call_threadsafe_function(raw, data, sys::ThreadsafeFunctionCallMode::blocking)
    };
    call_slot.finish(status);
    status
  }

  fn retire_owner(&self, mode: sys::napi_threadsafe_function_release_mode) -> sys::napi_status {
    let _lifecycle = self
      .lifecycle
      .write()
      .unwrap_or_else(std::sync::PoisonError::into_inner);
    if self.owner_retired.load(Ordering::Acquire) {
      return sys::Status::napi_ok;
    }
    let raw = self.raw();
    if raw.is_null() {
      self.owner_retired.store(true, Ordering::Release);
      return sys::Status::napi_ok;
    }
    if mode == sys::ThreadsafeFunctionReleaseMode::abort {
      self.closing.store(true, Ordering::Release);
    }
    let status = unsafe { sys::napi_release_threadsafe_function(raw, mode) };
    if status == sys::Status::napi_ok {
      self.owner_retired.store(true, Ordering::Release);
      self.raw.store(ptr::null_mut(), Ordering::Release);
    }
    status
  }

  fn retire_owner_for_env_cleanup(&self) -> sys::napi_status {
    let _lifecycle = self
      .lifecycle
      .write()
      .unwrap_or_else(std::sync::PoisonError::into_inner);
    self.closing.store(true, Ordering::Release);
    if self.owner_retired.load(Ordering::Acquire) {
      self.raw.store(ptr::null_mut(), Ordering::Release);
      return sys::Status::napi_ok;
    }
    let raw = self.raw();
    let status = if raw.is_null() {
      sys::Status::napi_ok
    } else {
      unsafe {
        sys::napi_release_threadsafe_function(raw, sys::ThreadsafeFunctionReleaseMode::abort)
      }
    };
    // Environment teardown owns native cleanup from this point forward. Even
    // if abort failed, surviving Rust handles must never retry N-API.
    self.owner_retired.store(true, Ordering::Release);
    self.raw.store(ptr::null_mut(), Ordering::Release);
    status
  }

  fn begin_finalize(&self) -> bool {
    let _lifecycle = self
      .lifecycle
      .write()
      .unwrap_or_else(std::sync::PoisonError::into_inner);
    self.closing.store(true, Ordering::Release);
    self.owner_retired.swap(true, Ordering::AcqRel)
  }

  fn finish_finalize(&self) {
    let _lifecycle = self
      .lifecycle
      .write()
      .unwrap_or_else(std::sync::PoisonError::into_inner);
    self.raw.store(ptr::null_mut(), Ordering::Release);
  }

  fn release_owner_cleanup_context(&self, env: sys::napi_env) -> bool {
    let context = self
      .owner_cleanup_context
      .swap(ptr::null_mut(), Ordering::AcqRel);
    if context.is_null() {
      return true;
    }
    if env.is_null() {
      self.owner_cleanup_context.store(context, Ordering::Release);
      return false;
    }
    let status = unsafe { remove_deferred_tsfn_owner_cleanup_hook(env, context) };
    if status == sys::Status::napi_ok {
      drop(unsafe { Box::from_raw(context) });
      true
    } else {
      self.owner_cleanup_context.store(context, Ordering::Release);
      false
    }
  }
}

struct DeferredTsfn {
  state: Arc<DeferredTsfnState>,
}

impl DeferredTsfn {
  fn new() -> Self {
    Self {
      state: Arc::new(DeferredTsfnState::new()),
    }
  }

  fn set_raw(&self, raw: sys::napi_threadsafe_function) {
    self.state.set_raw(raw);
  }

  fn call(&self, data: *mut c_void) -> sys::napi_status {
    self.state.call(data)
  }
}

impl Drop for DeferredTsfn {
  fn drop(&mut self) {
    let status = self
      .state
      .retire_owner(sys::ThreadsafeFunctionReleaseMode::abort);
    if status != sys::Status::napi_ok {
      retain_deferred_tsfn_ownership_for_unload_safety();
      if cfg!(debug_assertions) {
        eprintln!(
          "Abort unresolved JsDeferred ThreadsafeFunction failed: {}",
          crate::Status::from(status)
        );
      }
    }
  }
}

struct DeferredTsfnCallSlot<'a> {
  state: &'a DeferredTsfnState,
  raw: sys::napi_threadsafe_function,
  acquired: bool,
}

impl DeferredTsfnCallSlot<'_> {
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
      // A closing Push consumes this call's acquired slot. The initial owner
      // remains independent and is retired by settlement, Drop, or env cleanup.
      self.acquired = false;
      self.state.closing.store(true, Ordering::Release);
    } else {
      self.release_locked();
    }
  }
}

impl Drop for DeferredTsfnCallSlot<'_> {
  fn drop(&mut self) {
    self.release_locked();
  }
}

struct DeferredTsfnHandleLease {
  state: Arc<DeferredTsfnState>,
}

impl DeferredTsfnHandleLease {
  fn new(state: Arc<DeferredTsfnState>) -> Self {
    state.increment_rust_handle_count();
    Self { state }
  }
}

impl Drop for DeferredTsfnHandleLease {
  fn drop(&mut self) {
    self.state.decrement_rust_handle_count();
  }
}

struct DeferredTsfnPayloadGuard {
  state: Arc<DeferredTsfnState>,
}

impl DeferredTsfnPayloadGuard {
  fn new(state: Arc<DeferredTsfnState>) -> Self {
    state.increment_outstanding_payloads();
    Self { state }
  }
}

impl Drop for DeferredTsfnPayloadGuard {
  fn drop(&mut self) {
    self.state.decrement_outstanding_payloads();
  }
}

unsafe fn add_deferred_tsfn_owner_cleanup_hook(
  env: sys::napi_env,
  context: *mut DeferredTsfnOwnerCleanupContext,
) -> sys::napi_status {
  #[cfg(not(target_family = "wasm"))]
  {
    unsafe {
      sys::napi_add_env_cleanup_hook(env, Some(deferred_tsfn_owner_cleanup), context.cast())
    }
  }
  #[cfg(all(target_family = "wasm", not(feature = "noop")))]
  {
    unsafe {
      crate::napi_add_env_cleanup_hook(env, Some(deferred_tsfn_owner_cleanup), context.cast())
    }
  }
  #[cfg(all(target_family = "wasm", feature = "noop"))]
  {
    let _ = (env, context);
    sys::Status::napi_generic_failure
  }
}

unsafe fn remove_deferred_tsfn_owner_cleanup_hook(
  env: sys::napi_env,
  context: *mut DeferredTsfnOwnerCleanupContext,
) -> sys::napi_status {
  #[cfg(not(target_family = "wasm"))]
  {
    unsafe {
      sys::napi_remove_env_cleanup_hook(env, Some(deferred_tsfn_owner_cleanup), context.cast())
    }
  }
  #[cfg(all(target_family = "wasm", not(feature = "noop")))]
  {
    unsafe {
      crate::napi_remove_env_cleanup_hook(env, Some(deferred_tsfn_owner_cleanup), context.cast())
    }
  }
  #[cfg(all(target_family = "wasm", feature = "noop"))]
  {
    let _ = (env, context);
    sys::Status::napi_generic_failure
  }
}

fn register_deferred_tsfn_owner_cleanup(env: sys::napi_env, tsfn: &Arc<DeferredTsfn>) {
  let context = Box::into_raw(Box::new(DeferredTsfnOwnerCleanupContext {
    state: Arc::clone(&tsfn.state),
  }));
  let status = unsafe { add_deferred_tsfn_owner_cleanup_hook(env, context) };
  if status == sys::Status::napi_ok {
    tsfn
      .state
      .owner_cleanup_context
      .store(context, Ordering::Release);
  } else {
    drop(unsafe { Box::from_raw(context) });
    retain_deferred_tsfn_ownership_for_unload_safety();
  }
}

#[cfg_attr(
  all(target_family = "wasm", feature = "noop"),
  allow(
    dead_code,
    reason = "noop WASI builds cannot register env cleanup hooks"
  )
)]
unsafe extern "C" fn deferred_tsfn_owner_cleanup(data: *mut c_void) {
  if data.is_null() {
    return;
  }
  let context = unsafe { Box::<DeferredTsfnOwnerCleanupContext>::from_raw(data.cast()) };
  let state = &context.state;
  state
    .owner_cleanup_context
    .store(ptr::null_mut(), Ordering::Release);
  let status = state.retire_owner_for_env_cleanup();
  if status != sys::Status::napi_ok || !state.rust_activity_quiescent() {
    retain_deferred_tsfn_ownership_for_unload_safety();
  }
}

fn retain_deferred_tsfn_ownership_for_unload_safety() {
  #[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
  crate::bindgen_runtime::retain_current_module_for_unload_safety();
}

unsafe extern "C" fn finalize_deferred_tsfn(
  env: sys::napi_env,
  finalize_data: *mut c_void,
  _finalize_hint: *mut c_void,
) {
  if finalize_data.is_null() {
    return;
  }
  let state = unsafe { Box::<Arc<DeferredTsfnState>>::from_raw(finalize_data.cast()) };
  let owner_was_retired = state.begin_finalize();
  let cleanup_context_released = state.release_owner_cleanup_context(env);
  state.finish_finalize();
  if !owner_was_retired || !cleanup_context_released || !state.rust_activity_quiescent() {
    retain_deferred_tsfn_ownership_for_unload_safety();
  }
}

#[cfg(not(feature = "noop"))]
fn ensure_finalize_cleanup_hook(env: sys::napi_env) -> Result<()> {
  if FINALIZE_CLEANUP_ENVS.with(|envs| envs.borrow().contains(&(env as EnvId))) {
    return Ok(());
  }
  #[cfg(not(target_family = "wasm"))]
  let status =
    unsafe { sys::napi_add_env_cleanup_hook(env, Some(finalize_callback_env_cleanup), env.cast()) };
  #[cfg(target_family = "wasm")]
  let status = unsafe {
    crate::napi_add_env_cleanup_hook(env, Some(finalize_callback_env_cleanup), env.cast())
  };
  check_status!(status, "Add JsDeferred environment cleanup hook failed")?;
  let completion_pending =
    FINALIZE_CLEANUP_COMPLETION_ENVS.with(|envs| envs.borrow().contains(&(env as EnvId)));
  if !completion_pending {
    FINALIZE_CLOSING_ENVS.with(|envs| {
      envs.borrow_mut().remove(&(env as EnvId));
    });
  }
  FINALIZE_CLEANUP_ENVS.with(|envs| {
    envs.borrow_mut().insert(env as EnvId);
  });
  Ok(())
}

#[cfg(feature = "noop")]
fn ensure_finalize_cleanup_hook(_env: sys::napi_env) -> Result<()> {
  Ok(())
}

#[cfg(not(feature = "noop"))]
unsafe extern "C" fn finalize_callback_env_cleanup(data: *mut c_void) {
  let env = data.cast();
  crate::bindgen_runtime::with_runtime_teardown_guard(|| {
    crate::bindgen_runtime::catch_unwind_safely(|| {
      #[cfg(any(feature = "async-runtime", feature = "tokio_rt"))]
      crate::tokio_runtime::cancel_and_wait_runtime_env_tasks(env);
      clear_finalize_callbacks_for_env(env);
      FINALIZE_CLEANUP_ENVS.with(|envs| {
        envs.borrow_mut().remove(&(env as EnvId));
      });
      schedule_finalize_cleanup_completion(env);
    });
  });
}

#[cfg(not(feature = "noop"))]
fn schedule_finalize_cleanup_completion(env: sys::napi_env) {
  let should_register = FINALIZE_CLEANUP_COMPLETION_ENVS.with(|envs| {
    let mut envs = envs.borrow_mut();
    if envs.contains(&(env as EnvId)) {
      false
    } else {
      envs.insert(env as EnvId);
      true
    }
  });
  if !should_register {
    return;
  }

  #[cfg(not(target_family = "wasm"))]
  let status = unsafe {
    sys::napi_add_env_cleanup_hook(
      env,
      Some(finalize_callback_env_cleanup_complete),
      env.cast(),
    )
  };
  #[cfg(target_family = "wasm")]
  let status = unsafe {
    crate::napi_add_env_cleanup_hook(
      env,
      Some(finalize_callback_env_cleanup_complete),
      env.cast(),
    )
  };
  if status != sys::Status::napi_ok {
    FINALIZE_CLEANUP_COMPLETION_ENVS.with(|envs| {
      envs.borrow_mut().remove(&(env as EnvId));
    });
    if cfg!(debug_assertions) {
      eprintln!(
        "Add JsDeferred cleanup completion hook failed: {}",
        crate::Status::from(status)
      );
    }
  }
}

#[cfg(not(feature = "noop"))]
unsafe extern "C" fn finalize_callback_env_cleanup_complete(data: *mut c_void) {
  let env = data as sys::napi_env;
  crate::bindgen_runtime::with_runtime_teardown_guard(|| {
    crate::bindgen_runtime::catch_unwind_safely(|| {
      complete_finalize_cleanup_for_env(env);
    });
  });
}

#[cfg(not(feature = "noop"))]
fn complete_finalize_cleanup_for_env(env: sys::napi_env) {
  FINALIZE_CLOSING_ENVS.with(|envs| {
    envs.borrow_mut().remove(&(env as EnvId));
  });
  FINALIZE_CLEANUP_COMPLETION_ENVS.with(|envs| {
    envs.borrow_mut().remove(&(env as EnvId));
  });
}

struct DeferredData<Data: ToNapiValue, Resolver: FnOnce(Env) -> Result<Data>> {
  // Keep this field before `_payload_guard`: the payload must remain visible to
  // teardown until dropping its last TSFN Arc has completed.
  tsfn: Arc<DeferredTsfn>,
  _payload_guard: DeferredTsfnPayloadGuard,
  resolver: Result<Resolver>,
  rejection_cleanup: Option<Box<dyn FnOnce() + Send>>,
  #[cfg(feature = "deferred_trace")]
  trace: DeferredTrace,
  finalize_callback: SharedFinalizeCallback,
}

pub struct JsDeferred<Data: ToNapiValue, Resolver: FnOnce(Env) -> Result<Data>> {
  env: sys::napi_env,
  owner_thread: ThreadId,
  // Keep this field before `_handle_lease`: the handle must remain visible to
  // teardown until dropping its last TSFN Arc has completed.
  tsfn: Arc<DeferredTsfn>,
  _handle_lease: DeferredTsfnHandleLease,
  #[cfg(feature = "deferred_trace")]
  trace: DeferredTrace,
  finalize_callback: SharedFinalizeCallback,
  settlement: DeferredSettlement,
  _data: PhantomData<fn() -> Data>,
  _resolver: PhantomData<fn() -> Resolver>,
}

/// Clones race to settle the same promise; only the first resolution or rejection is submitted.
impl<Data: ToNapiValue, Resolver: FnOnce(Env) -> Result<Data>> Clone
  for JsDeferred<Data, Resolver>
{
  fn clone(&self) -> Self {
    Self {
      env: self.env,
      owner_thread: self.owner_thread,
      tsfn: Arc::clone(&self.tsfn),
      _handle_lease: DeferredTsfnHandleLease::new(Arc::clone(&self.tsfn.state)),
      #[cfg(feature = "deferred_trace")]
      trace: self.trace.clone(),
      finalize_callback: self.finalize_callback.clone(),
      settlement: self.settlement.clone(),
      _data: PhantomData,
      _resolver: PhantomData,
    }
  }
}

// SAFETY: a JsDeferred owns only a Node threadsafe-function handle and Send callback state.
// Data and Resolver are represented by non-owning function-pointer markers. Resolution data is
// transferred through napi_call_threadsafe_function only after the Resolver satisfies Send.
unsafe impl<Data: ToNapiValue, Resolver: FnOnce(Env) -> Result<Data> + Send> Send
  for JsDeferred<Data, Resolver>
{
}

impl<Data: ToNapiValue, Resolver: FnOnce(Env) -> Result<Data>> JsDeferred<Data, Resolver> {
  pub(crate) fn new(env: &Env) -> Result<(Self, Object<'_>)> {
    ensure_finalize_cleanup_hook(env.0)?;
    let (tsfn, promise) = js_deferred_new_raw(env, Some(napi_resolve_deferred::<Data, Resolver>))?;

    let deferred = Self {
      env: env.0,
      owner_thread: thread::current().id(),
      _handle_lease: DeferredTsfnHandleLease::new(Arc::clone(&tsfn.state)),
      tsfn,
      #[cfg(feature = "deferred_trace")]
      trace: DeferredTrace::new(env.0)?,
      finalize_callback: Default::default(),
      settlement: Default::default(),
      _data: PhantomData,
      _resolver: PhantomData,
    };

    Ok((deferred, promise))
  }

  /// Consumes the deferred, and resolves the promise. The provided function will be called
  /// from the JavaScript thread, and should return the resolved value.
  pub fn resolve(self, resolver: Resolver) {
    self.call_tsfn(Ok(resolver), None)
  }

  /// Consumes the deferred, and rejects the promise with the provided error.
  pub fn reject(self, error: Error) {
    self.call_tsfn(Err(error), None)
  }

  #[cfg(all(
    any(feature = "tokio_rt", feature = "async-runtime"),
    not(feature = "noop")
  ))]
  pub(crate) fn reject_with_cleanup(self, error: Error, cleanup: impl FnOnce() + Send + 'static) {
    self.call_tsfn(Err(error), Some(Box::new(cleanup)))
  }

  /// Set a callback to run on the JavaScript owner thread after settlement.
  ///
  /// This must be called on the thread that created the deferred.
  pub fn set_finalize_callback(
    &mut self,
    finalize_callback: Option<Box<dyn FnOnce(sys::napi_env)>>,
  ) {
    assert_eq!(
      self.owner_thread,
      thread::current().id(),
      "JsDeferred finalize callbacks must be registered on their JavaScript owner thread"
    );
    let finalize_callback =
      finalize_callback.map(|callback| FinalizeCallbackHandle::new(self.env, callback));
    let displaced_callback = {
      let mut slot = self
        .finalize_callback
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
      if slot.closed {
        finalize_callback
      } else {
        std::mem::replace(&mut slot.callback, finalize_callback)
      }
    };
    drop(displaced_callback);
  }

  fn call_tsfn(
    self,
    result: Result<Resolver>,
    rejection_cleanup: Option<Box<dyn FnOnce() + Send>>,
  ) {
    if !self.settlement.try_claim() {
      crate::bindgen_runtime::catch_unwind_safely(|| drop(result));
      crate::bindgen_runtime::catch_unwind_safely(|| drop(rejection_cleanup));
      return;
    }
    let data = DeferredData {
      tsfn: Arc::clone(&self.tsfn),
      _payload_guard: DeferredTsfnPayloadGuard::new(Arc::clone(&self.tsfn.state)),
      resolver: result,
      rejection_cleanup,
      #[cfg(feature = "deferred_trace")]
      trace: self.trace,
      finalize_callback: self.finalize_callback.clone(),
    };

    // Call back into the JS thread via a threadsafe function. This results in napi_resolve_deferred being called.
    let data = Box::into_raw(Box::new(data));
    let status = self.tsfn.call(data.cast());
    if status != sys::Status::napi_ok {
      // Node did not take ownership, most commonly because the environment is closing.
      // Reclaim scheduler-owned data here. JS-thread-owned resolver closures are represented
      // by SendableResolver handles and are cleared by the per-environment cleanup hook.
      let data = unsafe { Box::from_raw(data) };
      close_finalize_callback_slot(&data.finalize_callback);
      let retire_status = self
        .tsfn
        .state
        .retire_owner(sys::ThreadsafeFunctionReleaseMode::abort);
      if retire_status != sys::Status::napi_ok {
        retain_deferred_tsfn_ownership_for_unload_safety();
      }
      crate::bindgen_runtime::catch_unwind_safely(|| drop(data));
    }
  }
}

fn js_deferred_new_raw(
  env: &Env,
  resolve_deferred: sys::napi_threadsafe_function_call_js,
) -> Result<(Arc<DeferredTsfn>, Object<'_>)> {
  let mut raw_promise = ptr::null_mut();
  let mut raw_deferred = ptr::null_mut();
  check_status!(
    unsafe { sys::napi_create_promise(env.0, &mut raw_deferred, &mut raw_promise) },
    "Create promise in JsDeferred failed"
  )?;

  // Create a threadsafe function so we can call back into the JS thread when we are done.
  let mut async_resource_name = ptr::null_mut();
  check_status!(
    unsafe {
      sys::napi_create_string_utf8(
        env.0,
        c"napi_resolve_deferred".as_ptr().cast(),
        22,
        &mut async_resource_name,
      )
    },
    "Create async resource name in JsDeferred failed"
  )?;

  let tsfn = Arc::new(DeferredTsfn::new());
  let finalize_data = Box::into_raw(Box::new(Arc::clone(&tsfn.state)));
  let mut raw_tsfn = ptr::null_mut();
  let create_status = unsafe {
    sys::napi_create_threadsafe_function(
      env.0,
      ptr::null_mut(),
      ptr::null_mut(),
      async_resource_name,
      0,
      1,
      finalize_data.cast(),
      Some(finalize_deferred_tsfn),
      raw_deferred.cast(),
      resolve_deferred,
      &mut raw_tsfn,
    )
  };
  if create_status != sys::Status::napi_ok {
    drop(unsafe { Box::from_raw(finalize_data) });
  }
  check_status!(
    create_status,
    "Create threadsafe function in JsDeferred failed"
  )?;
  tsfn.set_raw(raw_tsfn);
  register_deferred_tsfn_owner_cleanup(env.0, &tsfn);

  let promise = Object::from_raw(env.0, raw_promise);

  Ok((tsfn, promise))
}

extern "C" fn napi_resolve_deferred<Data: ToNapiValue, Resolver: FnOnce(Env) -> Result<Data>>(
  env: sys::napi_env,
  _js_callback: sys::napi_value,
  context: *mut c_void,
  data: *mut c_void,
) {
  crate::bindgen_runtime::catch_unwind_safely(|| {
    napi_resolve_deferred_inner::<Data, Resolver>(env, context, data);
  });
}

fn napi_resolve_deferred_inner<Data: ToNapiValue, Resolver: FnOnce(Env) -> Result<Data>>(
  env: sys::napi_env,
  context: *mut c_void,
  data: *mut c_void,
) {
  let deferred = context.cast();
  let deferred_data: Box<DeferredData<Data, Resolver>> = unsafe { Box::from_raw(data.cast()) };
  if env.is_null() {
    // Node invokes TSFN callbacks with a null environment while aborting a closing
    // environment. The payload is Send and may be reclaimed here; JS-thread-owned resolver
    // entries are removed by the environment cleanup hook.
    close_finalize_callback_slot(&deferred_data.finalize_callback);
    crate::bindgen_runtime::catch_unwind_safely(|| drop(deferred_data));
    return;
  }
  let DeferredData {
    tsfn,
    _payload_guard,
    resolver,
    rejection_cleanup,
    #[cfg(feature = "deferred_trace")]
    trace,
    finalize_callback,
  } = *deferred_data;
  let finalize_callback = close_and_take_finalize_callback(&finalize_callback);
  if resolver.is_err() {
    if let Some(rejection_cleanup) = rejection_cleanup {
      crate::bindgen_runtime::catch_unwind_safely(rejection_cleanup);
    }
  }
  let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
    resolver
      .and_then(|resolver| resolver(Env::from_raw(env)))
      .and_then(|res| unsafe { ToNapiValue::to_napi_value(env, res) })
  }))
  .map_err(crate::bindgen_runtime::panic_to_error)
  .and_then(|result| result);

  let release_tsfn_result = check_status!(
    tsfn
      .state
      .retire_owner(sys::ThreadsafeFunctionReleaseMode::release),
    "Release threadsafe function in JsDeferred failed"
  );

  if let Err(e) = release_tsfn_result.and(result).and_then(|res| {
    check_status!(
      unsafe { sys::napi_resolve_deferred(env, deferred, res) },
      "Resolve deferred value failed"
    )
    .map(|_| {
      #[cfg(feature = "deferred_trace")]
      {
        let _status = unsafe { sys::napi_delete_reference(env, trace.0) };
        if _status != sys::Status::napi_ok && cfg!(debug_assertions) {
          eprintln!(
            "Failed to delete reference in deferred {}",
            crate::Status::from(_status)
          );
        }
      }
    })
  }) {
    #[cfg(feature = "deferred_trace")]
    let error = trace.into_rejected(env, e);
    #[cfg(not(feature = "deferred_trace"))]
    let error = unsafe { ToNapiValue::to_napi_value(env, e) };

    match error {
      Ok(error) => {
        unsafe { sys::napi_reject_deferred(env, deferred, error) };
        run_finalize_callback(finalize_callback, env);
      }
      Err(err) => {
        run_finalize_callback(finalize_callback, env);
        if cfg!(debug_assertions) {
          eprintln!("Failed to reject deferred: {err:?}");
          let mut err = ptr::null_mut();
          let mut err_msg = ptr::null_mut();
          unsafe {
            sys::napi_create_string_utf8(env, c"Rejection failed".as_ptr().cast(), 0, &mut err_msg);
            sys::napi_create_error(env, ptr::null_mut(), err_msg, &mut err);
            sys::napi_reject_deferred(env, deferred, err);
          }
        }
      }
    }
  } else {
    run_finalize_callback(finalize_callback, env);
  }
  drop(tsfn);
  drop(_payload_guard);
}

fn run_finalize_callback(finalize_callback: Option<FinalizeCallbackHandle>, env: sys::napi_env) {
  if let Some(finalize_callback) = finalize_callback {
    finalize_callback.run(env);
  }
}

fn close_finalize_callback_slot(finalize_callback: &SharedFinalizeCallback) {
  finalize_callback
    .lock()
    .unwrap_or_else(std::sync::PoisonError::into_inner)
    .closed = true;
}

fn close_and_take_finalize_callback(
  finalize_callback: &SharedFinalizeCallback,
) -> Option<FinalizeCallbackHandle> {
  let mut slot = finalize_callback
    .lock()
    .unwrap_or_else(std::sync::PoisonError::into_inner);
  slot.closed = true;
  slot.callback.take()
}

#[cfg_attr(feature = "noop", allow(dead_code))]
pub(crate) fn clear_finalize_callbacks_for_env(env: sys::napi_env) {
  FINALIZE_CLOSING_ENVS.with(|envs| {
    envs.borrow_mut().insert(env as EnvId);
  });
  let entries = FINALIZE_CALLBACKS.with(|callbacks| {
    let mut callbacks = callbacks.borrow_mut();
    let ids = callbacks
      .iter()
      .filter_map(|(id, entry)| (entry.env == env as EnvId).then_some(*id))
      .collect::<Vec<_>>();
    ids
      .into_iter()
      .filter_map(|id| callbacks.remove(&id))
      .collect::<Vec<_>>()
  });
  drop(entries);
}

#[cfg(test)]
mod tests {
  use std::{
    cell::Cell,
    ptr,
    rc::Rc,
    sync::{atomic::AtomicPtr, mpsc},
    thread::{self, ThreadId},
    time::Duration,
  };

  use super::*;

  type TestDeferred = JsDeferred<u32, fn(Env) -> Result<u32>>;

  struct DropThread {
    dropped_on: Rc<Cell<Option<ThreadId>>>,
  }

  impl Drop for DropThread {
    fn drop(&mut self) {
      self.dropped_on.set(Some(thread::current().id()));
    }
  }

  struct ReentrantFinalizeDrop {
    env: sys::napi_env,
    nested_dropped_on: Rc<Cell<Option<ThreadId>>>,
  }

  impl Drop for ReentrantFinalizeDrop {
    fn drop(&mut self) {
      let captured = DropThread {
        dropped_on: Rc::clone(&self.nested_dropped_on),
      };
      let nested = FinalizeCallbackHandle::new(
        self.env,
        Box::new(move |_| {
          drop(captured);
        }),
      );
      std::mem::forget(nested);
    }
  }

  struct ReentrantFinalizeReplacement {
    deferred: TestDeferred,
  }

  impl Drop for ReentrantFinalizeReplacement {
    fn drop(&mut self) {
      self.deferred.set_finalize_callback(None);
    }
  }

  fn test_tsfn_state(
    raw: sys::napi_threadsafe_function,
    owner_retired: bool,
    closing: bool,
  ) -> Arc<DeferredTsfnState> {
    Arc::new(DeferredTsfnState {
      raw: AtomicPtr::new(raw),
      owner_cleanup_context: AtomicPtr::new(ptr::null_mut()),
      owner_retired: AtomicBool::new(owner_retired),
      closing: AtomicBool::new(closing),
      rust_handle_count: AtomicUsize::new(0),
      outstanding_payloads: AtomicUsize::new(0),
      lifecycle: RwLock::new(()),
    })
  }

  fn test_deferred_with_state(
    env: sys::napi_env,
    finalize_callback: SharedFinalizeCallback,
    state: Arc<DeferredTsfnState>,
  ) -> TestDeferred {
    TestDeferred {
      env,
      owner_thread: thread::current().id(),
      tsfn: Arc::new(DeferredTsfn {
        state: Arc::clone(&state),
      }),
      _handle_lease: DeferredTsfnHandleLease::new(state),
      #[cfg(feature = "deferred_trace")]
      trace: DeferredTrace(ptr::null_mut()),
      finalize_callback,
      settlement: DeferredSettlement::default(),
      _data: PhantomData,
      _resolver: PhantomData,
    }
  }

  fn test_deferred(env: sys::napi_env, finalize_callback: SharedFinalizeCallback) -> TestDeferred {
    test_deferred_with_state(
      env,
      finalize_callback,
      test_tsfn_state(ptr::null_mut(), false, false),
    )
  }

  #[test]
  fn non_send_finalize_callback_runs_on_owner_thread() {
    let owner_thread = thread::current().id();
    let called_on = Rc::new(Cell::new(None));
    let called_on_callback = Rc::clone(&called_on);
    let callback = FinalizeCallbackHandle::new(
      std::ptr::null_mut(),
      Box::new(move |_| called_on_callback.set(Some(thread::current().id()))),
    );

    callback.run(std::ptr::null_mut());

    assert_eq!(called_on.get(), Some(owner_thread));
  }

  #[test]
  fn environment_cleanup_drops_finalize_callbacks_on_owner_thread() {
    let owner_thread = thread::current().id();
    let dropped_on = Rc::new(Cell::new(None));
    let captured = DropThread {
      dropped_on: Rc::clone(&dropped_on),
    };
    let env = 1usize as sys::napi_env;
    let _callback = FinalizeCallbackHandle::new(
      env,
      Box::new(move |_| {
        drop(captured);
      }),
    );

    clear_finalize_callbacks_for_env(env);

    assert_eq!(dropped_on.get(), Some(owner_thread));
  }

  #[test]
  fn environment_cleanup_rejects_reentrant_finalize_callbacks() {
    let env = 2usize as sys::napi_env;
    let nested_dropped_on = Rc::new(Cell::new(None));
    let captured = ReentrantFinalizeDrop {
      env,
      nested_dropped_on: Rc::clone(&nested_dropped_on),
    };
    let _callback = FinalizeCallbackHandle::new(
      env,
      Box::new(move |_| {
        drop(captured);
      }),
    );

    clear_finalize_callbacks_for_env(env);

    assert_eq!(nested_dropped_on.get(), Some(thread::current().id()));
  }

  #[cfg(not(feature = "noop"))]
  #[test]
  fn environment_stays_closing_until_cleanup_completion() {
    let env = 6usize as sys::napi_env;
    clear_finalize_callbacks_for_env(env);

    let dropped_on = Rc::new(Cell::new(None));
    let captured = DropThread {
      dropped_on: Rc::clone(&dropped_on),
    };
    let callback = FinalizeCallbackHandle::new(env, Box::new(move |_| drop(captured)));

    assert_eq!(dropped_on.get(), Some(thread::current().id()));
    drop(callback);
    complete_finalize_cleanup_for_env(env);

    let callback = FinalizeCallbackHandle::new(env, Box::new(|_| {}));
    assert_ne!(callback.id, 0);
    drop(callback);
  }

  #[test]
  fn replacing_finalize_callback_drops_previous_callback_outside_lock() {
    let (completed_tx, completed_rx) = mpsc::channel();
    let worker = thread::spawn(move || {
      let env = 3usize as sys::napi_env;
      let finalize_callback = SharedFinalizeCallback::default();
      let mut deferred = test_deferred(env, Arc::clone(&finalize_callback));
      let reentrant = ReentrantFinalizeReplacement {
        deferred: test_deferred(env, finalize_callback),
      };

      deferred.set_finalize_callback(Some(Box::new(move |_| drop(reentrant))));
      deferred.set_finalize_callback(Some(Box::new(|_| {})));
      completed_tx.send(()).unwrap();
    });

    completed_rx
      .recv_timeout(Duration::from_secs(5))
      .expect("finalizer replacement deadlocked while dropping the previous callback");
    worker.join().unwrap();
  }

  #[test]
  fn stale_finalize_handles_cannot_alias_a_reused_id_after_wrap() {
    let env = 4usize as sys::napi_env;
    let id = 1;
    let stale_identity = Arc::new(());
    let stale_drop = FinalizeCallbackHandle {
      id,
      identity: Arc::clone(&stale_identity),
    };
    let stale_run = FinalizeCallbackHandle {
      id,
      identity: stale_identity,
    };
    FINALIZE_CALLBACKS.with(|callbacks| {
      callbacks.borrow_mut().insert(
        id,
        FinalizeCallbackEntry {
          env: env as EnvId,
          identity: Arc::clone(&stale_drop.identity),
          callback: Some(Box::new(|_| {})),
        },
      );
    });
    clear_finalize_callbacks_for_env(env);

    let replacement_called = Rc::new(Cell::new(false));
    let replacement_called_by_callback = Rc::clone(&replacement_called);
    let replacement_identity = Arc::new(());
    let replacement = FinalizeCallbackHandle {
      id,
      identity: Arc::clone(&replacement_identity),
    };
    FINALIZE_CALLBACKS.with(|callbacks| {
      callbacks.borrow_mut().insert(
        id,
        FinalizeCallbackEntry {
          env: env as EnvId,
          identity: replacement_identity,
          callback: Some(Box::new(move |_| replacement_called_by_callback.set(true))),
        },
      );
    });

    drop(stale_drop);
    stale_run.run(env);
    assert!(!replacement_called.get());

    replacement.run(env);
    assert!(replacement_called.get());
  }

  #[test]
  fn deferred_clones_share_one_shot_settlement_ownership() {
    let settlement = DeferredSettlement::default();
    let clone = settlement.clone();

    assert!(settlement.try_claim());
    assert!(!clone.try_claim());
  }

  #[test]
  fn failed_settlement_submission_retires_owner_and_reclaims_payload() {
    let state = test_tsfn_state(ptr::null_mut(), false, true);
    let finalize_callback = SharedFinalizeCallback::default();
    let deferred = test_deferred_with_state(
      7usize as sys::napi_env,
      Arc::clone(&finalize_callback),
      Arc::clone(&state),
    );

    deferred.resolve(|_| Ok(1));

    assert!(state.owner_retired.load(Ordering::Acquire));
    assert!(state.closing.load(Ordering::Acquire));
    assert_eq!(state.rust_handle_count.load(Ordering::Acquire), 0);
    assert_eq!(state.outstanding_payloads.load(Ordering::Acquire), 0);
    assert!(
      finalize_callback
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .closed
    );
  }

  #[test]
  fn deferred_handle_and_payload_guards_track_quiescence() {
    let state = test_tsfn_state(ptr::null_mut(), true, true);
    assert!(state.rust_activity_quiescent());

    let handle = DeferredTsfnHandleLease::new(Arc::clone(&state));
    assert_eq!(state.rust_handle_count.load(Ordering::Acquire), 1);
    assert!(!state.rust_activity_quiescent());

    let payload = DeferredTsfnPayloadGuard::new(Arc::clone(&state));
    assert_eq!(state.outstanding_payloads.load(Ordering::Acquire), 1);
    drop(handle);
    assert_eq!(state.rust_handle_count.load(Ordering::Acquire), 0);
    assert!(!state.rust_activity_quiescent());

    drop(payload);
    assert!(state.rust_activity_quiescent());
  }

  #[test]
  fn closed_state_rejects_calls_without_touching_raw_handle() {
    let raw = 1usize as sys::napi_threadsafe_function;
    let state = test_tsfn_state(raw, true, true);

    assert_eq!(state.call(ptr::null_mut()), sys::Status::napi_closing);
    assert_eq!(state.raw(), raw);
  }

  #[test]
  fn env_cleanup_closes_local_state_without_post_teardown_raw_access() {
    let raw = 1usize as sys::napi_threadsafe_function;
    let state = test_tsfn_state(raw, true, false);

    assert_eq!(state.retire_owner_for_env_cleanup(), sys::Status::napi_ok);
    assert!(state.closing.load(Ordering::Acquire));
    assert!(state.owner_retired.load(Ordering::Acquire));
    assert!(state.raw().is_null());
    assert_eq!(state.call(ptr::null_mut()), sys::Status::napi_closing);
  }

  #[test]
  fn finalize_callback_registration_remains_open_until_slot_consumption() {
    let env = 8usize as sys::napi_env;
    let finalize_callback = SharedFinalizeCallback::default();
    let mut deferred = test_deferred(env, Arc::clone(&finalize_callback));
    assert!(deferred.settlement.try_claim());

    let ran = Rc::new(Cell::new(false));
    let ran_by_callback = Rc::clone(&ran);
    deferred.set_finalize_callback(Some(Box::new(move |_| ran_by_callback.set(true))));
    assert!(finalize_callback
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner)
      .callback
      .is_some());

    let callback = close_and_take_finalize_callback(&finalize_callback)
      .expect("callback registered before slot consumption must be retained");
    callback.run(env);
    assert!(ran.get());

    let dropped_on = Rc::new(Cell::new(None));
    let capture = DropThread {
      dropped_on: Rc::clone(&dropped_on),
    };
    deferred.set_finalize_callback(Some(Box::new(move |_| drop(capture))));
    assert_eq!(dropped_on.get(), Some(thread::current().id()));
  }
}
