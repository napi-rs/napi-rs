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

/// Checks whether `val` is a JS object belonging to class `T`.
///
/// On napi8 native builds this verifies the unforgeable type tag (which survives
/// `napi_remove_wrap`); on wasm and pre-napi8 builds it checks `napi_instanceof`
/// against the class constructor registered for `env`.
#[allow(clippy::extra_unused_type_parameters)]
unsafe fn is_matching_class_instance<T: MaybeTypeTag>(
  env: sys::napi_env,
  val: sys::napi_value,
  js_name_nul: &'static str,
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
    let _ = js_name_nul;
    let mut matches = false;
    check_status!(
      unsafe { sys::napi_check_object_type_tag(env, val, &T::type_tag(), &mut matches) },
      "type tag check failed"
    )?;
    Ok(matches)
  }
  #[cfg(not(all(feature = "napi8", not(target_family = "wasm"))))]
  {
    let Some(ctor_ref) = get_class_constructor_in_env(env, js_name_nul) else {
      return Ok(false);
    };
    let mut ctor = ptr::null_mut();
    check_status!(
      unsafe { sys::napi_get_reference_value(env, ctor_ref, &mut ctor) },
      "Failed to get constructor reference"
    )?;
    if ctor.is_null() {
      return Ok(false);
    }
    let mut is_instance_of = false;
    check_status!(
      unsafe { sys::napi_instanceof(env, val, ctor, &mut is_instance_of) },
      "Failed to check instanceof"
    )?;
    Ok(is_instance_of)
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
      match unsafe { is_matching_class_instance::<T>(env, napi_val, js_name_nul) } {
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
    if unsafe { is_matching_class_instance::<T>(env, this, js_name_nul)? } {
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
  // class can never be removed or finalized as `T`.
  #[cfg(all(feature = "napi8", not(target_family = "wasm")))]
  unsafe {
    validate_type_tag(env, this, &T::type_tag(), js_name)?;
  }
  #[cfg(not(all(feature = "napi8", not(target_family = "wasm"))))]
  {
    let matched_recorded =
      class_identity::check_class_identity_for_dispose::<T>(wrapped_val, js_name)?;
    if !matched_recorded && !unsafe { is_matching_class_instance::<T>(env, this, js_name_nul)? } {
      return Err(class_identity::wrong_class_error(js_name));
    }
  }

  // Detach wrapper and reset the GC finalizer so GC will never run
  // `raw_finalize_unchecked` later, while preserving `object_ref` if any
  // `Reference<T>` still exists.
  let mut detached: *mut c_void = ptr::null_mut();
  check_status!(
    unsafe { sys::napi_remove_wrap(env, this, &mut detached) },
    "Failed to detach disposed instance of class `{}`",
    js_name
  )?;

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
