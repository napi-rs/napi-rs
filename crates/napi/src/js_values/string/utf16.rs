use std::convert::TryFrom;
use std::ffi::c_void;
use std::ops::Deref;

use crate::{bindgen_runtime::ToNapiValue, sys, Error, JsString, Result, Status};

#[cfg(feature = "napi10")]
use crate::Env;

pub struct JsStringUtf16<'env> {
  pub(crate) inner: JsString<'env>,
  pub(crate) buf: &'env [u16],
}

impl<'env> JsStringUtf16<'env> {
  #[cfg(feature = "napi10")]
  /// Try to create a new JavaScript utf16 string from a Rust `Vec<u16>` without copying the data
  pub fn from_data(env: &'env Env, data: Vec<u16>) -> Result<JsStringUtf16<'env>> {
    use std::{mem, ptr};

    use crate::{check_status, Value, ValueType};

    if data.is_empty() {
      return Err(Error::new(
        Status::InvalidArg,
        "Cannot create external string from empty data".to_owned(),
      ));
    }

    let mut raw_value = ptr::null_mut();
    let mut copied = false;
    let data_ptr = data.as_ptr();
    let len = data.len();
    let finalize_hint = Box::into_raw(Box::new(len));

    check_status!(
      unsafe {
        sys::node_api_create_external_string_utf16(
          env.0,
          data_ptr,
          len as isize,
          Some(drop_utf16_string),
          finalize_hint.cast(),
          &mut raw_value,
          &mut copied,
        )
      },
      "Failed to create external string utf16"
    )?;

    if copied {
      // If the data was copied, the finalizer won't be called
      // We need to clean up the finalize_hint and let the Vec be dropped
      unsafe {
        let _ = Box::from_raw(finalize_hint);
      }
      // The original Vec will be dropped normally
    } else {
      // Only forget the data if it wasn't copied
      // The finalizer will handle cleanup
      mem::forget(data);
    }

    Ok(Self {
      inner: JsString(
        Value {
          env: env.0,
          value: raw_value,
          value_type: ValueType::String,
        },
        std::marker::PhantomData,
      ),
      buf: if copied {
        // If copied, we can't reference the original data
        // Create an empty slice as the data is now owned by V8
        &[]
      } else {
        unsafe { std::slice::from_raw_parts(data_ptr.cast(), len) }
      },
    })
  }

  #[cfg(feature = "napi10")]
  /// ## Safety
  ///
  /// The caller must ensure that the data pointer is valid for the lifetime of the string
  /// and that the finalize callback properly cleans up the data.
  ///
  /// Provided `finalize_callback` will be called when the string is garbage collected.
  ///
  /// ### Notes
  ///
  /// JavaScript may not support external strings in some environments (like Electron)
  /// in which case the data will be copied.
  pub unsafe fn from_external<T: 'env, F: FnOnce(Env, T)>(
    env: &'env Env,
    data: *const u16,
    len: usize,
    finalize_hint: T,
    finalize_callback: F,
  ) -> Result<JsStringUtf16<'env>> {
    use std::ptr;

    use crate::{check_status, Value, ValueType};

    if data.is_null() {
      return Err(Error::new(
        Status::InvalidArg,
        "Data pointer should not be null".to_owned(),
      ));
    }

    let hint_ptr = Box::into_raw(Box::new((finalize_hint, finalize_callback)));
    let mut raw_value = ptr::null_mut();
    let mut copied = false;

    let status = unsafe {
      sys::node_api_create_external_string_utf16(
        env.0,
        data,
        len as isize,
        Some(finalize_with_custom_callback::<T, F>),
        hint_ptr.cast(),
        &mut raw_value,
        &mut copied,
      )
    };

    if copied {
      // If the data was copied, we need to call the finalizer immediately
      let (hint, finalize) = *Box::from_raw(hint_ptr);
      finalize(*env, hint);
    }

    check_status!(status, "Failed to create external string utf16")?;

    Ok(Self {
      inner: JsString(
        Value {
          env: env.0,
          value: raw_value,
          value_type: ValueType::String,
        },
        std::marker::PhantomData,
      ),
      buf: unsafe { std::slice::from_raw_parts(data, len) },
    })
  }

  pub fn as_str(&self) -> Result<String> {
    if let Some((_, prefix)) = self.as_slice().split_last() {
      String::from_utf16(prefix).map_err(|e| Error::new(Status::InvalidArg, format!("{e}")))
    } else {
      Ok(String::new())
    }
  }

  pub fn as_slice(&self) -> &[u16] {
    self.buf
  }

  pub fn len(&self) -> usize {
    self.buf.len()
  }

  pub fn is_empty(&self) -> bool {
    self.buf.is_empty()
  }

  pub fn into_value(self) -> JsString<'env> {
    self.inner
  }
}

impl TryFrom<JsStringUtf16<'_>> for String {
  type Error = Error;

  fn try_from(value: JsStringUtf16) -> Result<String> {
    value.as_str()
  }
}

impl Deref for JsStringUtf16<'_> {
  type Target = [u16];

  fn deref(&self) -> &[u16] {
    self.buf
  }
}

impl AsRef<[u16]> for JsStringUtf16<'_> {
  fn as_ref(&self) -> &[u16] {
    self.buf
  }
}

impl From<JsStringUtf16<'_>> for Vec<u16> {
  fn from(value: JsStringUtf16) -> Self {
    value.as_slice().to_vec()
  }
}

impl ToNapiValue for JsStringUtf16<'_> {
  unsafe fn to_napi_value(_: sys::napi_env, val: JsStringUtf16) -> Result<sys::napi_value> {
    Ok(val.inner.0.value)
  }
}

#[cfg(feature = "napi10")]
extern "C" fn drop_utf16_string(
  _: sys::node_api_basic_env,
  finalize_data: *mut c_void,
  finalize_hint: *mut c_void,
) {
  let size: usize = unsafe { *Box::from_raw(finalize_data.cast()) };
  let data: Vec<u16> = unsafe { Vec::from_raw_parts(finalize_hint.cast(), size, size) };
  drop(data);
}

#[cfg(feature = "napi10")]
extern "C" fn finalize_with_custom_callback<T, F: FnOnce(Env, T)>(
  env: sys::node_api_basic_env,
  _finalize_data: *mut c_void,
  finalize_hint: *mut c_void,
) {
  let (hint, callback) = unsafe { *Box::from_raw(finalize_hint as *mut (T, F)) };
  callback(Env(env.cast()), hint);
}
