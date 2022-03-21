use std::ffi::c_void;
use std::mem;

pub use callback_info::*;
pub use ctor::ctor;
pub use env::*;
pub use js_values::*;
pub use module_register::*;

use super::sys;

mod callback_info;
mod env;
mod error;
mod js_values;
mod module_register;

/// # Safety
///
/// called when node wrapper objects destroyed
pub unsafe extern "C" fn raw_finalize_unchecked<T>(
  _env: sys::napi_env,
  finalize_data: *mut c_void,
  _finalize_hint: *mut c_void,
) {
  unsafe { Box::from_raw(finalize_data as *mut T) };
}

/// # Safety
///
/// called when node buffer is ready for gc
pub unsafe extern "C" fn drop_buffer(
  _env: sys::napi_env,
  finalize_data: *mut c_void,
  finalize_hint: *mut c_void,
) {
  let length_ptr = finalize_hint as *mut (usize, usize);
  unsafe {
    let (length, cap) = *Box::from_raw(length_ptr);
    mem::drop(Vec::from_raw_parts(finalize_data as *mut u8, length, cap));
  }
}
