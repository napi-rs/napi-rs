use std::ops::{Deref, DerefMut};
use std::{mem, ptr};

use crate::{bindgen_prelude::*, check_status, sys, Result, ValueType};

/// Zero copy u8 vector shared between rust and napi.
/// Auto reference the raw JavaScript value, and release it when dropped.
/// So it is safe to use it in `async fn`, the `&[u8]` under the hood will not be dropped until the `drop` called.
pub struct Buffer {
  inner: mem::ManuallyDrop<Vec<u8>>,
  raw: Option<(sys::napi_ref, sys::napi_env)>,
}

impl Drop for Buffer {
  fn drop(&mut self) {
    if let Some((ref_, env)) = self.raw {
      check_status_or_throw!(
        env,
        unsafe { sys::napi_delete_reference(env, ref_) },
        "Failed to delete Buffer reference in drop"
      );
    }
  }
}

unsafe impl Send for Buffer {}

impl From<Vec<u8>> for Buffer {
  fn from(data: Vec<u8>) -> Self {
    Buffer {
      inner: mem::ManuallyDrop::new(data),
      raw: None,
    }
  }
}

impl From<Buffer> for Vec<u8> {
  fn from(buf: Buffer) -> Self {
    buf.inner.to_vec()
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

  fn deref(&self) -> &Self::Target {
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

  fn value_type() -> ValueType {
    ValueType::Object
  }
}

impl FromNapiValue for Buffer {
  unsafe fn from_napi_value(env: sys::napi_env, napi_val: sys::napi_value) -> Result<Self> {
    let mut buf = ptr::null_mut();
    let mut len = 0;
    let mut ref_ = ptr::null_mut();
    check_status!(
      unsafe { sys::napi_create_reference(env, napi_val, 1, &mut ref_) },
      "Failed to create reference from Buffer"
    )?;
    check_status!(
      unsafe { sys::napi_get_buffer_info(env, napi_val, &mut buf, &mut len as *mut usize) },
      "Failed to convert napi buffer into rust Vec<u8>"
    )?;

    Ok(Self {
      inner: mem::ManuallyDrop::new(unsafe { Vec::from_raw_parts(buf as *mut _, len, len) }),
      raw: Some((ref_, env)),
    })
  }
}

impl ToNapiValue for Buffer {
  unsafe fn to_napi_value(env: sys::napi_env, mut val: Self) -> Result<sys::napi_value> {
    // From Node.js value, not from `Vec<u8>`
    if let Some((ref_, _)) = val.raw {
      let mut buf = ptr::null_mut();
      check_status!(
        unsafe { sys::napi_get_reference_value(env, ref_, &mut buf) },
        "Failed to get Buffer value from reference"
      )?;
      check_status!(
        unsafe { sys::napi_delete_reference(env, ref_) },
        "Failed to delete Buffer reference"
      )?;
      val.raw = None; // Prevent double free
      return Ok(buf);
    }
    let len = val.inner.len();
    let mut ret = ptr::null_mut();
    check_status!(
      unsafe {
        sys::napi_create_external_buffer(
          env,
          len,
          val.inner.as_mut_ptr() as *mut _,
          Some(drop_buffer),
          Box::into_raw(Box::new((len, val.inner.capacity()))) as *mut _,
          &mut ret,
        )
      },
      "Failed to create napi buffer"
    )?;

    Ok(ret)
  }
}

impl ValidateNapiValue for Buffer {
  unsafe fn validate(env: sys::napi_env, napi_val: sys::napi_value) -> Result<sys::napi_value> {
    let mut is_buffer = false;
    check_status!(
      unsafe { sys::napi_is_buffer(env, napi_val, &mut is_buffer) },
      "Failed to validate napi buffer"
    )?;
    if !is_buffer {
      return Err(Error::new(
        Status::InvalidArg,
        "Expected a Buffer value".to_owned(),
      ));
    }
    Ok(ptr::null_mut())
  }
}
