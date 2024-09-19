use std::mem;
use std::ops::{Deref, DerefMut};
use std::ptr;

use super::{Value, ValueType};
use crate::bindgen_runtime::ValidateNapiValue;
use crate::Env;
use crate::{
  bindgen_runtime::TypeName, check_status, sys, Error, JsUnknown, NapiValue, Ref, Result, Status,
};

#[deprecated(since = "3.0.0", note = "Please use Buffer or &[u8] instead")]
pub struct JsBuffer(pub(crate) Value);

impl TypeName for JsBuffer {
  fn type_name() -> &'static str {
    "Buffer"
  }

  fn value_type() -> ValueType {
    ValueType::Object
  }
}

impl ValidateNapiValue for JsBuffer {
  unsafe fn validate(env: sys::napi_env, napi_val: sys::napi_value) -> Result<sys::napi_value> {
    let mut is_buffer = false;
    check_status!(unsafe { sys::napi_is_buffer(env, napi_val, &mut is_buffer) })?;
    if !is_buffer {
      return Err(Error::new(
        Status::InvalidArg,
        "Value is not a buffer".to_owned(),
      ));
    }
    Ok(ptr::null_mut())
  }
}

#[deprecated(since = "3.0.0", note = "Please use Buffer or &[u8] instead")]
pub struct JsBufferValue {
  pub(crate) value: JsBuffer,
  data: mem::ManuallyDrop<Vec<u8>>,
}

impl JsBuffer {
  pub fn into_value(self) -> Result<JsBufferValue> {
    let mut data = ptr::null_mut();
    let mut len: usize = 0;
    check_status!(unsafe {
      sys::napi_get_buffer_info(self.0.env, self.0.value, &mut data, &mut len)
    })?;
    Ok(JsBufferValue {
      data: mem::ManuallyDrop::new(unsafe { Vec::from_raw_parts(data as *mut _, len, len) }),
      value: self,
    })
  }

  pub fn into_ref(self) -> Result<Ref<JsBuffer>> {
    Ref::new(&Env::from(self.0.env), &self)
  }
}

impl JsBufferValue {
  pub fn new(value: JsBuffer, data: mem::ManuallyDrop<Vec<u8>>) -> Self {
    JsBufferValue { value, data }
  }

  pub fn into_raw(self) -> JsBuffer {
    self.value
  }

  pub fn into_unknown(self) -> JsUnknown {
    unsafe { JsUnknown::from_raw_unchecked(self.value.0.env, self.value.0.value) }
  }
}

impl AsRef<[u8]> for JsBufferValue {
  fn as_ref(&self) -> &[u8] {
    self.data.as_slice()
  }
}

impl AsMut<[u8]> for JsBufferValue {
  fn as_mut(&mut self) -> &mut [u8] {
    self.data.as_mut_slice()
  }
}

impl Deref for JsBufferValue {
  type Target = [u8];

  fn deref(&self) -> &Self::Target {
    self.data.as_slice()
  }
}

impl DerefMut for JsBufferValue {
  fn deref_mut(&mut self) -> &mut Self::Target {
    self.data.as_mut_slice()
  }
}
