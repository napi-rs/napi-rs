use std::ffi::c_void;
use std::ptr;
use std::sync::Arc;

pub use callback_info::*;
pub use class_accessor::*;
pub(crate) use class_identity::{check_class_identity, class_id_of, ClassId};
pub use env::*;
pub use env_registration::{
  env_teardown_class_refs_deleted, env_teardown_custom_gc_released,
  env_teardown_reflect_refs_deleted,
};
pub use iterator::Generator;
pub use js_values::*;
pub use module_register::*;
pub use native_borrow::*;
pub use type_tag::*;

use super::sys;
use crate::{check_status, Error, JsError, Result, Status};

#[cfg(any(feature = "tokio_rt", feature = "async-runtime"))]
pub mod async_iterator;
#[cfg(any(feature = "tokio_rt", feature = "async-runtime"))]
pub use async_iterator::AsyncGenerator;
mod callback_info;
mod class_accessor;
mod class_identity;
mod env;
pub(crate) mod env_registration;
mod error;
pub mod iterator;
mod js_values;
mod module_register;
mod native_borrow;
mod type_tag;

pub trait ObjectFinalize: Sized {
  #[allow(unused)]
  fn finalize(self, env: Env) -> Result<()> {
    Ok(())
  }
}

#[doc(hidden)]
pub fn panic_to_error(e: Box<dyn std::any::Any + Send>) -> Error {
  let message = {
    if let Some(string) = e.downcast_ref::<String>() {
      string.clone()
    } else if let Some(string) = e.downcast_ref::<&str>() {
      string.to_string()
    } else {
      format!("panic from Rust code: {:?}", e)
    }
  };
  Error::new(Status::GenericFailure, message)
}

pub(crate) fn catch_unwind_safely(f: impl FnOnce()) {
  if let Err(payload) = std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)) {
    // A malicious panic payload may panic again from Drop. Leaking only that exceptional
    // payload is preferable to a double panic crossing an FFI or teardown boundary.
    std::mem::forget(payload);
  }
}

/// Shared teardown for a wrapped `#[napi]` class instance, used by both the GC
/// finalizer (`raw_finalize_unchecked`) and explicit disposal (`dispose_class_instance`).
///
/// Removes the `REFERENCE_MAP` entry, runs `finalize_callbacks` (dropping any
/// `SharedReference` child views `S` while `T` is still alive), runs
/// `ObjectFinalize::finalize(self, env)` (dropping `T`), deletes `object_ref`,
/// and frees any ZST placeholder last.
///
/// # Safety
///
/// `finalize_data` must be a live wrapped class pointer for `T` that will not be
/// finalized again, and `env` must be its live owning `napi_env` on the JS thread.
pub(crate) unsafe fn finalize_class_instance<T: ObjectFinalize>(
  env: sys::napi_env,
  finalize_data: *mut c_void,
) -> Result<()> {
  // Remove the `REFERENCE_MAP` entry first so neither child finalizers nor
  // `ObjectFinalize::finalize` can observe a stale entry keyed on `finalize_data`.
  let ref_entry = REFERENCE_MAP
    .with(|cell| cell.borrow_mut(|reference_map| reference_map.remove(&finalize_data)));

  let ref_val = if let Some(RefEntry {
    info: (_, ref_val, finalize_callbacks_ptr),
    ..
  }) = ref_entry
  {
    let finalize_callbacks_rc = unsafe { Arc::from_raw(finalize_callbacks_ptr) };

    #[cfg(all(debug_assertions, not(target_family = "wasm")))]
    {
      let rc_strong_count = Arc::strong_count(&finalize_callbacks_rc);
      // If `Arc` strong count is 2, either the finalize of a referenced `Object`
      // ran before `Reference::drop` (process exit), or `Reference::drop` is
      // completing a deferred disposal and its own `Arc` field drops next.
      if rc_strong_count != 1 && rc_strong_count != 2 {
        eprintln!("Arc strong count is: {rc_strong_count}, it should be 1 or 2");
      }
    }
    // Drop `SharedReference` child views `S` (which borrow `&T`) BEFORE
    // reconstructing `Box<T>` and dropping `T`.
    let finalize = unsafe { Box::from_raw(finalize_callbacks_rc.get()) };
    finalize();
    drop(finalize_callbacks_rc);
    Some(ref_val)
  } else {
    None
  };

  let data: Box<T> = unsafe { Box::from_raw(finalize_data.cast()) };
  let finalize_result = data.finalize(Env::from_raw(env));

  if let Some(ref_val) = ref_val {
    let delete_reference_status = unsafe { sys::napi_delete_reference(env, ref_val) };
    debug_assert!(
      delete_reference_status == sys::Status::napi_ok,
      "Delete reference in finalize callback failed {}",
      Status::from(delete_reference_status)
    );
  }

  // Released last so the address cannot be reused while the `REFERENCE_MAP`
  // entry keyed on it is still being torn down.
  unsafe { free_empty_class_placeholder::<T>(finalize_data) };

  finalize_result
}

