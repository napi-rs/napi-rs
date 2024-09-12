use crate::{bindgen_prelude::*, check_status, check_status_and_type, sys, Error, Result, Status};

use std::ffi::{c_void, CStr};
use std::fmt::Display;
use std::mem;
use std::ops::Deref;
use std::ptr;

impl TypeName for String {
  fn type_name() -> &'static str {
    "String"
  }

  fn value_type() -> ValueType {
    ValueType::String
  }
}

impl ValidateNapiValue for String {}

impl ToNapiValue for &String {
  unsafe fn to_napi_value(env: sys::napi_env, val: Self) -> Result<sys::napi_value> {
    let mut ptr = ptr::null_mut();

    check_status!(
      unsafe { sys::napi_create_string_utf8(env, val.as_ptr() as *const _, val.len(), &mut ptr) },
      "Failed to convert rust `String` into napi `string`"
    )?;

    Ok(ptr)
  }
}

impl ToNapiValue for String {
  #[inline]
  unsafe fn to_napi_value(env: sys::napi_env, val: Self) -> Result<sys::napi_value> {
    #[allow(clippy::needless_borrows_for_generic_args)]
    unsafe {
      ToNapiValue::to_napi_value(env, &val)
    }
  }
}

impl FromNapiValue for String {
  unsafe fn from_napi_value(env: sys::napi_env, napi_val: sys::napi_value) -> Result<Self> {
    let mut len = 0;

    check_status_and_type!(
      unsafe { sys::napi_get_value_string_utf8(env, napi_val, ptr::null_mut(), 0, &mut len) },
      env,
      napi_val,
      "Failed to convert JavaScript value `{}` into rust type `String`"
    )?;

    // end char len in C
    len += 1;
    let mut ret = Vec::with_capacity(len);
    let buf_ptr = ret.as_mut_ptr();

    let mut written_char_count = 0;

    check_status_and_type!(
      unsafe {
        sys::napi_get_value_string_utf8(env, napi_val, buf_ptr, len, &mut written_char_count)
      },
      env,
      napi_val,
      "Failed to convert napi `{}` into rust type `String`"
    )?;

    let mut ret = mem::ManuallyDrop::new(ret);
    let buf_ptr = ret.as_mut_ptr();
    let bytes = unsafe { Vec::from_raw_parts(buf_ptr as *mut u8, written_char_count, len) };
    Ok(unsafe { String::from_utf8_unchecked(bytes) })
  }
}

impl TypeName for &str {
  fn type_name() -> &'static str {
    "String"
  }

  fn value_type() -> ValueType {
    ValueType::String
  }
}

impl ValidateNapiValue for &str {}

impl FromNapiValue for &str {
  unsafe fn from_napi_value(env: sys::napi_env, napi_val: sys::napi_value) -> Result<Self> {
    let mut len = 0;

    check_status_and_type!(
      unsafe { sys::napi_get_value_string_utf8(env, napi_val, ptr::null_mut(), 0, &mut len) },
      env,
      napi_val,
      "Failed to convert napi `{}` into rust type `String`"
    )?;

    // end char len in C
    len += 1;
    let mut ret = Vec::with_capacity(len);
    let buf_ptr = ret.as_mut_ptr();
    let mut written_char_count = 0;

    check_status_and_type!(
      unsafe {
        sys::napi_get_value_string_utf8(env, napi_val, buf_ptr, len, &mut written_char_count)
      },
      env,
      napi_val,
      "Failed to convert JavaScript value `{}` into rust type `String`"
    )?;

    // The `&str` should only be accepted from function arguments.
    // We shouldn't implement `FromNapiValue` for it before.
    // When it's used with `Object.get` scenario, the memory which `&str` point to will be invalid.
    // For this scenario, we create a temporary empty `Object` here and assign the `Vec<u8>` under `&str` to it.
    // So we can safely forget the `Vec<u8>` here which could fix the memory issue here.
    // FIXME: This implementation should be removed in next major release.
    let mut temporary_external_object = ptr::null_mut();
    check_status!(unsafe {
      sys::napi_create_external(
        env,
        buf_ptr as *mut c_void,
        Some(release_string),
        Box::into_raw(Box::new(len)) as *mut c_void,
        &mut temporary_external_object,
      )
    })?;

    std::mem::forget(ret);
    match unsafe { CStr::from_ptr(buf_ptr) }.to_str() {
      Err(e) => Err(Error::new(
        Status::InvalidArg,
        format!("Failed to read utf8 string, {}", e),
      )),
      Ok(s) => Ok(s),
    }
  }
}

impl ToNapiValue for &str {
  unsafe fn to_napi_value(env: sys::napi_env, val: Self) -> Result<sys::napi_value> {
    let mut ptr = ptr::null_mut();

    check_status!(
      unsafe { sys::napi_create_string_utf8(env, val.as_ptr() as *const _, val.len(), &mut ptr) },
      "Failed to convert rust `&str` into napi `string`"
    )?;

    Ok(ptr)
  }
}

#[derive(Debug)]
pub struct Utf16String(String);

impl ValidateNapiValue for Utf16String {}

