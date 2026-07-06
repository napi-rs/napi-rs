#![allow(clippy::single_component_path_imports)]

use std::marker::PhantomData;
use std::os::raw::c_void;
use std::ptr::{self, null_mut};
use std::sync::{
  self,
  atomic::{AtomicBool, AtomicPtr, Ordering},
  Arc, Condvar, Mutex, MutexGuard, RwLock, RwLockReadGuard, RwLockWriteGuard, TryLockError,
};
use std::thread::ThreadId;

use futures::channel::oneshot::{channel, Receiver};

use crate::{
  bindgen_runtime::{FromNapiValue, JsValuesTupleIntoVec, TypeName, Unknown, ValidateNapiValue},
  check_status, extract_error_cause, get_error_message_and_stack_trace, sys, Env, Error, JsError,
  Result, Status,
};

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

pub struct ThreadsafeFunctionHandle {
  raw: AtomicPtr<sys::napi_threadsafe_function__>,
  lifecycle: RwLock<()>,
  blocking_call: Mutex<()>,
  blocking_active: Mutex<bool>,
  blocking_idle: Condvar,
  owner_thread: ThreadId,
  closing: AtomicBool,
  aborted: RwLock<bool>,
  referred: AtomicBool,
}

impl ThreadsafeFunctionHandle {
  /// create a Arc to hold the `ThreadsafeFunctionHandle`
  pub fn new(raw: sys::napi_threadsafe_function) -> Arc<Self> {
    Arc::new(Self {
      raw: AtomicPtr::new(raw),
      lifecycle: RwLock::new(()),
      blocking_call: Mutex::new(()),
      blocking_active: Mutex::new(false),
      blocking_idle: Condvar::new(),
      owner_thread: std::thread::current().id(),
      closing: AtomicBool::new(false),
      aborted: RwLock::new(false),
      referred: AtomicBool::new(true),
    })
  }