/// Throws `err` from a deferred `ObjectFinalize::finalize` call only when `env`
/// does not already have a pending exception, so a method's own error is never
/// clobbered.
pub(crate) fn throw_deferred_finalize_error(env: sys::napi_env, err: Error) {
  if env.is_null() {
    return;
  }
  let mut is_pending = false;
  let check = unsafe { sys::napi_is_exception_pending(env, &mut is_pending) };
  if check == sys::Status::napi_ok && !is_pending {
    unsafe { JsError::from(err).throw_into(env) };
  }
}

pub(crate) enum DeferredBatchError {
  JsException(sys::napi_env, sys::napi_value),
  RustError(sys::napi_env, Error),
}

/// Runs a batch of deferred `#[napi(disposable)]` finalizers while ensuring an
/// error or JS exception thrown by an earlier finalizer does not leave a pending
/// JS exception on `env` that would fail later finalizers' Node-API calls with
/// `Status::PendingException`.
pub(crate) struct DeferredDisposeBatch {
  throw_on_err: bool,
  had_preexisting_exception: Option<(sys::napi_env, bool)>,
  first_err: Option<DeferredBatchError>,
}

impl DeferredDisposeBatch {
  pub(crate) fn new(throw_on_err: bool) -> Self {
    Self {
      throw_on_err,
      had_preexisting_exception: None,
      first_err: None,
    }
  }

  fn env_had_preexisting_exception(&mut self, env: sys::napi_env) -> bool {
    if env.is_null() {
      return false;
    }
    if let Some((cached_env, had)) = self.had_preexisting_exception {
      if cached_env == env {
        return had;
      }
    }
    let mut is_pending = false;
    let had = unsafe { sys::napi_is_exception_pending(env, &mut is_pending) }
      == sys::Status::napi_ok
      && is_pending;
    if self.had_preexisting_exception.is_none() {
      self.had_preexisting_exception = Some((env, had));
    }
    had
  }

  pub(crate) unsafe fn run(
    &mut self,
    env: sys::napi_env,
    ptr: *mut c_void,
    finalize: unsafe fn(sys::napi_env, *mut c_void) -> Result<()>,
    has_more: bool,
  ) {
    // Only probe `napi_is_exception_pending` when clearing a JS exception may
    // actually be needed (multi-item batches, teardown, or after an earlier
    // batch error). This keeps single-item batches overhead-free and preserves
    // unit tests that use fake `napi_env` handles without a Node host.
    let need_js_exception_isolation = has_more || !self.throw_on_err || self.first_err.is_some();
    let had_preexisting = if need_js_exception_isolation {
      self.env_had_preexisting_exception(env)
    } else {
      false
    };

    let result = unsafe { finalize(env, ptr) };

    if need_js_exception_isolation && !had_preexisting && !env.is_null() {
      let mut is_pending = false;
      if unsafe { sys::napi_is_exception_pending(env, &mut is_pending) } == sys::Status::napi_ok
        && is_pending
      {
        let mut exc = ptr::null_mut();
        if unsafe { sys::napi_get_and_clear_last_exception(env, &mut exc) } == sys::Status::napi_ok
        {
          if self.throw_on_err && self.first_err.is_none() {
            self.first_err = Some(DeferredBatchError::JsException(env, exc));
          }
          return;
        }
      }
    }

    if self.throw_on_err && self.first_err.is_none() {
      if let Err(err) = result {
        self.first_err = Some(DeferredBatchError::RustError(env, err));
      }
    }
  }

