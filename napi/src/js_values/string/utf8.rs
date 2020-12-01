use std::convert::TryFrom;
use std::mem::ManuallyDrop;
use std::str;

use crate::{Error, JsString, Result, Status};

pub struct JsStringUtf8 {
  pub(crate) inner: JsString,
  pub(crate) buf: ManuallyDrop<Vec<u8>>,
}

impl JsStringUtf8 {
  #[inline]
  pub fn as_str(&self) -> Result<&str> {
    str::from_utf8(self.buf.as_slice())
      .map_err(|e| Error::new(Status::InvalidArg, format!("{}", e)))
  }

  #[inline]
  pub fn as_slice(&self) -> &[u8] {
    &self.buf
  }

  #[inline]
  pub fn len(&self) -> usize {
    self.buf.len()
  }

  #[inline]
  pub fn is_empty(&self) -> bool {
    self.buf.is_empty()
  }

  #[inline]
  pub fn into_owned(self) -> Result<String> {
    Ok(self.as_str()?.to_owned())
  }

  #[inline]
  pub fn take(self) -> Vec<u8> {
    self.as_slice().to_vec()
  }

  #[inline]
  pub fn into_value(self) -> JsString {
    self.inner
  }
}

impl TryFrom<JsStringUtf8> for String {
  type Error = Error;

  fn try_from(value: JsStringUtf8) -> Result<String> {
    Ok(value.as_str()?.to_owned())
  }
}

impl From<JsStringUtf8> for Vec<u8> {
  fn from(value: JsStringUtf8) -> Self {
    value.take()
  }
}
