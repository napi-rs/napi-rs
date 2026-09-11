use std::any::{type_name, TypeId};
use std::collections::HashSet;
use std::ffi::c_void;
use std::ptr;
use std::sync::{LazyLock, Mutex};

use crate::{check_status, sys, Error, Result, Status};

#[repr(C)]
pub struct TaggedObject<T> {
  type_id: TypeId,
  pub(crate) object: Option<T>,
}

impl<T: 'static> TaggedObject<T> {
  pub fn new(object: T) -> Self {
    TaggedObject {
      type_id: TypeId::of::<T>(),
      object: Some(object),
    }
  }
}

/// Live payloads wrapped by `Object::wrap`/`Env::wrap`. `napi_unwrap` and
/// `napi_remove_wrap` hand back an untyped payload pointer, so before reading
/// a wrapped object's payload as `TaggedObject<T>` the pointer must be in this
/// set: `#[napi]` class instances wrap a bare `*mut T` instead, and their
/// first bytes are not a `TaggedObject` header. Pure-JS code has no way to
/// insert into the set, so the check holds on every N-API version and on wasm.
/// Entries are inserted after a successful `napi_wrap` and removed by
/// `remove_wrapped`/`drop_wrapped` and by the wrap finalizer.
static WRAPPED_OBJECT_PAYLOADS: LazyLock<Mutex<HashSet<usize>>> =
  LazyLock::new(|| Mutex::new(HashSet::new()));

pub(crate) fn register_payload(ptr: *mut c_void) {
  WRAPPED_OBJECT_PAYLOADS.lock().unwrap().insert(ptr as usize);
}

pub(crate) fn unregister_payload(ptr: *mut c_void) {
  WRAPPED_OBJECT_PAYLOADS
    .lock()
    .unwrap()
    .remove(&(ptr as usize));
}

fn is_registered_payload(ptr: *const c_void) -> bool {
  WRAPPED_OBJECT_PAYLOADS
    .lock()
    .unwrap()
    .contains(&(ptr as usize))
}

/// Wrap finalizer for `Object::wrap`/`Env::wrap` payloads: deregister the
/// payload before freeing it, so the registry never outlives the allocation.
pub(crate) unsafe extern "C" fn finalize_tagged_object<T>(
  env: sys::napi_env,
  finalize_data: *mut c_void,
  finalize_hint: *mut c_void,
) {
  unregister_payload(finalize_data);
  unsafe { crate::raw_finalize::<TaggedObject<T>>(env, finalize_data, finalize_hint) }
}

/// Shared validation for `Object::unwrap`/`remove_wrapped` and their
/// compat-mode `Env` twins: peek the payload wrapped in `obj` and confirm it
/// is a live `TaggedObject<T>` produced by `Object::wrap`/`Env::wrap` before
/// any in-memory `TypeId` read on the payload pointer.
///
/// Registry membership proves this binary wrapped the payload and that it was
/// not detached or finalized since, so the header read below stays within the
/// allocation. The `TypeId` comparison then pins down `T`: the registry keys
/// on the pointer alone, which cannot tell apart payloads of different types;
/// `TypeId` can (including same-named types from different crate versions).
///
/// Returns the validated payload pointer. Callers either borrow it (`unwrap`)
/// or detach it with `napi_remove_wrap` and free it (`remove_wrapped`).
///
/// # Safety
///
/// `env` must be a valid napi env pointer and `obj` a valid js object. The
/// returned pointer is owned by the wrap; it must not be freed except after a
/// successful `napi_remove_wrap`.
pub(crate) unsafe fn unwrap_tagged_object<T: 'static>(
  env: sys::napi_env,
  obj: sys::napi_value,
) -> Result<*mut TaggedObject<T>> {
  let mut payload: *mut c_void = ptr::null_mut();
  check_status!(
    unsafe { sys::napi_unwrap(env, obj, &mut payload) },
    "Failed to unwrap value of the Object"
  )?;
  let invalid_arg = || {
    Error::new(
      Status::InvalidArg,
      format!(
        "Invalid argument, {} on unwrap is not the type of wrapped object",
        type_name::<T>()
      ),
    )
  };
  if payload.is_null() {
    return Err(invalid_arg());
  }
  if !is_registered_payload(payload) {
    return Err(invalid_arg());
  }
  let type_id = payload as *const TypeId;
  if unsafe { *type_id } == TypeId::of::<T>() {
    Ok(payload as *mut TaggedObject<T>)
  } else {
    Err(invalid_arg())
  }
}