  pub(crate) fn finish(self) {
    match self.first_err {
      Some(DeferredBatchError::JsException(env, exc)) => {
        if !env.is_null() {
          let mut is_pending = false;
          if unsafe { sys::napi_is_exception_pending(env, &mut is_pending) } == sys::Status::napi_ok
            && !is_pending
          {
            unsafe { sys::napi_throw(env, exc) };
          }
        }
      }
      Some(DeferredBatchError::RustError(env, err)) => {
        throw_deferred_finalize_error(env, err);
      }
      None => {}
    }
  }
}

#[cfg(not(all(feature = "napi8", not(target_family = "wasm"))))]
fn has_pending_exception(env: sys::napi_env) -> bool {
  let mut is_pending = false;
  let status = unsafe { sys::napi_is_exception_pending(env, &mut is_pending) };
  status != sys::Status::napi_ok || is_pending
}

#[cfg(not(all(feature = "napi8", not(target_family = "wasm"))))]
fn clear_pending_exception(env: sys::napi_env) {
  let mut is_pending = false;
  if unsafe { sys::napi_is_exception_pending(env, &mut is_pending) } == sys::Status::napi_ok
    && is_pending
  {
    let mut ignored = ptr::null_mut();
    unsafe { sys::napi_get_and_clear_last_exception(env, &mut ignored) };
  }
}

#[cfg(not(all(feature = "napi8", not(target_family = "wasm"))))]
fn napi_value_type(env: sys::napi_env, value: sys::napi_value) -> Option<sys::napi_valuetype> {
  let mut value_type = 0;
  if unsafe { sys::napi_typeof(env, value, &mut value_type) } != sys::Status::napi_ok {
    clear_pending_exception(env);
    return None;
  }
  Some(value_type)
}

