use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};

use crate::{bindgen_prelude::*, sys};

impl TypeName for OsString {
  fn type_name() -> &'static str {
    "OsString"
  }

  fn value_type() -> ValueType {
    ValueType::String
  }
}

impl ValidateNapiValue for OsString {}

impl ToNapiValue for &OsString {
  unsafe fn to_napi_value(env: sys::napi_env, val: Self) -> Result<sys::napi_value> {
    unsafe { ToNapiValue::to_napi_value(env, val.as_os_str()) }
  }
}

impl ToNapiValue for &mut OsString {
  unsafe fn to_napi_value(env: sys::napi_env, val: Self) -> Result<sys::napi_value> {
    unsafe { ToNapiValue::to_napi_value(env, val.as_os_str()) }
  }
}

impl ToNapiValue for OsString {
  unsafe fn to_napi_value(env: sys::napi_env, val: Self) -> Result<sys::napi_value> {
    unsafe { ToNapiValue::to_napi_value(env, val.as_os_str()) }
  }
}

impl FromNapiValue for OsString {
  unsafe fn from_napi_value(env: sys::napi_env, napi_val: sys::napi_value) -> Result<Self> {
    let s = unsafe { String::from_napi_value(env, napi_val)? };
    Ok(OsString::from(s))
  }
}

impl ToNapiValue for &OsStr {
  unsafe fn to_napi_value(env: sys::napi_env, val: Self) -> Result<sys::napi_value> {
    match val.to_str() {
      Some(s) => unsafe { ToNapiValue::to_napi_value(env, s) },
      None => Err(Error::from_reason(
        "Non-Unicode OsStr/Path cannot be represented as JavaScript string",
      )),
    }
  }
}

impl TypeName for PathBuf {
  fn type_name() -> &'static str {
    "PathBuf"
  }

  fn value_type() -> ValueType {
    ValueType::String
  }
}

impl ValidateNapiValue for PathBuf {}

impl ToNapiValue for &PathBuf {
  unsafe fn to_napi_value(env: sys::napi_env, val: Self) -> Result<sys::napi_value> {
    unsafe { ToNapiValue::to_napi_value(env, val.as_path()) }
  }
}

impl ToNapiValue for &mut PathBuf {
  unsafe fn to_napi_value(env: sys::napi_env, val: Self) -> Result<sys::napi_value> {
    unsafe { ToNapiValue::to_napi_value(env, val.as_path()) }
  }
}

impl ToNapiValue for PathBuf {
  unsafe fn to_napi_value(env: sys::napi_env, val: Self) -> Result<sys::napi_value> {
    unsafe { ToNapiValue::to_napi_value(env, val.as_path()) }
  }
}

impl FromNapiValue for PathBuf {
  unsafe fn from_napi_value(env: sys::napi_env, napi_val: sys::napi_value) -> Result<Self> {
    let s = unsafe { String::from_napi_value(env, napi_val)? };
    Ok(PathBuf::from(s))
  }
}

impl ToNapiValue for &Path {
  unsafe fn to_napi_value(env: sys::napi_env, val: Self) -> Result<sys::napi_value> {
    unsafe { ToNapiValue::to_napi_value(env, val.as_os_str()) }
  }
}
