use std::mem;
use std::ptr;

use super::Value;
use crate::error::check_status;
use crate::{sys, Ref, Result};

pub use latin1::JsStringLatin1;
pub use utf16::JsStringUtf16;
pub use utf8::JsStringUtf8;

mod latin1;
mod utf16;
mod utf8;

#[repr(transparent)]
#[derive(Debug, Clone, Copy)]
pub struct JsString(pub(crate) Value);

impl JsString {
  pub fn utf8_len(&self) -> Result<usize> {
    let mut length = 0;
    check_status(unsafe {
      sys::napi_get_value_string_utf8(self.0.env, self.0.value, ptr::null_mut(), 0, &mut length)
    })?;
    Ok(length as usize)
  }

  pub fn utf16_len(&self) -> Result<usize> {
    let mut length = 0;
    check_status(unsafe {
      sys::napi_get_value_string_utf16(self.0.env, self.0.value, ptr::null_mut(), 0, &mut length)
    })?;
    Ok(length as usize)
  }

  pub fn latin1_len(&self) -> Result<usize> {
    let mut length = 0;
    check_status(unsafe {
      sys::napi_get_value_string_latin1(self.0.env, self.0.value, ptr::null_mut(), 0, &mut length)
    })?;
    Ok(length as usize)
  }

  pub fn into_utf8(self) -> Result<JsStringUtf8> {
    let mut written_char_count: u64 = 0;
    let len = self.utf8_len()? + 1;
    let mut result = Vec::with_capacity(len);
    let buf_ptr = result.as_mut_ptr();
    check_status(unsafe {
      sys::napi_get_value_string_utf8(
        self.0.env,
        self.0.value,
        buf_ptr,
        len as u64,
        &mut written_char_count,
      )
    })?;

    mem::forget(result);

    Ok(JsStringUtf8 {
      inner: self,
      buf: mem::ManuallyDrop::new(unsafe {
        Vec::from_raw_parts(
          buf_ptr as *mut _,
          written_char_count as _,
          written_char_count as _,
        )
      }),
    })
  }

  pub fn into_utf8_ref(self) -> Result<Ref<JsStringUtf8>> {
    Ref::new(self.0, 1, self.into_utf8()?)
  }

  pub fn into_utf16(self) -> Result<JsStringUtf16> {
    let mut written_char_count: u64 = 0;
    let len = self.utf16_len()? + 1;
    let mut result = Vec::with_capacity(len);
    let buf_ptr = result.as_mut_ptr();
    check_status(unsafe {
      sys::napi_get_value_string_utf16(
        self.0.env,
        self.0.value,
        buf_ptr,
        len as u64,
        &mut written_char_count,
      )
    })?;
    mem::forget(result);

    Ok(JsStringUtf16 {
      inner: self,
      buf: mem::ManuallyDrop::new(unsafe {
        Vec::from_raw_parts(buf_ptr, written_char_count as _, written_char_count as _)
      }),
    })
  }

  pub fn into_utf16_ref(self) -> Result<Ref<JsStringUtf16>> {
    Ref::new(self.0, 1, self.into_utf16()?)
  }

  pub fn into_latin1(self) -> Result<JsStringLatin1> {
    let mut written_char_count: u64 = 0;
    let len = self.latin1_len()? + 1;
    let mut result = Vec::with_capacity(len);
    let buf_ptr = result.as_mut_ptr();
    check_status(unsafe {
      sys::napi_get_value_string_latin1(
        self.0.env,
        self.0.value,
        buf_ptr,
        len as u64,
        &mut written_char_count,
      )
    })?;

    mem::forget(result);

    Ok(JsStringLatin1 {
      inner: self,
      buf: mem::ManuallyDrop::new(unsafe {
        Vec::from_raw_parts(
          buf_ptr as *mut _,
          written_char_count as _,
          written_char_count as _,
        )
      }),
    })
  }

  pub fn into_latin1_ref(self) -> Result<Ref<JsStringLatin1>> {
    Ref::new(self.0, 1, self.into_latin1()?)
  }
}