/// Captures and caches a private `{ map: new WeakMap(), get, set }` holder for
/// `registration` during module registration so wasm and pre-napi8 builds can
/// track disposed JS instances by exact object identity without invoking user
/// JS mid-dispose or relying on forgeable `napi_instanceof`.
#[cfg(all(
  not(feature = "noop"),
  not(all(feature = "napi8", not(target_family = "wasm")))
))]
pub(crate) fn cache_disposed_objects_for_env(
  env: sys::napi_env,
  registration: env_registration::RegistrationId,
) {
  if has_pending_exception(env) {
    return;
  }
  let mut global = ptr::null_mut();
  if unsafe { sys::napi_get_global(env, &mut global) } != sys::Status::napi_ok {
    clear_pending_exception(env);
    return;
  }
  let mut weak_map_ctor = ptr::null_mut();
  if unsafe { sys::napi_get_named_property(env, global, c"WeakMap".as_ptr(), &mut weak_map_ctor) }
    != sys::Status::napi_ok
  {
    clear_pending_exception(env);
    return;
  }
  if napi_value_type(env, weak_map_ctor) != Some(sys::ValueType::napi_function) {
    return;
  }
  let mut proto = ptr::null_mut();
  if unsafe { sys::napi_get_named_property(env, weak_map_ctor, c"prototype".as_ptr(), &mut proto) }
    != sys::Status::napi_ok
  {
    clear_pending_exception(env);
    return;
  }
  if napi_value_type(env, proto) != Some(sys::ValueType::napi_object) {
    return;
  }
  let mut get_fn = ptr::null_mut();
  let mut set_fn = ptr::null_mut();
  if unsafe { sys::napi_get_named_property(env, proto, c"get".as_ptr(), &mut get_fn) }
    != sys::Status::napi_ok
    || unsafe { sys::napi_get_named_property(env, proto, c"set".as_ptr(), &mut set_fn) }
      != sys::Status::napi_ok
  {
    clear_pending_exception(env);
    return;
  }
  if napi_value_type(env, get_fn) != Some(sys::ValueType::napi_function)
    || napi_value_type(env, set_fn) != Some(sys::ValueType::napi_function)
  {
    return;
  }
  let mut map = ptr::null_mut();
  if unsafe { sys::napi_new_instance(env, weak_map_ctor, 0, ptr::null(), &mut map) }
    != sys::Status::napi_ok
  {
    clear_pending_exception(env);
    return;
  }
  if napi_value_type(env, map) != Some(sys::ValueType::napi_object) {
    return;
  }
  // Sanity-probe `set`/`get` on both an inserted object and a distinct absent
  // object so a spoofed `WeakMap` whose `get` always returns a truthy number
  // is rejected once at registration.
  let mut probe = ptr::null_mut();
  let mut probe_absent = ptr::null_mut();
  let mut probe_val = ptr::null_mut();
  let mut set_ret = ptr::null_mut();
  let mut get_ret = ptr::null_mut();
  let mut absent_ret = ptr::null_mut();
  let mut got_id = 0u32;
  let probe_ok = unsafe {
    sys::napi_create_object(env, &mut probe) == sys::Status::napi_ok
      && sys::napi_create_object(env, &mut probe_absent) == sys::Status::napi_ok
      && sys::napi_create_uint32(env, 1, &mut probe_val) == sys::Status::napi_ok
      && sys::napi_call_function(
        env,
        map,
        set_fn,
        2,
        [probe, probe_val].as_ptr(),
        &mut set_ret,
      ) == sys::Status::napi_ok
      && sys::napi_call_function(env, map, get_fn, 1, &probe, &mut get_ret) == sys::Status::napi_ok
      && napi_value_type(env, get_ret) == Some(sys::ValueType::napi_number)
      && sys::napi_get_value_uint32(env, get_ret, &mut got_id) == sys::Status::napi_ok
      && got_id == 1
      && sys::napi_call_function(env, map, get_fn, 1, &probe_absent, &mut absent_ret)
        == sys::Status::napi_ok
      && napi_value_type(env, absent_ret) == Some(sys::ValueType::napi_undefined)
  };
  if !probe_ok {
    clear_pending_exception(env);
    return;
  }
  let mut holder = ptr::null_mut();
  if unsafe { sys::napi_create_object(env, &mut holder) } != sys::Status::napi_ok {
    clear_pending_exception(env);
    return;
  }
  let properties = [
    sys::napi_property_descriptor {
      utf8name: c"map".as_ptr().cast(),
      name: ptr::null_mut(),
      method: None,
      getter: None,
      setter: None,
      value: map,
      attributes: sys::PropertyAttributes::default,
      data: ptr::null_mut(),
    },
    sys::napi_property_descriptor {
      utf8name: c"get".as_ptr().cast(),
      name: ptr::null_mut(),
      method: None,
      getter: None,
      setter: None,
      value: get_fn,
      attributes: sys::PropertyAttributes::default,
      data: ptr::null_mut(),
    },
    sys::napi_property_descriptor {
      utf8name: c"set".as_ptr().cast(),
      name: ptr::null_mut(),
      method: None,
      getter: None,
      setter: None,
      value: set_fn,
      attributes: sys::PropertyAttributes::default,
      data: ptr::null_mut(),
    },
  ];
  if unsafe { sys::napi_define_properties(env, holder, properties.len(), properties.as_ptr()) }
    != sys::Status::napi_ok
  {
    clear_pending_exception(env);
    return;
  }
  let mut reference = ptr::null_mut();
  if unsafe { sys::napi_create_reference(env, holder, 1, &mut reference) } != sys::Status::napi_ok {
    clear_pending_exception(env);
    return;
  }
  if !env_registration::set_disposed_objects(registration, reference) {
    let _ = unsafe { sys::napi_delete_reference(env, reference) };
    clear_pending_exception(env);
  }
}

#[cfg(not(all(feature = "napi8", not(target_family = "wasm"))))]
unsafe fn record_disposed_class_instance(
  env: sys::napi_env,
  val: sys::napi_value,
  class_id: std::num::NonZeroU32,
) {
  if has_pending_exception(env) {
    return;
  }
  let Some(holder_ref) = env_registration::disposed_objects(env) else {
    return;
  };
  let mut holder = ptr::null_mut();
  if unsafe { sys::napi_get_reference_value(env, holder_ref, &mut holder) } != sys::Status::napi_ok
    || holder.is_null()
  {
    clear_pending_exception(env);
    return;
  }
  let mut map = ptr::null_mut();
  let mut set_fn = ptr::null_mut();
  let mut id_val = ptr::null_mut();
  let mut ignored = ptr::null_mut();
  let ok = unsafe {
    sys::napi_get_named_property(env, holder, c"map".as_ptr(), &mut map) == sys::Status::napi_ok
      && sys::napi_get_named_property(env, holder, c"set".as_ptr(), &mut set_fn)
        == sys::Status::napi_ok
      && sys::napi_create_uint32(env, class_id.get(), &mut id_val) == sys::Status::napi_ok
      && sys::napi_call_function(env, map, set_fn, 2, [val, id_val].as_ptr(), &mut ignored)
        == sys::Status::napi_ok
  };
  if !ok {
    clear_pending_exception(env);
  }
}

