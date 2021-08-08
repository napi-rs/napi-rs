mod callback_info;
mod error;
mod helper;
mod js_values;
mod module_register;

pub use callback_info::*;
pub use ctor::ctor;
pub use helper::*;
pub use js_values::*;
pub use module_register::*;

use super::sys;
use std::ffi::c_void;

/// # Safety
///
/// called when node wrapper objects destroyed
pub unsafe extern "C" fn raw_finalize_unchecked<T>(
  env: sys::napi_env,
  finalize_data: *mut c_void,
  finalize_hint: *mut c_void,
) {
  let obj = finalize_data as *mut T;
  Box::from_raw(obj);
  if !finalize_hint.is_null() {
    let size_hint = *Box::from_raw(finalize_hint as *mut Option<i64>);
    if let Some(changed) = size_hint {
      let mut adjusted = 0i64;
      let status = sys::napi_adjust_external_memory(env, -changed, &mut adjusted);
      debug_assert!(
        status == sys::Status::napi_ok,
        "Calling napi_adjust_external_memory failed"
      );
    };
  }
}
