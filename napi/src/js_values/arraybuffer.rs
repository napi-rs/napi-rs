use std::convert::TryFrom;
use std::ptr;

use super::{JsNumber, JsObject, JsString, JsUnknown, NapiValue, Status, Value, ValueType};
use crate::error::check_status;
use crate::{sys, Error, Result};

#[derive(Debug)]
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

  #[inline]
  pub fn into_unknown(self) -> Result<JsUnknown> {
    JsUnknown::from_raw(self.value.0.env, self.value.0.value)
  }

  #[inline]
  pub fn coerce_to_number(self) -> Result<JsNumber> {
    let mut new_raw_value = ptr::null_mut();
    check_status(unsafe {
      sys::napi_coerce_to_number(self.value.0.env, self.value.0.value, &mut new_raw_value)
    })?;
    Ok(JsNumber(Value {
      env: self.value.0.env,
      value: new_raw_value,
      value_type: ValueType::Number,
    }))
  }

  #[inline]
  pub fn coerce_to_string(self) -> Result<JsString> {
    let mut new_raw_value = ptr::null_mut();
    check_status(unsafe {
      sys::napi_coerce_to_string(self.value.0.env, self.value.0.value, &mut new_raw_value)
    })?;
    Ok(JsString(Value {
      env: self.value.0.env,
      value: new_raw_value,
      value_type: ValueType::String,
    }))
  }
  #[inline]
  pub fn coerce_to_object(self) -> Result<JsObject> {
    let mut new_raw_value = ptr::null_mut();
    check_status(unsafe {
      sys::napi_coerce_to_object(self.value.0.env, self.value.0.value, &mut new_raw_value)
    })?;
    Ok(JsObject(Value {
      env: self.value.0.env,
      value: new_raw_value,
      value_type: ValueType::Object,
    }))
  }

  #[inline]
  #[cfg(napi5)]
  pub fn is_date(&self) -> Result<bool> {
    let mut is_date = true;
    check_status(unsafe { sys::napi_is_date(self.value.0.env, self.value.0.value, &mut is_date) })?;
    Ok(is_date)
  }

  #[inline]
  pub fn is_error(&self) -> Result<bool> {
    let mut result = false;
    check_status(unsafe { sys::napi_is_error(self.value.0.env, self.value.0.value, &mut result) })?;
    Ok(result)
  }

  #[inline]
  pub fn is_typedarray(&self) -> Result<bool> {
    let mut result = false;
    check_status(unsafe {
      sys::napi_is_typedarray(self.value.0.env, self.value.0.value, &mut result)
    })?;
    Ok(result)
  }

  #[inline]
  pub fn is_dataview(&self) -> Result<bool> {
    let mut result = false;
    check_status(unsafe {
      sys::napi_is_dataview(self.value.0.env, self.value.0.value, &mut result)
    })?;
    Ok(result)
  }

  #[inline]
  pub fn is_array(&self) -> Result<bool> {
    let mut is_array = false;
    check_status(unsafe {
      sys::napi_is_array(self.value.0.env, self.value.0.value, &mut is_array)
    })?;
    Ok(is_array)
  }

  #[inline]
  pub fn is_buffer(&self) -> Result<bool> {
    let mut is_buffer = false;
    check_status(unsafe {
      sys::napi_is_buffer(self.value.0.env, self.value.0.value, &mut is_buffer)
    })?;
    Ok(is_buffer)
  }

  #[inline]
  pub fn instanceof<Constructor: NapiValue>(&self, constructor: Constructor) -> Result<bool> {
    let mut result = false;
    check_status(unsafe {
      sys::napi_instanceof(
        self.value.0.env,
        self.value.0.value,
        constructor.raw(),
        &mut result,
      )
    })?;
    Ok(result)
  }
}

impl NapiValue for JsArrayBuffer {
  fn raw(&self) -> sys::napi_value {
    self.value.0.value
  }

  fn from_raw(env: sys::napi_env, value: sys::napi_value) -> Result<Self> {
    let mut data = ptr::null_mut();
    let mut len: u64 = 0;
    check_status(unsafe { sys::napi_get_arraybuffer_info(env, value, &mut data, &mut len) })?;
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

  fn from_raw_unchecked(env: sys::napi_env, value: sys::napi_value) -> Self {
    let mut data = ptr::null_mut();
    let mut len: u64 = 0;
    let status = unsafe { sys::napi_get_arraybuffer_info(env, value, &mut data, &mut len) };
    debug_assert!(
      Status::from(status) == Status::Ok,
      "napi_get_arraybuffer_info failed"
    );
    JsArrayBuffer {
      value: JsObject(Value {
        env,
        value,
        value_type: ValueType::Object,
      }),
      data: data as *const u8,
      len,
    }
  }
}

impl TryFrom<JsUnknown> for JsArrayBuffer {
  type Error = Error;
  fn try_from(value: JsUnknown) -> Result<JsArrayBuffer> {
    JsArrayBuffer::from_raw(value.0.env, value.0.value)
  }
}