/// Checks whether an unwrapped/detached JS value `val` is a previously disposed
/// instance of class `T`.
///
/// On napi8 native builds this verifies the unforgeable object type tag (which
/// survives `napi_remove_wrap` and `Object.setPrototypeOf(res, null)`, and is
/// absent on `Object.create(Cls.prototype)`). On wasm and pre-napi8 builds this
/// checks the per-env `WeakMap` recorded at disposal time by exact JS object
/// identity.
unsafe fn is_disposed_class_instance<T: MaybeTypeTag>(
  env: sys::napi_env,
  val: sys::napi_value,
) -> Result<bool> {
  let mut value_type = 0;
  check_status!(
    unsafe { sys::napi_typeof(env, val, &mut value_type) },
    "Failed to check value type"
  )?;
  if value_type != sys::ValueType::napi_object {
    return Ok(false);
  }
  #[cfg(all(feature = "napi8", not(target_family = "wasm")))]
  {
    let mut matches = false;
    check_status!(
      unsafe { sys::napi_check_object_type_tag(env, val, &T::type_tag(), &mut matches) },
      "type tag check failed"
    )?;
    Ok(matches)
  }
  #[cfg(not(all(feature = "napi8", not(target_family = "wasm"))))]
  {
    if has_pending_exception(env) {
      return Err(Error::from_status(Status::PendingException));
    }
    let Some(expected_id) = class_identity::existing_class_id_of::<T>() else {
      return Ok(false);
    };
    let Some(holder_ref) = env_registration::disposed_objects(env) else {
      return Ok(false);
    };
    let mut holder = ptr::null_mut();
    if unsafe { sys::napi_get_reference_value(env, holder_ref, &mut holder) }
      != sys::Status::napi_ok
      || holder.is_null()
    {
      clear_pending_exception(env);
      return Ok(false);
    }
    let mut map = ptr::null_mut();
    let mut get_fn = ptr::null_mut();
    let mut result = ptr::null_mut();
    let ok = unsafe {
      sys::napi_get_named_property(env, holder, c"map".as_ptr(), &mut map) == sys::Status::napi_ok
        && sys::napi_get_named_property(env, holder, c"get".as_ptr(), &mut get_fn)
          == sys::Status::napi_ok
        && sys::napi_call_function(env, map, get_fn, 1, &val, &mut result) == sys::Status::napi_ok
    };
    if !ok {
      clear_pending_exception(env);
      return Ok(false);
    }
    if napi_value_type(env, result) != Some(sys::ValueType::napi_number) {
      return Ok(false);
    }
    let mut actual_id = 0u32;
    if unsafe { sys::napi_get_value_uint32(env, result, &mut actual_id) } != sys::Status::napi_ok {
      clear_pending_exception(env);
      return Ok(false);
    }
    Ok(actual_id == expected_id.get())
  }
}

/// Maps a `napi_unwrap` failure to a disposed-instance error when `T` is a
/// `#[napi(disposable)]` class and `napi_val` is a disposed instance of `T`.
/// Non-disposable classes preserve their exact existing error message.
///
/// # Safety
///
/// `env` must be a valid `napi_env` and `napi_val` a valid `napi_value` in `env`.
#[doc(hidden)]
#[cold]
pub unsafe fn map_class_unwrap_error<T: MaybeTypeTag>(
  env: sys::napi_env,
  napi_val: sys::napi_value,
  status: sys::napi_status,
  fallback_reason: impl FnOnce() -> String,
) -> Error {
  if status != sys::Status::napi_pending_exception {
    if let Some(js_name_nul) = disposable_class_js_name::<T>() {
      match unsafe { is_disposed_class_instance::<T>(env, napi_val) } {
        Ok(true) => {
          return Error::new(
            Status::InvalidArg,
            format!(
              "Instance of `{}` has already been disposed",
              js_name_nul.trim_end_matches('\0')
            ),
          );
        }
        Ok(false) => {}
        Err(err) if err.status == Status::PendingException => return err,
        Err(_) => {}
      }
    }
  }
  Error::new(Status::from(status), fallback_reason())
}

