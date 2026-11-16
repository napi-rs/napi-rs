use std::ffi::c_char;
use std::marker::PhantomData;
use std::mem;
use std::ptr;

use crate::{
  bindgen_runtime::{FromNapiValue, ToNapiValue, TypeName, ValidateNapiValue},
  check_status, sys, Result, Value, ValueType,
};

pub use latin1::JsStringLatin1;
pub use utf16::JsStringUtf16;
pub use utf8::JsStringUtf8;

use super::JsValue;

mod latin1;
mod utf16;
mod utf8;

#[derive(Clone, Copy)]
pub struct JsString<'env>(pub(crate) Value, pub(crate) PhantomData<&'env ()>);

impl TypeName for JsString<'_> {
  fn type_name() -> &'static str {
    "String"
  }

  fn value_type() -> crate::ValueType {
    ValueType::String
  }
}

impl ValidateNapiValue for JsString<'_> {}

impl<'env> JsValue<'env> for JsString<'env> {
  fn value(&self) -> Value {
    self.0
  }
}

impl FromNapiValue for JsString<'_> {
  unsafe fn from_napi_value(env: sys::napi_env, napi_val: sys::napi_value) -> Result<Self> {
    Ok(JsString(
      Value {
        env,
        value: napi_val,
        value_type: ValueType::String,
      },
      PhantomData,
    ))
  }
}

impl ToNapiValue for &JsString<'_> {
  unsafe fn to_napi_value(_env: sys::napi_env, val: Self) -> Result<sys::napi_value> {
    Ok(val.raw())
  }
}

impl<'env> JsString<'env> {
  #[cfg(feature = "serde-json")]
  pub(crate) fn from_raw(env: sys::napi_env, value: sys::napi_value) -> Self {
    JsString(
      Value {
        env,
        value,
        value_type: ValueType::String,
      },
      PhantomData,
    )
  }

  pub fn utf8_len(&self) -> Result<usize> {
    let mut length = 0;
    check_status!(unsafe {
      sys::napi_get_value_string_utf8(self.0.env, self.0.value, ptr::null_mut(), 0, &mut length)
    })?;
    Ok(length)
  }

  pub fn utf16_len(&self) -> Result<usize> {
    let mut length = 0;
    check_status!(unsafe {
      sys::napi_get_value_string_utf16(self.0.env, self.0.value, ptr::null_mut(), 0, &mut length)
    })?;
    Ok(length)
  }

  pub fn latin1_len(&self) -> Result<usize> {
    let mut length = 0;
    check_status!(unsafe {
      sys::napi_get_value_string_latin1(self.0.env, self.0.value, ptr::null_mut(), 0, &mut length)
    })?;
    Ok(length)
  }

  pub fn into_utf8(self) -> Result<JsStringUtf8<'env>> {
    // `+ 1` for the NUL terminator `napi_get_value_string_utf8` writes after the string bytes
    let len = self.utf8_len()? + 1;
    let mut bytes: Vec<c_char> = vec![0; len];
    let buf_ptr = bytes.as_mut_ptr();

    let mut written_byte_count = 0;
    check_status!(unsafe {
      sys::napi_get_value_string_utf8(
        self.0.env,
        self.0.value,
        buf_ptr,
        len,
        &mut written_byte_count,
      )
    })?;

    mem::forget(bytes);

    Ok(JsStringUtf8 {
      inner: self,
      buf: unsafe { Vec::from_raw_parts(buf_ptr.cast(), written_byte_count, len) },
    })
  }

  pub fn into_utf16(self) -> Result<JsStringUtf16<'env>> {
    // `+ 1` for the NUL terminator `napi_get_value_string_utf16` writes after the string data
    let len = self.utf16_len()? + 1;
    let mut code_units: Vec<u16> = vec![0; len];
    let buf_ptr = code_units.as_mut_ptr();

    let mut written_code_unit_count = 0usize;
    check_status!(unsafe {
      sys::napi_get_value_string_utf16(
        self.0.env,
        self.0.value,
        buf_ptr,
        len,
        &mut written_code_unit_count,
      )
    })?;

    Ok(JsStringUtf16 {
      inner: self,
      buf: unsafe { std::slice::from_raw_parts(buf_ptr, len) },
      _inner_buf: code_units,
    })
  }

  pub fn into_latin1(self) -> Result<JsStringLatin1<'env>> {
    // `+ 1` for the NUL terminator `napi_get_value_string_latin1` writes after the string bytes
    let len = self.latin1_len()? + 1;
    let mut bytes: Vec<c_char> = vec![0; len];
    let buf_ptr = bytes.as_mut_ptr();

    let mut written_byte_count = 0usize;
    check_status!(unsafe {
      sys::napi_get_value_string_latin1(
        self.0.env,
        self.0.value,
        buf_ptr,
        len,
        &mut written_byte_count,
      )
    })?;

    mem::forget(bytes);

    Ok(JsStringLatin1 {
      inner: self,
      buf: unsafe { std::slice::from_raw_parts(buf_ptr.cast(), written_byte_count) },
      _inner_buf: unsafe { Vec::from_raw_parts(buf_ptr.cast(), written_byte_count, len) },
    })
  }
}
