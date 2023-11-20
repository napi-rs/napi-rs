#[cfg(all(debug_assertions, not(windows)))]
use std::collections::HashSet;
use std::ffi::c_void;
use std::mem;
use std::ops::{Deref, DerefMut};
use std::ptr::{self, NonNull};
use std::slice;
use std::sync::Arc;
#[cfg(all(debug_assertions, not(windows)))]
use std::sync::Mutex;

#[cfg(all(feature = "napi4", not(feature = "noop"), not(target_family = "wasm")))]
use crate::bindgen_prelude::{CUSTOM_GC_TSFN, CUSTOM_GC_TSFN_DESTROYED, THREADS_CAN_ACCESS_ENV};
use crate::{bindgen_prelude::*, check_status, sys, Result, ValueType};

#[cfg(all(debug_assertions, not(windows)))]
thread_local! {
  pub (crate) static BUFFER_DATA: Mutex<HashSet<*mut u8>> = Default::default();
}

/// Zero copy u8 vector shared between rust and napi.
/// Auto reference the raw JavaScript value, and release it when dropped.
/// So it is safe to use it in `async fn`, the `&[u8]` under the hood will not be dropped until the `drop` called.
/// Clone will create a new `Reference` to the same underlying `JavaScript Buffer`.
pub struct Buffer {
  pub(crate) inner: NonNull<u8>,
  pub(crate) len: usize,
  pub(crate) capacity: usize,
  raw: Option<(sys::napi_ref, sys::napi_env)>,
  pub(crate) ref_count: Arc<()>,
}

impl Drop for Buffer {
  fn drop(&mut self) {
    if Arc::strong_count(&self.ref_count) == 1 {
      if let Some((ref_, env)) = self.raw {
        if ref_.is_null() {
          return;
        }
        #[cfg(all(feature = "napi4", not(feature = "noop"), not(target_family = "wasm")))]
        {
          if CUSTOM_GC_TSFN_DESTROYED.load(std::sync::atomic::Ordering::SeqCst) {
            return;
          }
          if !THREADS_CAN_ACCESS_ENV.borrow_mut(|m| m.get(&std::thread::current().id()).is_some()) {
            let status = unsafe {
              sys::napi_call_threadsafe_function(
                CUSTOM_GC_TSFN.load(std::sync::atomic::Ordering::SeqCst),
                ref_.cast(),
                1,
              )
            };
            assert!(
              status == sys::Status::napi_ok || status == sys::Status::napi_closing,
              "Call custom GC in Buffer::drop failed {}",
              Status::from(status)
            );
            return;
          }
        }
        let mut ref_count = 0;
        check_status_or_throw!(
          env,
          unsafe { sys::napi_reference_unref(env, ref_, &mut ref_count) },
          "Failed to unref Buffer reference in drop"
        );
        debug_assert!(
          ref_count == 0,
          "Buffer reference count in Buffer::drop is not zero"
        );
        check_status_or_throw!(
          env,
          unsafe { sys::napi_delete_reference(env, ref_) },
          "Failed to delete Buffer reference in drop"
        );
      } else {
        unsafe { Vec::from_raw_parts(self.inner.as_ptr(), self.len, self.capacity) };
      }
    }
  }
}

// SAFETY: This is undefined behavior, as the JS side may always modify the underlying buffer,
// without synchronization. Also see the docs for the `AsMut` impl.
unsafe impl Send for Buffer {}

impl Clone for Buffer {
  fn clone(&self) -> Self {
    Self {
      inner: self.inner,
      len: self.len,
      capacity: self.capacity,
      raw: self.raw,
      ref_count: self.ref_count.clone(),
    }
  }
}

impl Default for Buffer {
  fn default() -> Self {
    Self::from(Vec::default())
  }
}

impl From<Vec<u8>> for Buffer {
  fn from(mut data: Vec<u8>) -> Self {
    let inner_ptr = data.as_mut_ptr();
    #[cfg(all(debug_assertions, not(windows)))]
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
      // SAFETY: `Vec`'s docs guarantee that its pointer is never null (it's a dangling ptr if not
      // allocated):
      // > The pointer will never be null, so this type is null-pointer-optimized.
      inner: unsafe { NonNull::new_unchecked(inner_ptr) },
      len,
      capacity,
      raw: None,
      ref_count: Arc::new(()),
    }
  }
}