/// `[Symbol.dispose]()` implementation generated for `#[napi(disposable)]` classes.
///
/// Detaches the JS wrapper immediately via `napi_remove_wrap` (preventing both
/// future JS unwraps and double-drop at GC). If no Rust borrows, `ClassInstance`
/// pins, or `Reference<T>` handles are live, runs `ObjectFinalize::finalize` and
/// drops `T` synchronously; otherwise marks the `REFERENCE_MAP` entry disposed
/// and defers finalization until the last active hold releases.
///
/// # Safety
///
/// Must only be registered as the `[Symbol.dispose]` method of the `#[napi(disposable)]`
/// class `T`.
#[doc(hidden)]
pub unsafe fn dispose_class_instance<T: ObjectFinalize + MaybeTypeTag + 'static>(
  env: sys::napi_env,
  cb: sys::napi_callback_info,
  js_name_nul: &'static str,
) -> sys::napi_value {
  let _napi_native_borrow_barrier = NativeBorrowBarrier::new();
  match unsafe { dispose_class_instance_inner::<T>(env, cb, js_name_nul) } {
    Ok(val) => val,
    Err(err) => {
      unsafe { JsError::from(err).throw_into(env) };
      ptr::null_mut()
    }
  }
}

unsafe fn dispose_class_instance_inner<T: ObjectFinalize + MaybeTypeTag + 'static>(
  env: sys::napi_env,
  cb: sys::napi_callback_info,
  js_name_nul: &'static str,
) -> Result<sys::napi_value> {
  let mut this = ptr::null_mut();
  check_status!(
    unsafe { sys::napi_get_cb_info(env, cb, &mut 0, ptr::null_mut(), &mut this, ptr::null_mut()) },
    "Failed to initialize [Symbol.dispose] call"
  )?;

  let js_name = js_name_nul.trim_end_matches('\0');
  let mut wrapped_val: *mut c_void = ptr::null_mut();
  let unwrap_status = unsafe { sys::napi_unwrap(env, this, &mut wrapped_val) };
  if unwrap_status != sys::Status::napi_ok {
    if unwrap_status == sys::Status::napi_pending_exception {
      return Ok(ptr::null_mut());
    }
    if unsafe { is_disposed_class_instance::<T>(env, this)? } {
      // Already disposed: `[Symbol.dispose]()` is idempotent.
      let mut undef = ptr::null_mut();
      check_status!(
        unsafe { sys::napi_get_undefined(env, &mut undef) },
        "Failed to get undefined"
      )?;
      return Ok(undef);
    }
    return Err(class_identity::wrong_class_error(js_name));
  }

  // Validate class identity before detaching so a spoofed receiver of another
  // class or an untracked `env.wrap` object can never be removed or finalized as `T`.
  #[cfg(all(feature = "napi8", not(target_family = "wasm")))]
  unsafe {
    validate_type_tag(env, this, &T::type_tag(), js_name)?;
  }
  #[cfg(not(all(feature = "napi8", not(target_family = "wasm"))))]
  let disposed_class_id =
    class_identity::check_class_identity_for_dispose::<T>(wrapped_val, js_name)?;

  // Detach wrapper and reset the GC finalizer so GC will never run
  // `raw_finalize_unchecked` later, while preserving `object_ref` if any
  // `Reference<T>` still exists.
  let mut detached: *mut c_void = ptr::null_mut();
  check_status!(
    unsafe { sys::napi_remove_wrap(env, this, &mut detached) },
    "Failed to detach disposed instance of class `{}`",
    js_name
  )?;

  // Record exact JS object identity as disposed immediately after detaching
  // so re-entrant calls inside `ObjectFinalize::finalize` also observe it.
  #[cfg(not(all(feature = "napi8", not(target_family = "wasm"))))]
  unsafe {
    record_disposed_class_instance(env, this, disposed_class_id);
  }

  let has_live_refs = REFERENCE_MAP.with(|cell| {
    cell.borrow_mut(|map| {
      map.get(&wrapped_val).is_some_and(|entry| {
        let arc = std::mem::ManuallyDrop::new(unsafe { Arc::from_raw(entry.info.2) });
        Arc::strong_count(&arc) > 1
      })
    })
  });

  if native_borrow::schedule_or_defer_dispose(
    env,
    wrapped_val,
    has_live_refs,
    finalize_class_instance::<T>,
  ) {
    // Prevent `WeakReference<T>` from resurrecting the dying instance while
    // active borrows, `ClassInstance` pins, or `Reference<T>` handles remain.
    REFERENCE_MAP.with(|cell| {
      cell.borrow_mut(|map| {
        if let Some(entry) = map.get_mut(&wrapped_val) {
          entry.disposed = true;
        }
      })
    });
  } else {
    unsafe { finalize_class_instance::<T>(env, wrapped_val) }?;
  }

  let mut undef = ptr::null_mut();
  check_status!(
    unsafe { sys::napi_get_undefined(env, &mut undef) },
    "Failed to get undefined"
  )?;
  Ok(undef)
}

