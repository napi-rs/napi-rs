use std::convert::TryFrom;
#[cfg(feature = "napi10")]
use std::ffi::c_void;
use std::ops::Deref;

use crate::{bindgen_runtime::ToNapiValue, sys, Error, JsString, Result, Status};

#[cfg(feature = "napi10")]
use crate::Env;

pub struct JsStringUtf16<'env> {
  pub(crate) inner: JsString<'env>,
  pub(crate) buf: &'env [u16],
  pub(crate) _inner_buf: Vec<u16>,
}

impl<'env> JsStringUtf16<'env> {
  #[cfg(feature = "napi10")]
  /// Try to create a new JavaScript utf16 string from a Rust `Vec<u16>` without copying the data
  /// ## Behavior
  ///
  /// The `copied` parameter in the underlying `node_api_create_external_string_utf16` call
  /// indicates whether the string data was copied into V8's heap rather than being used
  /// as an external reference.
  ///
  /// ### When `copied` is `true`:
  /// - String data is copied to V8's heap
  /// - Finalizer is called immediately if provided
  /// - Original buffer can be freed after the call
  /// - Performance benefit of external strings is not achieved
  ///
  /// ### When `copied` is `false`:
  /// - V8 creates an external string that references the original buffer without copying
  /// - Original buffer must remain valid for the lifetime of the JS string
  /// - Finalizer called when string is garbage collected
  /// - Memory usage and copying overhead is reduced
  ///
  /// ## Common scenarios where `copied` is `true`:
  /// - String is too short (typically < 10-15 characters)
  /// - V8 heap is under memory pressure
  /// - V8 is running with pointer compression or sandbox features
  /// - Invalid UTF-16 encoding that requires sanitization
  /// - Platform doesn't support external strings
  /// - Memory alignment issues with the provided buffer
  ///
  /// The `copied` parameter serves as feedback to understand whether the external string
  /// optimization was successful or if V8 fell back to traditional string creation.
  pub fn from_data(env: &'env Env, data: Vec<u16>) -> Result<JsStringUtf16<'env>> {
    use std::mem;
    use std::ptr;

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

    let inner_buf = if copied {
      // If the data was copied, the finalizer won't be called
      // We need to clean up the finalize_hint and let the Vec be dropped
      unsafe {
        let _ = Box::from_raw(finalize_hint);
      };
      data
    } else {
      // Only forget the data if it wasn't copied
      // The finalizer will handle cleanup
      mem::forget(data);
      vec![]
    };

    Ok(Self {
      inner: JsString(
        Value {
          env: env.0,
          value: raw_value,
          value_type: ValueType::String,
        },
        std::marker::PhantomData,
      ),
      buf: unsafe { std::slice::from_raw_parts(data_ptr.cast(), len) },
      _inner_buf: inner_buf,
    })
  }

  #[cfg(feature = "napi10")]
  /// Creates an external UTF-16 string from raw data with a custom finalize callback.
  ///
  /// ## Safety
  ///
  /// The caller must ensure that:
  /// - The data pointer is valid for the lifetime of the string
  /// - The finalize callback properly cleans up the data
  ///
  /// ## Behavior
  ///
  /// The `copied` parameter in the underlying `node_api_create_external_string_utf16` call
  /// indicates whether the string data was copied into V8's heap rather than being used
  /// as an external reference.
  ///
  /// ### When `copied` is `true`:
  /// - String data is copied to V8's heap
  /// - Finalizer is called immediately if provided
  /// - Original buffer can be freed after the call
  /// - Performance benefit of external strings is not achieved
  ///
  /// ### When `copied` is `false`:
  /// - V8 creates an external string that references the original buffer without copying
  /// - Original buffer must remain valid for the lifetime of the JS string
  /// - Finalizer called when string is garbage collected
  /// - Memory usage and copying overhead is reduced
  ///
  /// ## Common scenarios where `copied` is `true`:
  /// - String is too short (typically < 10-15 characters)
  /// - V8 heap is under memory pressure
  /// - V8 is running with pointer compression or sandbox features
  /// - Invalid UTF-16 encoding that requires sanitization
  /// - Platform doesn't support external strings
  /// - Memory alignment issues with the provided buffer
  ///
  /// The `copied` parameter serves as feedback to understand whether the external string
  /// optimization was successful or if V8 fell back to traditional string creation.
  pub unsafe fn from_external<T: 'env, F: FnOnce(Env, T) + 'env>(
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

    check_status!(
      unsafe {
        sys::node_api_create_external_string_utf16(
          env.0,
          data,
          len as isize,
          Some(finalize_with_custom_callback::<T, F>),
          hint_ptr.cast(),
          &mut raw_value,
          &mut copied,
        )
      },
      "Failed to create external string utf16"
    )?;

    if copied {
      unsafe {
        let (hint, finalize) = *Box::from_raw(hint_ptr);
        finalize(*env, hint);
      }
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
      buf: unsafe { std::slice::from_raw_parts(data, len) },
      _inner_buf: vec![],
    })
  }

  #[cfg(feature = "napi10")]
  pub fn from_static(env: &'env Env, data: &'static [u16]) -> Result<JsStringUtf16<'env>> {
    use std::ptr;

    use crate::{check_status, Value, ValueType};

    if data.is_empty() {
      return Err(Error::new(
        Status::InvalidArg,
        "Data should not be empty".to_owned(),
      ));
    }

    let mut raw_value = ptr::null_mut();
    let mut copied = false;

    check_status!(
      unsafe {
        sys::node_api_create_external_string_utf16(
          env.0,
          data.as_ptr(),
          data.len() as isize,
          None,
          ptr::null_mut(),
          &mut raw_value,
          &mut copied,
        )
      },
      "Failed to create external string utf16"
    )?;

    Ok(Self {
      inner: JsString(
        Value {
          env: env.0,
          value: raw_value,
          value_type: ValueType::String,
        },
        std::marker::PhantomData,
      ),
      buf: data,
      _inner_buf: vec![],
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
  let size: usize = unsafe { *Box::from_raw(finalize_hint.cast()) };
  let data: Vec<u16> = unsafe { Vec::from_raw_parts(finalize_data.cast(), size, size) };
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
