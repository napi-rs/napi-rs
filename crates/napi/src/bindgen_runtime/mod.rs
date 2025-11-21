use std::ffi::c_void;
use std::rc::Rc;

pub use callback_info::*;
pub use ctor::ctor;
pub use env::*;
pub use iterator::Generator;
pub use js_values::*;
pub use module_register::*;

use super::sys;
use crate::{check_status, JsError, Result, Status};

#[cfg(feature = "tokio_rt")]
pub mod async_iterator;
mod callback_info;
mod env;
mod error;
pub mod iterator;
mod js_values;
mod module_register;

pub trait ObjectFinalize: Sized {
  #[allow(unused)]
  fn finalize(self, env: Env) -> Result<()> {
    Ok(())
  }
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
  let data: Box<T> = unsafe { Box::from_raw(finalize_data.cast()) };
  if let Err(err) = data.finalize(Env::from_raw(env)) {
    let e: JsError = err.into();
    unsafe { e.throw_into(env) };
    return;
  }
  if let Some((_, ref_val, finalize_callbacks_ptr)) =
    REFERENCE_MAP.with(|cell| cell.borrow_mut(|reference_map| reference_map.remove(&finalize_data)))
  {
    let finalize_callbacks_rc = unsafe { Rc::from_raw(finalize_callbacks_ptr) };

    #[cfg(all(debug_assertions, not(target_family = "wasm")))]
    {
      let rc_strong_count = Rc::strong_count(&finalize_callbacks_rc);
      // If `Rc` strong count is 2, it means the finalize of referenced `Object` is called before the `fn drop` of the `Reference`
      // It always happened on exiting process
      // In general, the `fn drop` would happen first
      if rc_strong_count != 1 && rc_strong_count != 2 {
        eprintln!("Rc strong count is: {rc_strong_count}, it should be 1 or 2");
      }
    }
    let finalize = unsafe { Box::from_raw(finalize_callbacks_rc.get()) };
    finalize();
    let delete_reference_status = unsafe { sys::napi_delete_reference(env, ref_val) };
    debug_assert!(
      delete_reference_status == sys::Status::napi_ok,
      "Delete reference in finalize callback failed {}",
      Status::from(delete_reference_status)
    );
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
  #[cfg(all(debug_assertions, not(windows)))]
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
  #[cfg(all(debug_assertions, not(windows)))]
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
/// Uses `node_api_create_object_with_properties` when available (Node.js 22+),
/// otherwise falls back to `napi_create_object` + `napi_set_named_property`
///
/// The optimized path using `node_api_create_object_with_properties` is only enabled when:
/// - `napi10` feature is enabled (provides the FFI binding)
/// - `node_version_detect` feature is enabled (allows runtime version check)
/// - `dyn-symbols` feature is enabled (allows safe runtime symbol loading)
///
/// Without `dyn-symbols`, the optimized API would require symbols that don't exist in
/// Node.js < 22, causing module load failures. With `dyn-symbols`, missing symbols are
/// handled gracefully at runtime.
#[doc(hidden)]
#[inline]
pub unsafe fn create_object_with_properties(
  env: sys::napi_env,
  properties: &[sys::napi_property_descriptor],
) -> Result<sys::napi_value> {
  let mut obj_ptr = std::ptr::null_mut();

  // Use the optimized API only when dyn-symbols is enabled for safe runtime loading
  #[cfg(all(
    feature = "napi10",
    feature = "node_version_detect",
    feature = "dyn-symbols"
  ))]
  {
    use crate::bindgen_prelude::NODE_VERSION_MAJOR;
    if !properties.is_empty() && NODE_VERSION_MAJOR >= 22 {
      check_status!(
        sys::node_api_create_object_with_properties(
          env,
          &mut obj_ptr,
          properties.len(),
          properties.as_ptr(),
        ),
        "Failed to create object with properties",
      )?;
      return Ok(obj_ptr);
    }
  }

  // Fallback path: create object then set properties one by one
  check_status!(
    sys::napi_create_object(env, &mut obj_ptr),
    "Failed to create object",
  )?;

  for prop in properties {
    check_status!(
      sys::napi_set_named_property(env, obj_ptr, prop.utf8name, prop.value,),
      "Failed to set property",
    )?;
  }

  Ok(obj_ptr)
}
