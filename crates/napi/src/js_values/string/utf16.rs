use std::convert::TryFrom;
use std::ops::Deref;

use crate::{Error, JsString, Result, Status};

pub struct JsStringUtf16 {
  pub(crate) inner: JsString,
  pub(crate) buf: Vec<u16>,
}

impl JsStringUtf16 {
  pub fn as_str(&self) -> Result<String> {
    if let Some((_, prefix)) = self.as_slice().split_last() {
      String::from_utf16(prefix).map_err(|e| Error::new(Status::InvalidArg, format!("{}", e)))
    } else {
      Ok(String::new())
    }
  }

  pub fn as_slice(&self) -> &[u16] {
    self.buf.as_slice()
  }

  pub fn len(&self) -> usize {
    self.buf.len()
  }

  pub fn is_empty(&self) -> bool {
    self.buf.is_empty()
  }

  pub fn into_value(self) -> JsString {
    self.inner
  }
}

impl TryFrom<JsStringUtf16> for String {
  type Error = Error;

  fn try_from(value: JsStringUtf16) -> Result<String> {
    value.as_str()
  }
}

impl Deref for JsStringUtf16 {
  type Target = [u16];

  fn deref(&self) -> &[u16] {
    self.buf.as_slice()
  }
}

impl AsRef<Vec<u16>> for JsStringUtf16 {
  fn as_ref(&self) -> &Vec<u16> {
    &self.buf
  }
}

impl From<JsStringUtf16> for Vec<u16> {
  fn from(value: JsStringUtf16) -> Self {
    value.as_slice().to_vec()
  }
}
