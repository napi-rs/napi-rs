use std::ptr;

use super::{JsObject, NapiValue, Value, ValueType};
use crate::error::check_status;
use crate::{sys, Result};

#[derive(Clone, Copy, Debug)]
pub struct JsArrayBuffer {
  pub value: JsObject,
  pub data: *const u8,
  pub len: u64,
}

impl JsArrayBuffer {
  pub(crate) fn from_raw_unchecked(env: sys::napi_env, value: sys::napi_value) -> Self {
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

impl NapiValue for JsArrayBuffer {
  fn raw_value(&self) -> sys::napi_value {
    self.value.0.value
  }

  fn from_raw(env: sys::napi_env, value: sys::napi_value) -> Result<Self> {
    let mut data = ptr::null_mut();
    let mut len: u64 = 0;
    let status = unsafe { sys::napi_get_arraybuffer_info(env, value, &mut data, &mut len) };
    check_status(status)?;
    Ok(JsArrayBuffer {
      value: JsObject(Value {
        env,
        value,
        value_type: ValueType::Object,
      }),
      data: data as *const u8,
      len,
    })
  }
}