  fn read_lifecycle(&self) -> RwLockReadGuard<'_, ()> {
    self
      .lifecycle
      .read()
      .unwrap_or_else(std::sync::PoisonError::into_inner)
  }

  fn write_lifecycle(&self) -> RwLockWriteGuard<'_, ()> {
    self
      .lifecycle
      .write()
      .unwrap_or_else(std::sync::PoisonError::into_inner)
  }

  fn lock_blocking_call(&self) -> std::result::Result<MutexGuard<'_, ()>, sys::napi_status> {
    if self.owner_thread == std::thread::current().id() {
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

  fn retire_locked(&self, mode: sys::napi_threadsafe_function_release_mode) -> sys::napi_status {
    self.with_write_aborted(|mut aborted| {
      if *aborted {
        return sys::Status::napi_ok;
      }

      let status = unsafe { sys::napi_release_threadsafe_function(self.get_raw(), mode) };
      if status == sys::Status::napi_ok {
        *aborted = true;
      }
      status
    })
  }

  fn retire(&self, mode: sys::napi_threadsafe_function_release_mode) -> sys::napi_status {
    let status = {
      let _lifecycle_guard = self.write_lifecycle();
      if mode == sys::ThreadsafeFunctionReleaseMode::abort {
        self.mark_closing();
      }
      self.retire_locked(mode)
    };
    if mode == sys::ThreadsafeFunctionReleaseMode::abort && status == sys::Status::napi_ok {
      self.wait_for_blocking_call();
    }
    status
  }

  fn mark_closing(&self) {
    self.closing.store(true, Ordering::Release);
  }

  fn start_blocking_call(&self) -> ThreadsafeFunctionBlockingCall<'_> {
    let mut active = self
      .blocking_active
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner);
    debug_assert!(!*active, "Blocking TSFN calls must be serialized");
    *active = true;
    ThreadsafeFunctionBlockingCall { handle: self }
  }

  fn wait_for_blocking_call(&self) {
    let mut active = self
      .blocking_active
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner);
    while *active {
      active = self
        .blocking_idle
        .wait(active)
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    }
  }

  fn finalize(&self) {
    {
      // Node owns the TSFN while invoking its native finalizer and deletes it
      // after the callback returns. Stop new calls and prevent Rust Drop from
      // releasing the finalized pointer, but never call a TSFN API from here.
      let _lifecycle_guard = self.write_lifecycle();
      self.mark_closing();
      self.with_write_aborted(|mut aborted| {
        *aborted = true;
      });
    }
    self.wait_for_blocking_call();
  }

  fn acquire_call_slot_locked(
    &self,
  ) -> std::result::Result<ThreadsafeFunctionCallSlot<'_>, sys::napi_status> {
    let status = self.with_read_aborted(|aborted| {
      if aborted || self.closing.load(Ordering::Acquire) {
        sys::Status::napi_closing
      } else {
        unsafe { sys::napi_acquire_threadsafe_function(self.get_raw()) }
      }
    });
    if status == sys::Status::napi_ok {
      return Ok(ThreadsafeFunctionCallSlot {
        handle: self,
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

  /// Lock `aborted` with read access, call `f` with the value of `aborted`, then unlock it
  pub fn with_read_aborted<RT, F>(&self, f: F) -> RT
  where
    F: FnOnce(bool) -> RT,
  {
    let aborted_guard = self
      .aborted
      .read()
      .unwrap_or_else(std::sync::PoisonError::into_inner);
    f(*aborted_guard)
  }

  /// Lock `aborted` with write access, call `f` with the `RwLockWriteGuard`, then unlock it
  pub fn with_write_aborted<RT, F>(&self, f: F) -> RT
  where
    F: FnOnce(RwLockWriteGuard<bool>) -> RT,
  {
    let aborted_guard = self
      .aborted
      .write()
      .unwrap_or_else(std::sync::PoisonError::into_inner);
    f(aborted_guard)
  }

  #[allow(clippy::arc_with_non_send_sync)]
  pub fn null() -> Arc<Self> {
    Self::new(null_mut())
  }

  pub fn get_raw(&self) -> sys::napi_threadsafe_function {
    self.raw.load(Ordering::SeqCst)
  }

  pub fn set_raw(&self, raw: sys::napi_threadsafe_function) {
    self.raw.store(raw, Ordering::SeqCst)
  }
}

struct ThreadsafeFunctionCallSlot<'a> {
  handle: &'a ThreadsafeFunctionHandle,
  acquired: bool,
}

struct ThreadsafeFunctionBlockingCall<'a> {
  handle: &'a ThreadsafeFunctionHandle,
}

impl Drop for ThreadsafeFunctionBlockingCall<'_> {
  fn drop(&mut self) {
    let mut active = self
      .handle
      .blocking_active
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner);
    *active = false;
    self.handle.blocking_idle.notify_all();
  }
}

