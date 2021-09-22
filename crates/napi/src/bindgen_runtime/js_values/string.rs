use crate::{bindgen_prelude::*, check_status, sys, Error, Result, Status};

use std::ffi::CStr;
use std::fmt::Display;
#[cfg(feature = "latin1")]
use std::mem;
use std::ops::Deref;
use std::ptr;

impl TypeName for String {
  fn type_name() -> &'static str {
    "String"
  }
}

impl ToNapiValue for String {
  unsafe fn to_napi_value(env: sys::napi_env, val: Self) -> Result<sys::napi_value> {
    let mut ptr = ptr::null_mut();

    check_status!(
      sys::napi_create_string_utf8(env, val.as_ptr() as *const _, val.len(), &mut ptr),
      "Failed to convert rust `String` into napi `string`"
    )?;

    Ok(ptr)
  }
}

impl FromNapiValue for String {
  unsafe fn from_napi_value(env: sys::napi_env, napi_val: sys::napi_value) -> Result<Self> {
    let mut len = 0;

    check_status!(
      sys::napi_get_value_string_utf8(env, napi_val, ptr::null_mut(), 0, &mut len),
      "Failed to convert napi `string` into rust type `String`",
    )?;

    // end char len in C
    len += 1;
    let mut ret = Vec::with_capacity(len);
    let buf_ptr = ret.as_mut_ptr();

    let mut written_char_count = 0;

    check_status!(
      sys::napi_get_value_string_utf8(env, napi_val, buf_ptr, len, &mut written_char_count),
      "Failed to convert napi `string` into rust type `String`"
    )?;

    match CStr::from_ptr(buf_ptr).to_str() {
      Err(e) => Err(Error::new(
        Status::InvalidArg,
        format!("Failed to read utf8 string, {}", e),
      )),
      Ok(s) => Ok(s.to_owned()),
    }
  }
}

impl TypeName for &str {
  fn type_name() -> &'static str {
    "String"
  }
}

impl ToNapiValue for &str {
  unsafe fn to_napi_value(env: sys::napi_env, val: Self) -> Result<sys::napi_value> {
    String::to_napi_value(env, val.to_owned())
  }
}

#[derive(Debug)]
pub struct Utf16String(String);

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
}

impl FromNapiValue for Utf16String {
  unsafe fn from_napi_value(env: sys::napi_env, napi_val: sys::napi_value) -> Result<Self> {
    let mut len = 0;

    check_status!(
      sys::napi_get_value_string_utf16(env, napi_val, ptr::null_mut(), 0, &mut len),
      "Failed to convert napi `utf16 string` into rust type `String`",
    )?;

    // end char len in C
    len += 1;
    let mut ret = vec![0; len];
    let mut written_char_count = 0;

    check_status!(
      sys::napi_get_value_string_utf16(
        env,
        napi_val,
        ret.as_mut_ptr(),
        len,
        &mut written_char_count
      ),
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
      sys::napi_create_string_utf16(env, encoded.as_ptr() as *const _, encoded.len(), &mut ptr),
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
  }

  #[cfg(feature = "latin1")]
  impl FromNapiValue for Latin1String {
    unsafe fn from_napi_value(env: sys::napi_env, napi_val: sys::napi_value) -> Result<Self> {
      let mut len = 0;

      check_status!(
        sys::napi_get_value_string_latin1(env, napi_val, ptr::null_mut(), 0, &mut len),
        "Failed to convert napi `latin1 string` into rust type `String`",
      )?;

      // end char len in C
      len += 1;
      let mut buf = Vec::with_capacity(len);
      let buf_ptr = buf.as_mut_ptr();

      let mut written_char_count = 0;

      mem::forget(buf);

      check_status!(
        sys::napi_get_value_string_latin1(env, napi_val, buf_ptr, len, &mut written_char_count),
        "Failed to convert napi `latin1 string` into rust type `String`"
      )?;

      let buf = Vec::from_raw_parts(buf_ptr as *mut _, written_char_count, written_char_count);
      let mut dst_slice = vec![0; buf.len() * 2];
      let written =
        encoding_rs::mem::convert_latin1_to_utf8(buf.as_slice(), dst_slice.as_mut_slice());
      dst_slice.truncate(written);

      Ok(Latin1String(String::from_utf8_unchecked(dst_slice)))
    }
  }

  impl ToNapiValue for Latin1String {
    unsafe fn to_napi_value(env: sys::napi_env, val: Self) -> Result<sys::napi_value> {
      let mut ptr = ptr::null_mut();

      let mut dst = vec![0; val.len()];
      encoding_rs::mem::convert_utf8_to_latin1_lossy(val.0.as_bytes(), dst.as_mut_slice());

      check_status!(
        sys::napi_create_string_latin1(env, dst.as_ptr() as *const _, dst.len(), &mut ptr),
        "Failed to convert rust type `String` into napi `latin1 string`"
      )?;

      Ok(ptr)
    }
  }
}
