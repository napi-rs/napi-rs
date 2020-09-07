use std::convert::TryFrom;
use std::mem;
use std::ptr;
use std::slice;
use std::str;

#[cfg(feature = "latin1")]
use encoding_rs;

use super::Value;
use crate::error::check_status;
use crate::{sys, Error, Result, Status};

#[derive(Debug)]
pub struct JsString(pub(crate) Value);

impl JsString {
  pub fn utf8_len(&self) -> Result<usize> {
    let mut length = 0;
    check_status(unsafe {
      sys::napi_get_value_string_utf8(self.0.env, self.0.value, ptr::null_mut(), 0, &mut length)
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
}

impl JsString {
  pub fn get_utf8(&self) -> Result<&[u8]> {
    let mut written_char_count: u64 = 0;
    let len = self.utf8_len()? + 1;
    let mut result = Vec::with_capacity(len);
    unsafe {
      check_status(sys::napi_get_value_string_utf8(
        self.0.env,
        self.0.value,
        result.as_mut_ptr(),
        len as u64,
        &mut written_char_count,
      ))?;
      let ptr = result.as_ptr();
      mem::forget(result);
      Ok(slice::from_raw_parts(
        ptr as *const u8,
        written_char_count as usize,
      ))
    }
  }

  pub fn get_latin1(&self) -> Result<(&[u8], usize)> {
    let mut written_char_count: u64 = 0;
    let len = self.latin1_len()? + 1;
    let mut result = Vec::with_capacity(len);
    unsafe {
      check_status(sys::napi_get_value_string_latin1(
        self.0.env,
        self.0.value,
        result.as_mut_ptr(),
        len as u64,
        &mut written_char_count,
      ))?;
      let ptr = result.as_ptr();
      mem::forget(result);
      Ok((
        slice::from_raw_parts(ptr as *const u8, written_char_count as usize),
        written_char_count as usize,
      ))
    }
  }

  #[inline]
  pub fn get_utf8_chars(&self) -> Result<&[char]> {
    let mut written_char_count: u64 = 0;
    let len = self.utf8_len()? + 1;
    let mut result = Vec::with_capacity(len);
    unsafe {
      check_status(sys::napi_get_value_string_utf8(
        self.0.env,
        self.0.value,
        result.as_mut_ptr(),
        len as u64,
        &mut written_char_count,
      ))?;

      let ptr = result.as_ptr();
      mem::forget(result);
      Ok(slice::from_raw_parts(
        ptr as *const char,
        written_char_count as usize,
      ))
    }
  }

  pub fn as_str(&self) -> Result<&str> {
    str::from_utf8(self.get_utf8()?)
      .map_err(|e| Error::new(Status::GenericFailure, format!("{:?}", e)))
  }

  #[cfg(feature = "latin1")]
  pub fn as_latin1_string(&self) -> Result<String> {
    let (latin1_bytes, len) = self.get_latin1()?;
    let mut dst_str = unsafe { String::from_utf8_unchecked(vec![0; len * 2 + 1]) };
    encoding_rs::mem::convert_latin1_to_str(latin1_bytes, dst_str.as_mut_str());
    Ok(dst_str)
  }

  pub fn get_ref_mut(&mut self) -> Result<&mut [u8]> {
    let mut written_char_count: u64 = 0;
    let len = self.utf8_len()? + 1;
    let mut result = Vec::with_capacity(len);
    unsafe {
      check_status(sys::napi_get_value_string_utf8(
        self.0.env,
        self.0.value,
        result.as_mut_ptr(),
        len as u64,
        &mut written_char_count,
      ))?;

      let ptr = result.as_ptr();
      mem::forget(result);
      Ok(slice::from_raw_parts_mut(
        ptr as *mut _,
        written_char_count as usize,
      ))
    }
  }
}

impl TryFrom<JsString> for Vec<u16> {
  type Error = Error;

  fn try_from(value: JsString) -> Result<Vec<u16>> {
    let mut result = Vec::with_capacity(value.utf8_len()? + 1); // Leave room for trailing null byte

    unsafe {
      let mut written_char_count = 0;
      check_status(sys::napi_get_value_string_utf16(
        value.0.env,
        value.0.value,
        result.as_mut_ptr(),
        result.capacity() as u64,
        &mut written_char_count,
      ))?;
      result.set_len(written_char_count as usize);
    }

    Ok(result)
  }
}

impl TryFrom<JsString> for String {
  type Error = Error;

  fn try_from(value: JsString) -> Result<String> {
    Ok(value.as_str()?.to_owned())
  }
}
