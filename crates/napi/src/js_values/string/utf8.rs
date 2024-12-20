use std::convert::TryFrom;
use std::str;

use crate::{Error, JsString, Result};

pub struct JsStringUtf8 {
  pub(crate) inner: JsString,
  pub(crate) buf: Vec<u8>,
}

impl JsStringUtf8 {
  pub fn as_str(&self) -> Result<&str> {
    Ok(unsafe { str::from_utf8_unchecked(&self.buf) })
  }

  pub fn as_slice(&self) -> &[u8] {
    self.buf.as_slice()
  }

  pub fn len(&self) -> usize {
    self.buf.len()
  }

  pub fn is_empty(&self) -> bool {
    self.buf.is_empty()
  }

  pub fn into_owned(self) -> Result<String> {
    Ok(unsafe { String::from_utf8_unchecked(self.buf) })
  }

  pub fn take(self) -> Vec<u8> {
    self.buf
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
