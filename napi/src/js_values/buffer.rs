use std::cell::RefCell;
use std::ffi::c_void;
use std::mem;
use std::ops::{Deref, DerefMut};
use std::ptr;
use std::slice;

use super::{JsObject, JsUnknown, NapiValue, Value, ValueType};
use crate::error::check_status;
use crate::{sys, Env, Error, Result, Status};

#[derive(Clone, Debug)]
pub struct NativeBuffer {
  inner: *mut u8,
  capacity: Option<usize>,
  consumed: RefCell<bool>,
}

impl NativeBuffer {
  #[inline]
  pub fn new() -> Self {
    let mut data = Vec::new();
    let inner = data.as_mut_ptr();
    mem::forget(data);
    Self {
      inner,
      capacity: None,
      consumed: RefCell::new(false),
    }
  }

  #[inline]
  pub fn with_capacity(capacity: usize) -> Self {
    let mut data = Vec::with_capacity(capacity);
    let inner = data.as_mut_ptr();
    mem::forget(data);
    Self {
      inner,
      capacity: Some(capacity),
      consumed: RefCell::new(false),
    }
  }

  #[inline]
  fn len(&self) -> usize {
    self.capacity.or_else(|| Some(self.deref().len())).unwrap()
  }

  #[inline]
  pub fn into_js_buffer(self, env: &Env) -> Result<JsBuffer> {
    if *self.consumed.borrow_mut() {
      return Err(Error::new(Status::GenericFailure, "The data under the NativeBuffer has already been moved into JsBuffer, you can not call `into_js_buffer` on it's cloned".to_owned()));
    }
    let length = self.len() as u64;
    let mut raw_value = ptr::null_mut();
    let raw_data = self.inner;
    *self.consumed.borrow_mut() = true;
    check_status(unsafe {
      sys::napi_create_external_buffer(
        env.0,
        length,
        raw_data as *mut _,
        Some(drop_buffer),
        Box::leak(Box::new(self)) as *mut NativeBuffer as *mut _,
        &mut raw_value,
      )
    })?;
    let mut changed = 0;
    check_status(unsafe { sys::napi_adjust_external_memory(env.0, length as i64, &mut changed) })?;
    let mut buffer = JsBuffer::from_raw_unchecked(env.0, raw_value);
    buffer.data = raw_data as *const u8;
    buffer.len = length;
    Ok(buffer)
  }
}

impl AsRef<[u8]> for NativeBuffer {
  fn as_ref(&self) -> &[u8] {
    self.deref()
  }
}

impl Deref for NativeBuffer {
  type Target = [u8];

  fn deref(&self) -> &[u8] {
    unsafe { slice::from_raw_parts(self.inner, self.len()) }
  }
}

impl DerefMut for NativeBuffer {
  fn deref_mut(&mut self) -> &mut [u8] {
    unsafe { slice::from_raw_parts_mut(self.inner as *mut _, self.len()) }
  }
}

unsafe impl Send for NativeBuffer {}

#[derive(Clone, Copy, Debug)]
pub struct JsBuffer {
  pub value: JsObject,
  pub data: *const u8,
  pub len: u64,
}

impl JsBuffer {
  pub fn into_unknown(self) -> Result<JsUnknown> {
    self.value.into_unknown()
  }
}

impl NapiValue for JsBuffer {
  fn raw_value(&self) -> sys::napi_value {
    self.value.0.value
  }

  fn from_raw(env: sys::napi_env, value: sys::napi_value) -> Result<Self> {
    let mut data = ptr::null_mut();
    let mut len: u64 = 0;
    let status = unsafe { sys::napi_get_buffer_info(env, value, &mut data, &mut len) };
    check_status(status)?;
    Ok(JsBuffer {
      value: JsObject(Value {
        env,
        value,
        value_type: ValueType::Object,
      }),
      data: data as *const u8,
      len,
    })
  }

  fn from_raw_unchecked(env: sys::napi_env, value: sys::napi_value) -> Self {
    Self {
      value: JsObject(Value {
        env,
        value,
        value_type: ValueType::Object,
      }),
      data: ptr::null(),
      len: 0,
    }
  }
}

impl AsRef<[u8]> for JsBuffer {
  fn as_ref(&self) -> &[u8] {
    self.deref()
  }
}

impl AsMut<[u8]> for JsBuffer {
  fn as_mut(&mut self) -> &mut [u8] {
    self.deref_mut()
  }
}

impl Deref for JsBuffer {
  type Target = [u8];

  fn deref(&self) -> &[u8] {
    unsafe { slice::from_raw_parts(self.data, self.len as usize) }
  }
}

impl DerefMut for JsBuffer {
  fn deref_mut(&mut self) -> &mut [u8] {
    unsafe { slice::from_raw_parts_mut(self.data as *mut _, self.len as usize) }
  }
}

pub unsafe extern "C" fn drop_buffer(
  env: sys::napi_env,
  finalize_data: *mut c_void,
  len: *mut c_void,
) {
  let length = Box::from_raw(len as *mut u64);
  let length = *length as usize;
  let _ = Vec::from_raw_parts(finalize_data as *mut u8, length, length);
  let mut changed = 0;
  let adjust_external_memory_status =
    sys::napi_adjust_external_memory(env, -(length as i64), &mut changed);
  debug_assert!(Status::from(adjust_external_memory_status) == Status::Ok);
}