impl ThreadsafeFunctionCallSlot<'_> {
  fn release_locked(&mut self) {
    if !self.acquired {
      return;
    }
    let status = unsafe {
      sys::napi_release_threadsafe_function(
        self.handle.get_raw(),
        sys::ThreadsafeFunctionReleaseMode::release,
      )
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

fn call_nonblocking_threadsafe_function_with_owned_data<T>(
  handle: &Arc<ThreadsafeFunctionHandle>,
  data: T,
) -> sys::napi_status {
  let mut rejected_data = Some(data);
  let status = {
    // Keep finalization, abort, refer, and unref excluded through acquisition,
    // Push, and release. This also makes Node 22's finalizer-before-drain
    // deletion wait until the native call no longer owns a slot.
    let _lifecycle_guard = handle.read_lifecycle();
    match handle.acquire_call_slot_locked() {
      Ok(mut call_slot) => {
        let data = Box::into_raw(Box::new(ThreadsafeFunctionCallData {
          handle: Arc::downgrade(handle),
          data: rejected_data
            .take()
            .expect("Threadsafe Function call data must be available before enqueue"),
        }));
        let status = unsafe {
          sys::napi_call_threadsafe_function(
            handle.get_raw(),
            data.cast(),
            ThreadsafeFunctionCallMode::NonBlocking.into(),
          )
        };
        if status != sys::Status::napi_ok {
          // N-API only takes ownership after a successful enqueue.
          rejected_data =
            Some(unsafe { Box::<ThreadsafeFunctionCallData<T>>::from_raw(data).data });
        }
        call_slot.finish(status);
        status
      }
      Err(status) => status,
    }
  };
  drop(rejected_data);
  status
}

fn call_blocking_threadsafe_function_with_owned_data<T>(
  handle: &Arc<ThreadsafeFunctionHandle>,
  data: T,
) -> sys::napi_status {
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
  }));
  let status = unsafe {
    sys::napi_call_threadsafe_function(
      handle.get_raw(),
      data.cast(),
      ThreadsafeFunctionCallMode::Blocking.into(),
    )
  };
  if status == sys::Status::napi_closing {
    // Blocking calls cannot retain the lifecycle read lock while waiting,
    // because abort needs the write lock to wake them. Publish native closing
    // immediately on return so refer/unref cannot enter during slot cleanup.
    handle.mark_closing();
  }
  let rejected_data = if status != sys::Status::napi_ok {
    // N-API only takes ownership after a successful enqueue.
    Some(unsafe { Box::<ThreadsafeFunctionCallData<T>>::from_raw(data).data })
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
  drop(rejected_data);
  status
}

fn call_threadsafe_function_with_owned_data<T>(
  handle: &Arc<ThreadsafeFunctionHandle>,
  data: T,
  mode: ThreadsafeFunctionCallMode,
) -> sys::napi_status {
  match mode {
    ThreadsafeFunctionCallMode::NonBlocking => {
      call_nonblocking_threadsafe_function_with_owned_data(handle, data)
    }
    ThreadsafeFunctionCallMode::Blocking => {
      call_blocking_threadsafe_function_with_owned_data(handle, data)
    }
  }
}

