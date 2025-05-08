use std::mem::ManuallyDrop;

use crate::JsString;

#[cfg(feature = "latin1")]
use crate::Result;

pub struct JsStringLatin1<'env> {
  pub(crate) inner: JsString<'env>,
  pub(crate) buf: ManuallyDrop<Vec<u8>>,
}

impl<'env> JsStringLatin1<'env> {
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

  pub fn into_value(self) -> JsString<'env> {
    self.inner
  }

  #[cfg(feature = "latin1")]
  pub fn into_latin1_string(self) -> Result<String> {
    let mut dst_str = unsafe { String::from_utf8_unchecked(vec![0; self.len() * 2 + 1]) };
    encoding_rs::mem::convert_latin1_to_str(self.buf.as_slice(), dst_str.as_mut_str());
    Ok(dst_str)
  }
}

impl From<JsStringLatin1<'_>> for Vec<u8> {
  fn from(value: JsStringLatin1) -> Self {
    value.take()
  }
}
