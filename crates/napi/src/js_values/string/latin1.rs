use std::mem::ManuallyDrop;

use crate::JsString;

#[cfg(feature = "latin1")]
use crate::Result;

pub struct JsStringLatin1 {
  pub(crate) inner: JsString,
  pub(crate) buf: ManuallyDrop<Vec<u8>>,
}

impl JsStringLatin1 {
  pub fn as_slice(&self) -> &[u8] {
    &self.buf
  }

  pub fn len(&self) -> usize {
    self.buf.len()
  }

  pub fn is_empty(&self) -> bool {
    self.buf.is_empty()
  }

  pub fn take(self) -> Vec<u8> {
    self.as_slice().to_vec()
  }

  pub fn into_value(self) -> JsString {
    self.inner
  }

  #[cfg(feature = "latin1")]
  pub fn into_latin1_string(self) -> Result<String> {
    let mut dst_str = unsafe { String::from_utf8_unchecked(vec![0; self.len() * 2 + 1]) };
    encoding_rs::mem::convert_latin1_to_str(self.buf.as_slice(), dst_str.as_mut_str());
    Ok(dst_str)
  }
}

impl From<JsStringLatin1> for Vec<u8> {
  fn from(value: JsStringLatin1) -> Self {
    value.take()
  }
}