/// # Safety
///
/// called when node wrapper objects destroyed
#[doc(hidden)]
pub(crate) unsafe extern "C" fn raw_finalize_unchecked<T: ObjectFinalize>(
  env: sys::napi_env,
  finalize_data: *mut c_void,
  _finalize_hint: *mut c_void,
) {
  if let Err(err) = unsafe { finalize_class_instance::<T>(env, finalize_data) } {
    let e: JsError = err.into();
    unsafe { e.throw_into(env) };
  }
}

/// # Safety
///
/// called when node buffer is ready for gc
#[doc(hidden)]
pub unsafe extern "C" fn drop_buffer(
  _env: sys::napi_env,
  #[allow(unused)] finalize_data: *mut c_void,
  finalize_hint: *mut c_void,
) {
  #[cfg(all(debug_assertions, not(windows), not(target_family = "wasm")))]
  {
    js_values::BUFFER_DATA.with(|buffer_data| {
      let mut buffer = buffer_data.lock().expect("Unlock Buffer data failed");
      buffer.remove(&(finalize_data as *mut u8));
    });
  }
  unsafe {
    drop(Box::from_raw(finalize_hint as *mut Buffer));
  }
}

/// # Safety
///
/// called when node buffer slice is ready for gc
#[doc(hidden)]
pub unsafe extern "C" fn drop_buffer_slice(
  _env: sys::napi_env,
  finalize_data: *mut c_void,
  finalize_hint: *mut c_void,
) {
  let (len, cap): (usize, usize) = *unsafe { Box::from_raw(finalize_hint.cast()) };
  #[cfg(all(debug_assertions, not(windows), not(target_family = "wasm")))]
  {
    js_values::BUFFER_DATA.with(|buffer_data| {
      let mut buffer = buffer_data.lock().expect("Unlock Buffer data failed");
      buffer.remove(&(finalize_data as *mut u8));
    });
  }
  if finalize_data.is_null() {
    return;
  }
  unsafe {
    drop(Vec::from_raw_parts(finalize_data, len, cap));
  }
}

/// Create an object with properties
///
/// Uses `napi_create_object` + `napi_define_properties`, which gives a plain object
/// (`Object.prototype`, fast properties, one shared map per shape).
/// `node_api_create_object_with_properties` is not used: V8 builds its objects in
/// dictionary mode, which makes every property read much slower (nodejs/node#66441).
#[doc(hidden)]
#[cfg(not(feature = "noop"))]
#[inline]
pub unsafe fn create_object_with_properties(
  env: sys::napi_env,
  properties: &[sys::napi_property_descriptor],
) -> Result<sys::napi_value> {
  use crate::check_status;

  let mut obj_ptr = std::ptr::null_mut();
  check_status!(
    sys::napi_create_object(env, &mut obj_ptr),
    "Failed to create object",
  )?;

  if !properties.is_empty() {
    check_status!(
      sys::napi_define_properties(env, obj_ptr, properties.len(), properties.as_ptr()),
      "Failed to define properties",
    )?;
  }

  Ok(obj_ptr)
}

#[doc(hidden)]
#[cfg(feature = "noop")]
pub unsafe fn create_object_with_properties(
  _env: sys::napi_env,
  _properties: &[sys::napi_property_descriptor],
) -> Result<sys::napi_value> {
  Ok(std::ptr::null_mut())
}

#[cfg(test)]
mod tests {
  use std::panic::panic_any;

  use super::catch_unwind_safely;

  struct PanickingPanicPayload;

  impl Drop for PanickingPanicPayload {
    fn drop(&mut self) {
      panic!("nested panic payload destructor");
    }
  }

  #[test]
  fn catch_unwind_safely_forgets_panicking_panic_payloads() {
    catch_unwind_safely(|| panic_any(PanickingPanicPayload));
  }
}