impl Drop for ThreadsafeFunctionHandle {
  fn drop(&mut self) {
    self.with_read_aborted(|aborted| {
      if !aborted {
        let raw = self.get_raw();
        // if ThreadsafeFunction::create failed, the raw will be null and we don't need to release it
        if !raw.is_null() {
          let release_status = unsafe {
            sys::napi_release_threadsafe_function(
              self.get_raw(),
              sys::ThreadsafeFunctionReleaseMode::release,
            )
          };
          assert!(
            release_status == sys::Status::napi_ok,
            "Threadsafe Function release failed {}",
            Status::from(release_status)
          );
        }
      }
    })
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
  pub callback: Box<dyn FnOnce(Result<Return>, Env) -> Result<()>>,
}

struct ThreadsafeFunctionCallData<T> {
  handle: sync::Weak<ThreadsafeFunctionHandle>,
  data: T,
}

type ThreadsafeFunctionCallResult<T, Return, ErrorStatus> = (
  Option<Arc<ThreadsafeFunctionHandle>>,
  Result<ThreadsafeFunctionCallJsBackData<T, Return>, ErrorStatus>,
);

async fn receive_call_async_result<Return>(receiver: Receiver<Result<Return>>) -> Result<Return> {
  receiver.await.map_err(|_| {
    crate::Error::new(
      Status::GenericFailure,
      "Receive value from threadsafe function sender failed",
    )
  })?
}

/// Communicate with the addon's main thread by invoking a JavaScript function from other threads.
///
/// ## Example
/// An example of using `ThreadsafeFunction`:
///
/// ```rust
/// use std::thread;
/// use std::sync::Arc;
///
/// use napi::{
///     threadsafe_function::{
///         ThreadSafeCallContext, ThreadsafeFunctionCallMode, ThreadsafeFunctionReleaseMode,
///     },
/// };
/// use napi_derive::napi;
///
/// #[napi]
/// pub fn call_threadsafe_function(callback: Arc<ThreadsafeFunction<(u32, bool, String), ()>>) {
///   let tsfn_cloned = tsfn.clone();
///
///   thread::spawn(move || {
///       let output: Vec<u32> = vec![0, 1, 2, 3];
///       // It's okay to call a threadsafe function multiple times.
///       tsfn.call(Ok((1, false, "NAPI-RS".into())), ThreadsafeFunctionCallMode::Blocking);
///       tsfn.call(Ok((2, true, "NAPI-RS".into())), ThreadsafeFunctionCallMode::NonBlocking);
///   });
///
///   thread::spawn(move || {
///       tsfn_cloned.call((3, false, "NAPI-RS".into())), ThreadsafeFunctionCallMode::NonBlocking);
///   });
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
  pub handle: Arc<ThreadsafeFunctionHandle>,
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
/// All of the heavy FFI setup (async resource name creation, the
/// `napi_create_threadsafe_function` call, the weak-ref handling) is
/// type-independent, so it is extracted here to be emitted once instead of
/// being monomorphized for every `<T, Return, CallJsBackArgs, ...>`
/// combination. The only per-type parts — the boxed user callback and the two
/// `extern "C"` trampolines — are passed in as raw pointers / function
/// pointers by the generic `create` shell.
fn create_raw(
  env: sys::napi_env,
  func: sys::napi_value,
  max_queue_size: usize,
  weak: bool,
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
  let handle = ThreadsafeFunctionHandle::null();
  check_status!(
    unsafe {
      sys::napi_create_threadsafe_function(
        env,
        func,
        ptr::null_mut(),
        async_resource_name,
        max_queue_size,
        1,
        Arc::downgrade(&handle).into_raw().cast_mut().cast(), // pass handler to thread_finalize_cb
        thread_finalize_cb,
        callback_ptr,
        call_js_cb,
        &mut raw_tsfn,
      )
    },
    "Create threadsafe function in ThreadsafeFunction::create failed"
  )?;
  handle.set_raw(raw_tsfn);

  // Weak ThreadsafeFunction will not prevent the event loop from exiting
  if weak {
    check_status!(
      unsafe { sys::napi_unref_threadsafe_function(env, raw_tsfn) },
      "Unref threadsafe function failed in Weak mode"
    )?;
    // The tsfn is now unreferenced at the N-API level, so keep `referred` in
    // sync. Otherwise the deprecated `refer`/`unref` would read a stale `true`
    // and `refer` would skip its `napi_ref_threadsafe_function` call.
    handle.referred.store(false, Ordering::Relaxed);
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
      Weak,
      callback_ptr.cast(),
      Some(thread_finalize_cb::<T, NewArgs, R>),
      Some(call_js_cb::<T, Return, NewArgs, ErrorStatus, R, CalleeHandled>),
    )
    .inspect_err(|_| {
      drop(unsafe { Box::from_raw(callback_ptr) });
    })?;

    Ok(ThreadsafeFunction {
      handle,
      _phantom: PhantomData,
    })
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
    let _lifecycle_guard = self.handle.write_lifecycle();
    self.handle.with_read_aborted(|aborted| {
      if !aborted
        && !self.handle.closing.load(Ordering::Acquire)
        && !self.handle.referred.load(Ordering::Relaxed)
      {
        check_status!(unsafe { sys::napi_ref_threadsafe_function(env.0, self.handle.get_raw()) })?;
        self.handle.referred.store(true, Ordering::Relaxed);
      }
      Ok(())
    })
  }

