#[cfg(feature = "napi10")]
use std::ffi::c_void;
#[cfg(feature = "napi10")]
use std::sync::Arc;

use crate::{bindgen_prelude::ToNapiValue, sys, JsString, Result};

#[cfg(feature = "napi10")]
use crate::Env;

pub struct JsStringLatin1<'env> {
  pub(crate) inner: JsString<'env>,
  pub(crate) buf: &'env [u8],
  pub(crate) _inner_buf: Vec<u8>,
  #[cfg(feature = "napi10")]
  pub(crate) _shared_buf: Option<Arc<Vec<u8>>>,
}

impl<'env> JsStringLatin1<'env> {
  #[cfg(feature = "napi10")]
  /// Try to create a new JavaScript latin1 string from a Rust `Vec<u8>` without copying the data
  /// ## Behavior
  ///
  /// The `copied` parameter in the underlying `node_api_create_external_string_latin1` call
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
  /// - Invalid Latin-1 encoding that requires sanitization
  /// - Platform doesn't support external strings
  /// - Memory alignment issues with the provided buffer
  ///
  /// The `copied` parameter serves as feedback to understand whether the external string
  /// optimization was successful or if V8 fell back to traditional string creation.
  pub fn from_data(env: &'env Env, data: Vec<u8>) -> Result<JsStringLatin1<'env>> {
    use std::ptr;

    use crate::{check_status, Error, Status, Value, ValueType};

    if data.is_empty() {
      return Err(Error::new(
        Status::InvalidArg,
        "Cannot create external string from empty data".to_owned(),
      ));
    }

    let shared_buf = Arc::new(data);
    let mut raw_value = ptr::null_mut();
    let mut copied = false;
    let data_ptr = shared_buf.as_ptr();
    let len = shared_buf.len();
    // Keep one strong reference on the Rust side and transfer another to Node.
    // If V8 copies the string and runs the finalizer immediately, Rust still has
    // a valid view of the bytes without cloning the full buffer first.
    let finalize_hint = Arc::into_raw(Arc::clone(&shared_buf));

    let status = unsafe {
      sys::node_api_create_external_string_latin1(
        env.0,
        data_ptr.cast(),
        len as isize,
        Some(drop_latin1_string),
        finalize_hint.cast_mut().cast(),
        &mut raw_value,
        &mut copied,
      )
    };

    if status != sys::Status::napi_ok {
      unsafe {
        drop(Arc::from_raw(finalize_hint));
      }
    }

    check_status!(status, "Failed to create external string latin1")?;

    Ok(Self {
      inner: JsString(
        Value {
          env: env.0,
          value: raw_value,
          value_type: ValueType::String,
        },
        std::marker::PhantomData,
      ),
      buf: unsafe { std::slice::from_raw_parts(data_ptr, len) },
      _inner_buf: vec![],
      _shared_buf: Some(shared_buf),
    })
  }

  #[cfg(feature = "napi10")]
  /// Creates an external Latin-1 string from raw data with a custom finalize callback.
  ///
  /// ## Safety
  ///
  /// The caller must ensure that:
  /// - The data pointer is valid for the lifetime of the string
  /// - The finalize callback properly cleans up the data
  ///
  /// ## Behavior
  ///
  /// The `copied` parameter in the underlying `node_api_create_external_string_latin1` call
  /// indicates whether the string data was copied into V8's heap rather than being used
  /// as an external reference.
  ///
  /// ### When `copied` is `true`:
  /// - String data is copied to V8's heap
  /// - Finalizer is invoked during string creation if provided
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
  /// - Invalid Latin-1 encoding that requires sanitization
  /// - Platform doesn't support external strings
  /// - Memory alignment issues with the provided buffer
  ///
  /// The `copied` parameter serves as feedback to understand whether the external string
  /// optimization was successful or if V8 fell back to traditional string creation.
  pub unsafe fn from_external<T: 'env, F: FnOnce(Env, T) + 'env>(
    env: &'env Env,
    data: *const u8,
    len: usize,
    finalize_hint: T,
    finalize_callback: F,
  ) -> Result<JsStringLatin1<'env>> {
    use std::{ptr, slice};

    use crate::{check_status, Error, Status, Value, ValueType};

    if data.is_null() {
      return Err(Error::new(
        Status::InvalidArg,
        "Data pointer should not be null".to_owned(),
      ));
    }

    let fallback_buf = unsafe { slice::from_raw_parts(data, len) }.to_vec();
    let hint_ptr = Box::into_raw(Box::new((finalize_hint, finalize_callback)));
    let mut raw_value = ptr::null_mut();
    let mut copied = false;

    let status = unsafe {
      sys::node_api_create_external_string_latin1(
        env.0,
        data.cast(),
        len as isize,
        Some(finalize_with_custom_callback::<T, F>),
        hint_ptr.cast(),
        &mut raw_value,
        &mut copied,
      )
    };

    if status != sys::Status::napi_ok && !copied {
      unsafe {
        drop(Box::from_raw(hint_ptr));
      }
    }

    check_status!(status, "Failed to create external string latin1")?;

    let inner_buf = if copied { fallback_buf } else { vec![] };
    let buf_ptr = if copied { inner_buf.as_ptr() } else { data };

    Ok(Self {
      inner: JsString(
        Value {
          env: env.0,
          value: raw_value,
          value_type: ValueType::String,
        },
        std::marker::PhantomData,
      ),
      buf: unsafe { std::slice::from_raw_parts(buf_ptr, len) },
      _inner_buf: inner_buf,
      _shared_buf: None,
    })
  }

