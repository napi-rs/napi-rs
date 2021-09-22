use std::mem;
use std::ptr;

use crate::{check_status, sys, Result, Value};

pub use latin1::JsStringLatin1;
pub use utf16::JsStringUtf16;
pub use utf8::JsStringUtf8;

mod latin1;
mod utf16;
mod utf8;

#[derive(Clone, Copy)]
pub struct JsString(pub(crate) Value);

impl JsString {
  pub fn utf8_len(&self) -> Result<usize> {
    let mut length = 0;
    check_status!(unsafe {
      sys::napi_get_value_string_utf8(self.0.env, self.0.value, ptr::null_mut(), 0, &mut length)
    })?;
    Ok(length as usize)
  }

  pub fn utf16_len(&self) -> Result<usize> {
    let mut length = 0;
    check_status!(unsafe {
      sys::napi_get_value_string_utf16(self.0.env, self.0.value, ptr::null_mut(), 0, &mut length)
    })?;
    Ok(length as usize)
  }

  pub fn latin1_len(&self) -> Result<usize> {
    let mut length = 0;
    check_status!(unsafe {
      sys::napi_get_value_string_latin1(self.0.env, self.0.value, ptr::null_mut(), 0, &mut length)
    })?;
    Ok(length as usize)
  }

  pub fn into_utf8(self) -> Result<JsStringUtf8> {
    let mut written_char_count = 0;
    let len = self.utf8_len()? + 1;
    let mut result = Vec::with_capacity(len);
    let buf_ptr = result.as_mut_ptr();
    check_status!(unsafe {
      sys::napi_get_value_string_utf8(
        self.0.env,
        self.0.value,
        buf_ptr,
        len,
        &mut written_char_count,
      )
    })?;

    Ok(JsStringUtf8 {
      inner: self,
      buf: result,
    })
  }

  pub fn into_utf16(self) -> Result<JsStringUtf16> {
    let mut written_char_count = 0usize;
    let len = self.utf16_len()? + 1;
    let mut result = vec![0; len];
    let buf_ptr = result.as_mut_ptr();
    check_status!(unsafe {
      sys::napi_get_value_string_utf16(
        self.0.env,
        self.0.value,
        buf_ptr,
        len,
        &mut written_char_count,
      )
    })?;

    Ok(JsStringUtf16 {
      inner: self,
      buf: result,
    })
  }

  pub fn into_latin1(self) -> Result<JsStringLatin1> {
    let mut written_char_count = 0usize;
    let len = self.latin1_len()? + 1;
    let mut result = Vec::with_capacity(len);
    let buf_ptr = result.as_mut_ptr();
    check_status!(unsafe {
      sys::napi_get_value_string_latin1(
        self.0.env,
        self.0.value,
        buf_ptr,
        len,
        &mut written_char_count,
      )
    })?;

    mem::forget(result);

    Ok(JsStringLatin1 {
      inner: self,
      buf: mem::ManuallyDrop::new(unsafe {
        Vec::from_raw_parts(buf_ptr as *mut _, written_char_count, written_char_count)
      }),
    })
  }
}