  #[deprecated(
    since = "2.17.0",
    note = "Please use `ThreadsafeFunction::clone` instead of manually decreasing the reference count"
  )]
  /// See [napi_unref_threadsafe_function](https://nodejs.org/api/n-api.html#n_api_napi_unref_threadsafe_function)
  /// for more information.
  pub fn unref(&mut self, env: &Env) -> Result<()> {
    let _lifecycle_guard = self.handle.write_lifecycle();
    self.handle.with_read_aborted(|aborted| {
      if !aborted
        && !self.handle.closing.load(Ordering::Acquire)
        && self.handle.referred.load(Ordering::Relaxed)
      {
        check_status!(unsafe {
          sys::napi_unref_threadsafe_function(env.0, self.handle.get_raw())
        })?;
        self.handle.referred.store(false, Ordering::Relaxed);
      }
      Ok(())
    })
  }

  pub fn aborted(&self) -> bool {
    self.handle.closing.load(Ordering::Acquire) || self.handle.with_read_aborted(|aborted| aborted)
  }

  #[deprecated(
    since = "2.17.0",
    note = "Drop all references to the ThreadsafeFunction will automatically release it"
  )]
  pub fn abort(self) -> Result<()> {
    check_status!(self
      .handle
      .retire(sys::ThreadsafeFunctionReleaseMode::abort))
  }

  /// Get the raw `ThreadSafeFunction` pointer
  pub fn raw(&self) -> sys::napi_threadsafe_function {
    self.handle.get_raw()
  }
}

impl<
    T: 'static,
    Return: FromNapiValue,
    CallJsBackArgs: 'static + JsValuesTupleIntoVec,
    ErrorStatus: AsRef<str> + From<Status>,
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
  pub fn call_with_return_value<F: 'static + FnOnce(Result<Return>, Env) -> Result<()>>(
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
  pub async fn call_async(&self, value: Result<T, ErrorStatus>) -> Result<Return> {
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
  pub async fn call_async_catch(&self, value: Result<T, ErrorStatus>) -> Result<Return> {
    self.call_async(value).await
  }
}

impl<
    T: 'static,
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

  /// Call the ThreadsafeFunction, and handle the return value with a callback
  pub fn call_with_return_value<F: 'static + FnOnce(Result<Return>, Env) -> Result<()>>(
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
  pub async fn call_async(&self, value: T) -> Result<Return> {
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
  pub async fn call_async_catch(&self, value: T) -> Result<Return> {
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
  #[allow(unused_variables)] env: sys::napi_env,
  finalize_data: *mut c_void,
  finalize_hint: *mut c_void,
) where
  R: 'static + FnMut(ThreadsafeCallContext<T>) -> Result<V>,
{
  let handle_option: Option<Arc<ThreadsafeFunctionHandle>> =
    unsafe { sync::Weak::from_raw(finalize_data.cast()).upgrade() };

  if let Some(handle) = handle_option.as_ref() {
    crate::bindgen_runtime::catch_unwind_safely(|| handle.finalize());
  }

  let callback = unsafe { Box::<R>::from_raw(finalize_hint.cast()) };
  crate::bindgen_runtime::catch_unwind_safely(move || drop(callback));

  if let Some(handle) = handle_option {
    crate::bindgen_runtime::catch_unwind_safely(move || drop(handle));
  }
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
    let ThreadsafeFunctionCallData { handle, data } = unsafe {
      *Box::<
        ThreadsafeFunctionCallData<
          Result<ThreadsafeFunctionCallJsBackData<T, Return>, ErrorStatus>,
        >,
      >::from_raw(data.cast())
    };
    (handle.upgrade(), data)
  } else {
    let ThreadsafeFunctionCallData { handle, data } = unsafe {
      *Box::<ThreadsafeFunctionCallData<ThreadsafeFunctionCallJsBackData<T, Return>>>::from_raw(
        data.cast(),
      )
    };
    (handle.upgrade(), Ok(data))
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
  let (handle, val) =
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
        } else {
          unsafe { Return::from_napi_value(raw_env, return_value) }
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
  handle_call_js_cb_status(status, raw_env)
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
  use super::*;

  #[test]
  fn native_finalizer_only_closes_rust_side_ownership() {
    let handle = ThreadsafeFunctionHandle::null();

    handle.finalize();

    assert!(handle.closing.load(Ordering::Acquire));
    assert!(handle.with_read_aborted(|aborted| aborted));
  }
}
