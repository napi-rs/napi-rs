use std::convert::TryFrom;
use std::ffi::CStr;
use std::os::raw::c_char;
use std::str;

use crate::{Error, JsString, Result, Status};

pub struct JsStringUtf8 {
  pub(crate) inner: JsString,
  pub(crate) buf: Vec<c_char>,
}

impl JsStringUtf8 {
  pub fn as_str(&self) -> Result<&str> {
    unsafe { CStr::from_ptr(self.buf.as_ptr()) }
      .to_str()
      .map_err(|e| Error::new(Status::InvalidArg, format!("{}", e)))
  }

  pub fn as_slice(&self) -> &[u8] {
    unsafe { CStr::from_ptr(self.buf.as_ptr()) }.to_bytes()
  }

  pub fn len(&self) -> usize {
    self.buf.len()
  }

  pub fn is_empty(&self) -> bool {
    self.buf.is_empty()
  }

  pub fn into_owned(self) -> Result<String> {
    Ok(self.as_str()?.to_owned())
  }

  pub fn take(self) -> Vec<u8> {
    self.as_slice().to_vec()
  }

  pub fn into_value(self) -> JsString {
    self.inner
  }
}

impl TryFrom<JsStringUtf8> for String {
  type Error = Error;

  fn try_from(value: JsStringUtf8) -> Result<String> {
    value.into_owned()
  }
}

impl From<JsStringUtf8> for Vec<u8> {
  fn from(value: JsStringUtf8) -> Self {
    value.take()
  }
}
