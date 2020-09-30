use std::mem;
use std::ops::Deref;
use std::ptr;

use super::Value;
use crate::error::check_status;
use crate::{sys, JsUnknown, Ref, Result};

#[repr(transparent)]
#[derive(Debug, Clone, Copy)]
pub struct JsArrayBuffer(pub(crate) Value);

#[derive(Debug)]
pub struct JsArrayBufferValue {
  pub(crate) value: JsArrayBuffer,
  data: mem::ManuallyDrop<Vec<u8>>,
}

impl JsArrayBuffer {
  pub fn into_value(self) -> Result<JsArrayBufferValue> {
    let mut data = ptr::null_mut();
    let mut len: u64 = 0;
    check_status(unsafe {
      sys::napi_get_arraybuffer_info(self.0.env, self.0.value, &mut data, &mut len)
    })?;
    Ok(JsArrayBufferValue {
      data: mem::ManuallyDrop::new(unsafe {
        Vec::from_raw_parts(data as *mut _, len as usize, len as usize)
      }),
      value: self,
    })
  }

  #[inline]
  pub fn into_ref(self) -> Result<Ref<JsArrayBufferValue>> {
    Ref::new(self.0, 1, self.into_value()?)
  }
}

impl JsArrayBufferValue {
  pub fn new(value: JsArrayBuffer, data: Vec<u8>) -> Self {
    JsArrayBufferValue {
      value,
      data: mem::ManuallyDrop::new(data),
    }
  }

  pub fn into_raw(self) -> JsArrayBuffer {
    self.value
  }

  pub fn into_unknown(self) -> Result<JsUnknown> {
    self.value.into_unknown()
  }
}

impl AsRef<[u8]> for JsArrayBufferValue {
  fn as_ref(&self) -> &[u8] {
    self.data.as_slice()
  }
}

impl Deref for JsArrayBufferValue {
  type Target = [u8];

  fn deref(&self) -> &[u8] {
    self.data.as_slice()
  }
}
