use std::convert::TryFrom;
use std::ops::Deref;
use std::ptr;
use std::slice;

use super::{JsObject, JsUnknown, NapiValue, Value, ValueType};
use crate::error::check_status;
use crate::{sys, Error, Result};

#[derive(Debug)]
pub struct JsBuffer {
  pub value: JsObject,
  pub data: &'static [u8],
}

impl JsBuffer {
  pub(crate) fn from_raw_unchecked(
    env: sys::napi_env,
    value: sys::napi_value,
    data: *mut u8,
    len: usize,
  ) -> Self {
    Self {
      value: JsObject(Value {
        env,
        value,
        value_type: ValueType::Object,
      }),
      data: unsafe { slice::from_raw_parts_mut(data, len) },
    }
  }

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
    check_status(unsafe { sys::napi_get_buffer_info(env, value, &mut data, &mut len) })?;
    Ok(JsBuffer {
      value: JsObject(Value {
        env,
        value,
        value_type: ValueType::Object,
      }),
      data: unsafe { slice::from_raw_parts_mut(data as *mut _, len as usize) },
    })
  }
}

impl AsRef<[u8]> for JsBuffer {
  fn as_ref(&self) -> &[u8] {
    self.data
  }
}

impl Deref for JsBuffer {
  type Target = [u8];

  fn deref(&self) -> &[u8] {
    self.data
  }
}

impl TryFrom<JsUnknown> for JsBuffer {
  type Error = Error;
  fn try_from(value: JsUnknown) -> Result<JsBuffer> {
    JsBuffer::from_raw(value.0.env, value.0.value)
  }
}