impl From<String> for Utf16String {
  fn from(s: String) -> Self {
    Utf16String(s)
  }
}

impl Display for Utf16String {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    write!(f, "{}", self.0)
  }
}

impl Deref for Utf16String {
  type Target = str;

  fn deref(&self) -> &Self::Target {
    self.0.as_ref()
  }
}

impl TypeName for Utf16String {
  fn type_name() -> &'static str {
    "String(utf16)"
  }

  fn value_type() -> ValueType {
    ValueType::String
  }
}

impl FromNapiValue for Utf16String {
  unsafe fn from_napi_value(env: sys::napi_env, napi_val: sys::napi_value) -> Result<Self> {
    let mut len = 0;

    check_status!(
      unsafe { sys::napi_get_value_string_utf16(env, napi_val, ptr::null_mut(), 0, &mut len) },
      "Failed to convert napi `utf16 string` into rust type `String`",
    )?;

    // end char len in C
    len += 1;
    let mut ret = vec![0; len];
    let mut written_char_count = 0;

    check_status!(
      unsafe {
        sys::napi_get_value_string_utf16(
          env,
          napi_val,
          ret.as_mut_ptr(),
          len,
          &mut written_char_count,
        )
      },
      "Failed to convert napi `utf16 string` into rust type `String`",
    )?;

    let (_, ret) = ret.split_last().unwrap_or((&0, &[]));

    match String::from_utf16(ret) {
      Err(e) => Err(Error::new(
        Status::InvalidArg,
        format!("Failed to read utf16 string, {}", e),
      )),
      Ok(s) => Ok(Utf16String(s)),
    }
  }
}

impl ToNapiValue for Utf16String {
  unsafe fn to_napi_value(env: sys::napi_env, val: Utf16String) -> Result<sys::napi_value> {
    let mut ptr = ptr::null_mut();

    let encoded = val.0.encode_utf16().collect::<Vec<_>>();

    check_status!(
      unsafe {
        sys::napi_create_string_utf16(env, encoded.as_ptr() as *const _, encoded.len(), &mut ptr)
      },
      "Failed to convert napi `string` into rust type `String`"
    )?;

    Ok(ptr)
  }
}

#[cfg(feature = "latin1")]
pub mod latin1_string {
  use super::*;

  #[derive(Debug)]
  pub struct Latin1String(String);

  impl ValidateNapiValue for Latin1String {}

  impl From<String> for Latin1String {
    fn from(s: String) -> Self {
      Latin1String(s)
    }
  }

  impl Display for Latin1String {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
      write!(f, "{}", self.0)
    }
  }

  impl Deref for Latin1String {
    type Target = str;

    fn deref(&self) -> &Self::Target {
      self.0.as_ref()
    }
  }

  impl TypeName for Latin1String {
    fn type_name() -> &'static str {
      "String(latin1)"
    }

    fn value_type() -> ValueType {
      ValueType::String
    }
  }

  impl FromNapiValue for Latin1String {
    unsafe fn from_napi_value(env: sys::napi_env, napi_val: sys::napi_value) -> Result<Self> {
      let mut len = 0;

      check_status!(
        unsafe { sys::napi_get_value_string_latin1(env, napi_val, ptr::null_mut(), 0, &mut len) },
        "Failed to convert napi `latin1 string` into rust type `String`",
      )?;

      // end char len in C
      len += 1;
      let mut buf = Vec::with_capacity(len);
      let buf_ptr = buf.as_mut_ptr();

      let mut written_char_count = 0;

      mem::forget(buf);

      check_status!(
        unsafe {
          sys::napi_get_value_string_latin1(env, napi_val, buf_ptr, len, &mut written_char_count)
        },
        "Failed to convert napi `latin1 string` into rust type `String`"
      )?;

      let buf =
        unsafe { Vec::from_raw_parts(buf_ptr as *mut _, written_char_count, written_char_count) };
      let mut dst_slice = vec![0; buf.len() * 2];
      let written =
        encoding_rs::mem::convert_latin1_to_utf8(buf.as_slice(), dst_slice.as_mut_slice());
      dst_slice.truncate(written);

      Ok(Latin1String(unsafe {
        String::from_utf8_unchecked(dst_slice)
      }))
    }
  }

  impl ToNapiValue for Latin1String {
    unsafe fn to_napi_value(env: sys::napi_env, val: Self) -> Result<sys::napi_value> {
      let mut ptr = ptr::null_mut();

      let mut dst = vec![0; val.len()];
      encoding_rs::mem::convert_utf8_to_latin1_lossy(val.0.as_bytes(), dst.as_mut_slice());

      check_status!(
        unsafe {
          sys::napi_create_string_latin1(env, dst.as_ptr() as *const _, dst.len(), &mut ptr)
        },
        "Failed to convert rust type `String` into napi `latin1 string`"
      )?;

      Ok(ptr)
    }
  }
}

unsafe extern "C" fn release_string(_env: sys::napi_env, data: *mut c_void, len: *mut c_void) {
  let len = unsafe { *Box::from_raw(len as *mut usize) };
  unsafe { Vec::from_raw_parts(data as *mut u8, len, len) };
}
