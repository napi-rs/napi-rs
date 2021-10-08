use std::ops::{Deref, DerefMut};
use std::{mem, ptr};

use crate::{bindgen_prelude::*, check_status, sys, Result, ValueType};

/// zero copy u8 vector shared between rust and napi
pub struct Buffer {
  raw: Option<sys::napi_value>,
  inner: mem::ManuallyDrop<Vec<u8>>,
}

impl From<Vec<u8>> for Buffer {
  fn from(data: Vec<u8>) -> Self {
    Buffer {
      raw: None,
      inner: mem::ManuallyDrop::new(data),
    }
  }
}

impl From<&[u8]> for Buffer {
  fn from(inner: &[u8]) -> Self {
    Buffer::from(inner.to_owned())
  }
}

impl AsRef<[u8]> for Buffer {
  fn as_ref(&self) -> &[u8] {
    self.inner.as_slice()
  }
}

impl AsMut<[u8]> for Buffer {
  fn as_mut(&mut self) -> &mut [u8] {
    self.inner.as_mut_slice()
  }
}

impl Deref for Buffer {
  type Target = [u8];

  fn deref(&self) -> &[u8] {
    self.inner.as_slice()
  }
}

impl DerefMut for Buffer {
  fn deref_mut(&mut self) -> &mut Self::Target {
    self.inner.as_mut_slice()
  }
}

impl TypeName for Buffer {
  fn type_name() -> &'static str {
    "Vec<u8>"
  }
}

impl FromNapiValue for Buffer {
  unsafe fn from_napi_value(env: sys::napi_env, napi_val: sys::napi_value) -> Result<Self> {
    let mut buf = ptr::null_mut();
    let mut len = 0;

    check_status!(
      sys::napi_get_buffer_info(env, napi_val, &mut buf, &mut len as *mut usize),
      "Failed to convert napi buffer into rust Vec<u8>"
    )?;

    Ok(Self {
      raw: Some(napi_val),
      inner: mem::ManuallyDrop::new(Vec::from_raw_parts(buf as *mut _, len, len)),
    })
  }
}

impl ToNapiValue for Buffer {
  unsafe fn to_napi_value(env: sys::napi_env, mut val: Self) -> Result<sys::napi_value> {
    match val.raw {
      Some(raw) => Ok(raw),
      None => {
        let len = val.inner.len();
        let mut ret = ptr::null_mut();
        check_status!(
          sys::napi_create_external_buffer(
            env,
            len,
            val.inner.as_mut_ptr() as *mut _,
            Some(drop_buffer),
            Box::into_raw(Box::new((len, val.inner.capacity()))) as *mut _,
            &mut ret,
          ),
          "Failed to create napi buffer"
        )?;

        Ok(ret)
      }
    }
  }
}

impl ValidateNapiValue for Buffer {
  fn type_of() -> Vec<ValueType> {
    vec![ValueType::Object]
  }
}