  #[cfg(feature = "napi10")]
  pub fn from_static(env: &'env Env, string: &'static str) -> Result<JsStringLatin1<'env>> {
    use std::ptr;

    use crate::{check_status, Error, Status, Value, ValueType};

    if string.is_empty() {
      return Err(Error::new(
        Status::InvalidArg,
        "Data pointer should not be null".to_owned(),
      ));
    }

    let mut raw_value = ptr::null_mut();
    let mut copied = false;

    check_status!(
      unsafe {
        sys::node_api_create_external_string_latin1(
          env.0,
          string.as_ptr().cast(),
          string.len() as isize,
          None,
          ptr::null_mut(),
          &mut raw_value,
          &mut copied,
        )
      },
      "Failed to create external string latin1"
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
      buf: string.as_bytes(),
      _inner_buf: vec![],
      _shared_buf: None,
    })
  }

  pub fn as_slice(&self) -> &[u8] {
    self.buf
  }

  pub fn len(&self) -> usize {
    self.buf.len()
  }

  pub fn is_empty(&self) -> bool {
    self.buf.is_empty()
  }

  pub fn take(self) -> Vec<u8> {
    self.as_slice().to_vec()
  }

  pub fn into_value(self) -> JsString<'env> {
    self.inner
  }

  #[cfg(feature = "latin1")]
  pub fn into_latin1_string(self) -> Result<String> {
    let mut dst_str = unsafe { String::from_utf8_unchecked(vec![0; self.len() * 2 + 1]) };
    encoding_rs::mem::convert_latin1_to_str(self.buf, dst_str.as_mut_str());
    Ok(dst_str)
  }
}

impl From<JsStringLatin1<'_>> for Vec<u8> {
  fn from(value: JsStringLatin1) -> Self {
    value.take()
  }
}

impl ToNapiValue for JsStringLatin1<'_> {
  unsafe fn to_napi_value(_: sys::napi_env, val: JsStringLatin1) -> Result<sys::napi_value> {
    Ok(val.inner.0.value)
  }
}

#[cfg(feature = "napi10")]
extern "C" fn drop_latin1_string(
  _: sys::node_api_basic_env,
  _: *mut c_void,
  finalize_hint: *mut c_void,
) {
  if finalize_hint.is_null() {
    return;
  }
  drop(unsafe { Arc::from_raw(finalize_hint.cast::<Vec<u8>>()) });
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
