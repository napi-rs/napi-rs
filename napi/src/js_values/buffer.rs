use std::mem;
use std::ops::Deref;
use std::ptr;

use super::Value;
#[cfg(feature = "serde-json")]
use super::ValueType;
use crate::error::check_status;
use crate::{sys, JsUnknown, NapiValue, Ref, Result};

#[repr(transparent)]
#[derive(Debug)]
pub struct JsBuffer(pub(crate) Value);

#[derive(Debug)]
pub struct JsBufferValue {
  pub(crate) value: JsBuffer,
  data: mem::ManuallyDrop<Vec<u8>>,
}

impl JsBuffer {
  pub fn into_value(self) -> Result<JsBufferValue> {
    let mut data = ptr::null_mut();
    let mut len: u64 = 0;
    check_status(unsafe {
      sys::napi_get_buffer_info(self.0.env, self.0.value, &mut data, &mut len)
    })?;
    Ok(JsBufferValue {
      data: mem::ManuallyDrop::new(unsafe {
        Vec::from_raw_parts(data as *mut _, len as usize, len as usize)
      }),
      value: self,
    })
  }

  #[inline]
  pub fn into_ref(self) -> Result<Ref<JsBufferValue>> {
    Ref::new(self.0, 1, self.into_value()?)
  }
}

impl JsBufferValue {
  #[cfg(feature = "serde-json")]
  pub(crate) fn from_raw(env: sys::napi_env, value: sys::napi_value) -> Result<Self> {
    let mut data = ptr::null_mut();
    let mut len: u64 = 0;
    check_status(unsafe { sys::napi_get_buffer_info(env, value, &mut data, &mut len) })?;
    Ok(Self {
      value: JsBuffer(Value {
        env,
        value,
        value_type: ValueType::Object,
      }),
      data: mem::ManuallyDrop::new(unsafe {
        Vec::from_raw_parts(data as *mut _, len as usize, len as usize)
      }),
    })
  }

  pub fn new(value: JsBuffer, data: Vec<u8>) -> Self {
    JsBufferValue {
      value,
      data: mem::ManuallyDrop::new(data),
    }
  }

  pub fn into_raw(self) -> JsBuffer {
    self.value
  }

  pub fn into_unknown(self) -> JsUnknown {
    JsUnknown::from_raw_unchecked(self.value.0.env, self.value.0.value)
  }
}

impl AsRef<[u8]> for JsBufferValue {
  fn as_ref(&self) -> &[u8] {
    self.data.as_slice()
  }
}

impl Deref for JsBufferValue {
  type Target = [u8];

  fn deref(&self) -> &[u8] {
    self.data.as_slice()
  }
}