impl From<Buffer> for Vec<u8> {
  fn from(buf: Buffer) -> Self {
    buf.as_ref().to_vec()
  }
}

impl From<&[u8]> for Buffer {
  fn from(inner: &[u8]) -> Self {
    Buffer::from(inner.to_owned())
  }
}

impl AsRef<[u8]> for Buffer {
  fn as_ref(&self) -> &[u8] {
    // SAFETY: the pointer is guaranteed to be non-null, and guaranteed to be valid if `len` is not 0.
    unsafe { slice::from_raw_parts(self.inner.as_ptr(), self.len) }
  }
}

impl AsMut<[u8]> for Buffer {
  fn as_mut(&mut self) -> &mut [u8] {
    // SAFETY: This is literally undefined behavior. `Buffer::clone` allows you to create shared
    // access to the underlying data, but `as_mut` and `deref_mut` allow unsynchronized mutation of
    // that data (not to speak of the JS side having write access as well, at the same time).
    unsafe { slice::from_raw_parts_mut(self.inner.as_ptr(), self.len) }
  }
}

impl Deref for Buffer {
  type Target = [u8];

  fn deref(&self) -> &Self::Target {
    self.as_ref()
  }
}

impl DerefMut for Buffer {
  fn deref_mut(&mut self) -> &mut Self::Target {
    self.as_mut()
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
      "Failed to get Buffer pointer and length"
    )?;

    // From the docs of `napi_get_buffer_info`:
    // > [out] data: The underlying data buffer of the node::Buffer. If length is 0, this may be
    // > NULL or any other pointer value.
    //
    // In order to guarantee that `slice::from_raw_parts` is sound, the pointer must be non-null, so
    // let's make sure it always is, even in the case of `napi_get_buffer_info` returning a null
    // ptr.
    let buf = NonNull::new(buf as *mut u8);
    let inner = match buf {
      Some(buf) if len != 0 => buf,
      _ => NonNull::dangling(),
    };

    Ok(Self {
      inner,
      len,
      capacity: len,
      raw: Some((ref_, env)),
      ref_count: Arc::new(()),
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
      // fast path for Buffer::drop
      if Arc::strong_count(&val.ref_count) == 1 {
        check_status!(
          unsafe { sys::napi_delete_reference(env, ref_) },
          "Failed to delete Buffer reference in Buffer::to_napi_value"
        )?;
        val.raw = Some((ptr::null_mut(), ptr::null_mut()));
      }
      return Ok(buf);
    }
    let len = val.len;
    let mut ret = ptr::null_mut();
    check_status!(
      if len == 0 {
        // Rust uses 0x1 as the data pointer for empty buffers,
        // but NAPI/V8 only allows multiple buffers to have
        // the same data pointer if it's 0x0.
        unsafe { sys::napi_create_buffer(env, len, ptr::null_mut(), &mut ret) }
      } else {
        let value_ptr = val.inner.as_ptr();
        let val_box_ptr = Box::into_raw(Box::new(val));
        let mut status = unsafe {
          sys::napi_create_external_buffer(
            env,
            len,
            value_ptr as *mut c_void,
            Some(drop_buffer),
            val_box_ptr as *mut c_void,
            &mut ret,
          )
        };
        if status == napi_sys::Status::napi_no_external_buffers_allowed {
          let value = unsafe { Box::from_raw(val_box_ptr) };
          status = unsafe {
            sys::napi_create_buffer_copy(
              env,
              len,
              value.inner.as_ptr() as *mut c_void,
              ptr::null_mut(),
              &mut ret,
            )
          };
        }
        status
      },
      "Failed to create napi buffer"
    )?;

    Ok(ret)
  }
}

impl ToNapiValue for &Buffer {
  unsafe fn to_napi_value(env: sys::napi_env, val: Self) -> Result<sys::napi_value> {
    let buf = val.clone();
    unsafe { ToNapiValue::to_napi_value(env, buf) }
  }
}

impl ToNapiValue for &mut Buffer {
  unsafe fn to_napi_value(env: sys::napi_env, val: Self) -> Result<sys::napi_value> {
    let buf = val.clone();
    unsafe { ToNapiValue::to_napi_value(env, buf) }
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
