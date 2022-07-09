#[cfg(debug_assertions)]
use std::collections::HashSet;
use std::ffi::c_void;
use std::mem;
use std::ops::{Deref, DerefMut};
use std::ptr;
use std::slice;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
#[cfg(debug_assertions)]
use std::sync::Mutex;

use crate::{bindgen_prelude::*, check_status, sys, Result, ValueType};

#[cfg(debug_assertions)]
thread_local! {
  pub (crate) static BUFFER_DATA: Mutex<HashSet<*mut u8>> = Default::default();
}

/// Zero copy u8 vector shared between rust and napi.
/// Auto reference the raw JavaScript value, and release it when dropped.
/// So it is safe to use it in `async fn`, the `&[u8]` under the hood will not be dropped until the `drop` called.
/// Clone will create a new `Reference` to the same underlying `JavaScript Buffer`.
pub struct Buffer {
  pub(crate) inner: &'static mut [u8],
  pub(crate) capacity: usize,
  raw: Option<(sys::napi_ref, sys::napi_env)>,
  // use it as ref count
  pub(crate) drop_in_vm: Arc<AtomicBool>,
}

impl Drop for Buffer {
  fn drop(&mut self) {
    if Arc::strong_count(&self.drop_in_vm) == 1 {
      if let Some((ref_, env)) = self.raw {
        check_status_or_throw!(
          env,
          unsafe { sys::napi_reference_unref(env, ref_, &mut 0) },
          "Failed to unref Buffer reference in drop"
        );
        return;
      }
      // Drop in Rust side
      // ```rust
      // #[napi]
      // fn buffer_len() -> u32 {
      //     Buffer::from(vec![1, 2, 3]).len() as u32
      // }
      if !self.drop_in_vm.load(Ordering::Acquire) {
        unsafe { Vec::from_raw_parts(self.inner.as_mut_ptr(), self.inner.len(), self.capacity) };
      }
    }
  }
}

unsafe impl Send for Buffer {}

impl Buffer {
  pub fn clone(&mut self, env: &Env) -> Result<Self> {
    let raw = if let Some((ref_, _)) = self.raw {
      check_status!(
        unsafe { sys::napi_reference_ref(env.0, ref_, &mut 0) },
        "Failed to ref Buffer reference in Buffer::clone"
      )?;
      Some((ref_, env.0))
    } else {
      None
    };
    Ok(Self {
      inner: unsafe { slice::from_raw_parts_mut(self.inner.as_mut_ptr(), self.inner.len()) },
      capacity: self.capacity,
      raw,
      drop_in_vm: self.drop_in_vm.clone(),
    })
  }
}

impl From<Vec<u8>> for Buffer {
  fn from(mut data: Vec<u8>) -> Self {
    let inner_ptr = data.as_mut_ptr();
    #[cfg(debug_assertions)]
    {
      let is_existed = BUFFER_DATA.with(|buffer_data| {
        let buffer = buffer_data.lock().expect("Unlock buffer data failed");
        buffer.contains(&inner_ptr)
      });
      if is_existed {
        panic!("Share the same data between different buffers is not allowed, see: https://github.com/nodejs/node/issues/32463#issuecomment-631974747");
      }
    }
    let len = data.len();
    let capacity = data.capacity();
    mem::forget(data);
    Buffer {
      inner: unsafe { slice::from_raw_parts_mut(inner_ptr, len) },
      capacity,
      raw: None,
      drop_in_vm: Arc::new(AtomicBool::new(false)),
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
    self.inner
  }
}

impl AsMut<[u8]> for Buffer {
  fn as_mut(&mut self) -> &mut [u8] {
    self.inner
  }
}

impl Deref for Buffer {
  type Target = [u8];

  fn deref(&self) -> &Self::Target {
    self.inner
  }
}

impl DerefMut for Buffer {
  fn deref_mut(&mut self) -> &mut Self::Target {
    self.inner
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
      inner: unsafe { slice::from_raw_parts_mut(buf as *mut _, len) },
      capacity: len,
      raw: Some((ref_, env)),
      drop_in_vm: Arc::new(AtomicBool::new(true)),
    })
  }
}

impl ToNapiValue for Buffer {
  unsafe fn to_napi_value(env: sys::napi_env, val: Self) -> Result<sys::napi_value> {
    // From Node.js value, not from `Vec<u8>`
    if let Some((ref_, _)) = val.raw {
      let mut buf = ptr::null_mut();
      check_status!(
        unsafe { sys::napi_get_reference_value(env, ref_, &mut buf) },
        "Failed to get Buffer value from reference"
      )?;
      return Ok(buf);
    }
    let len = val.inner.len();
    val.drop_in_vm.store(true, Ordering::Release);
    let mut ret = ptr::null_mut();
    check_status!(
      if len == 0 {
        // Rust uses 0x1 as the data pointer for empty buffers,
        // but NAPI/V8 only allows multiple buffers to have
        // the same data pointer if it's 0x0.
        unsafe { sys::napi_create_buffer(env, len, ptr::null_mut(), &mut ret) }
      } else {
        let val_ptr = val.inner.as_mut_ptr();
        unsafe {
          sys::napi_create_external_buffer(
            env,
            len,
            val_ptr as *mut c_void,
            Some(drop_buffer),
            Box::into_raw(Box::new(val)) as *mut c_void,
            &mut ret,
          )
        }
      },
      "Failed to create napi buffer"
    )?;

    Ok(ret)
  }
}

impl ToNapiValue for &mut Buffer {
  unsafe fn to_napi_value(env: sys::napi_env, val: Self) -> Result<sys::napi_value> {
    // From Node.js value, not from `Vec<u8>`
    if let Some((ref_, _)) = val.raw {
      let mut buf = ptr::null_mut();
      check_status!(
        unsafe { sys::napi_get_reference_value(env, ref_, &mut buf) },
        "Failed to get Buffer value from reference"
      )?;
      Ok(buf)
    } else {
      let buf = Buffer {
        inner: unsafe { slice::from_raw_parts_mut(val.inner.as_mut_ptr(), val.capacity) },
        capacity: val.capacity,
        raw: None,
        drop_in_vm: Arc::new(AtomicBool::new(true)),
      };
      unsafe { ToNapiValue::to_napi_value(env, buf) }
    }
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
