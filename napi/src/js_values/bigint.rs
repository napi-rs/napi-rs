use std::convert::TryFrom;
use std::ptr;

use super::{Error, Value};
use crate::error::check_status;
use crate::{sys, Result};

#[derive(Clone, Copy, Debug)]
pub struct JsBigint(pub(crate) Value);

/// The BigInt will be converted losslessly when the value is over what an int64 could hold.
impl TryFrom<JsBigint> for i64 {
  type Error = Error;

  fn try_from(value: JsBigint) -> Result<i64> {
    let mut val: i64 = 0;
    let mut loss: bool = false;
    check_status(unsafe {
      sys::napi_get_value_bigint_int64(value.0.env, value.0.value, &mut val, &mut loss)
    })?;
    Ok(val)
  }
}

/// The BigInt will be converted losslessly when the value is over what an uint64 could hold.
impl TryFrom<JsBigint> for u64 {
  type Error = Error;

  fn try_from(value: JsBigint) -> Result<u64> {
    let mut val: u64 = 0;
    let mut loss = false;
    check_status(unsafe {
      sys::napi_get_value_bigint_uint64(value.0.env, value.0.value, &mut val, &mut loss)
    })?;

    Ok(val)
  }
}

impl JsBigint {
  /// https://nodejs.org/api/n-api.html#n_api_napi_get_value_bigint_words
  pub fn get_words(&self, sign_bit: bool) -> Result<Vec<u64>> {
    let mut word_count: u64 = 0;
    check_status(unsafe {
      sys::napi_get_value_bigint_words(
        self.0.env,
        self.0.value,
        ptr::null_mut(),
        &mut word_count,
        ptr::null_mut(),
      )
    })?;

    let mut words: Vec<u64> = Vec::with_capacity(word_count as usize);
    let mut sign_bit = match sign_bit {
      true => 1,
      false => 0,
    };
    check_status(unsafe {
      sys::napi_get_value_bigint_words(
        self.0.env,
        self.0.value,
        &mut sign_bit,
        &mut word_count,
        words.as_mut_ptr(),
      )
    })?;

    unsafe {
      words.set_len(word_count as usize);
    };

    Ok(words)
  }
}
