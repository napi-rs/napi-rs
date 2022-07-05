/// We don't implement `FromNapiValue` for `i64` `u64` `i128` `u128` `isize` `usize` here
/// Because converting directly from `JsBigInt` to these values may result in a loss of precision and thus unintended behavior
/// ```rust
/// use napi::{bindgen_prelude::*, JsBigint};
///
/// #[napi]
/// fn bigint_add(mut a: Bigint, mut b: Bigint) -> u128 {
///     a.get_u128().1 + b.get_u128().1 // We have opportunity to check if the `u128` has lost precision
/// }
/// ```
use std::ptr;

use crate::{check_status, sys};

use super::{FromNapiValue, ToNapiValue, TypeName, ValidateNapiValue};

/// i64 is converted to `Number`
#[repr(transparent)]
#[allow(non_camel_case_types)]
pub struct i64n(pub i64);

/// <https://nodejs.org/api/n-api.html#napi_create_bigint_words>
/// The resulting BigInt is calculated as: (–1)^sign_bit (words\[0\] × (2^64)^0 + words\[1\] × (2^64)^1 + …)
#[derive(Debug, Clone)]
pub struct BigInt {
  /// true for negative numbers
  pub sign_bit: bool,
  pub words: Vec<u64>,
}

impl TypeName for BigInt {
  fn type_name() -> &'static str {
    "BigInt"
  }

  fn value_type() -> crate::ValueType {
    crate::ValueType::BigInt
  }
}

impl ValidateNapiValue for BigInt {}

impl FromNapiValue for BigInt {
  unsafe fn from_napi_value(env: sys::napi_env, napi_val: sys::napi_value) -> crate::Result<Self> {
    let mut word_count = 0usize;
    check_status!(unsafe {
      sys::napi_get_value_bigint_words(
        env,
        napi_val,
        ptr::null_mut(),
        &mut word_count,
        ptr::null_mut(),
      )
    })?;
    let mut words: Vec<u64> = Vec::with_capacity(word_count as usize);
    let mut sign_bit = 0;

    unsafe {
      check_status!(sys::napi_get_value_bigint_words(
        env,
        napi_val,
        &mut sign_bit,
        &mut word_count,
        words.as_mut_ptr(),
      ))?;

      words.set_len(word_count as usize);
    }
    if word_count == 0 {
      words = vec![0];
    }
    Ok(BigInt {
      sign_bit: sign_bit == 1,
      words,
    })
  }
}

impl BigInt {
  /// (signed, value, lossless)
  /// get the first word of the BigInt as `u64`
  /// return true in the last element of tuple if the value is lossless
  /// or the value is truncated
  pub fn get_u64(&self) -> (bool, u64, bool) {
    (
      self.sign_bit,
      self.words[0],
      self.sign_bit && self.words.len() == 1,
    )
  }

  /// (value, lossless)
  /// get the first word of the BigInt as `i64`
  /// return true if the value is lossless
  /// or the value is truncated
  pub fn get_i64(&self) -> (i64, bool) {
    let val = self.words[0] as i64;
    (val, val as u64 == self.words[0] && self.words.len() == 1)
  }

  /// (value, lossless)
  /// get the first two words of the BigInt as `i128`
  /// return true if the value is lossless
  /// or the value is truncated
  pub fn get_i128(&self) -> (i128, bool) {
    let len = self.words.len();
    if len == 1 {
      (self.words[0] as i128, false)
    } else {
      let i128_words: [i64; 2] = [self.words[0] as _, self.words[1] as _];
      let mut val = unsafe { ptr::read(i128_words.as_ptr() as *const i128) };
      if self.sign_bit {
        val = -val;
      }
      (val, len > 2)
    }
  }

  /// (signed, value, lossless)
  /// get the first two words of the BigInt as `u128`
  /// return true if the value is lossless
  /// or the value is truncated
  pub fn get_u128(&self) -> (bool, u128, bool) {
    let len = self.words.len();
    if len == 1 {
      (self.sign_bit, self.words[0] as u128, false)
    } else {
      let u128_words: [u64; 2] = [self.words[0], self.words[1]];
      let val = unsafe { ptr::read(u128_words.as_ptr() as *const u128) };
      (self.sign_bit, val, len > 2)
    }
  }
}

impl ToNapiValue for BigInt {
  unsafe fn to_napi_value(env: sys::napi_env, val: Self) -> crate::Result<sys::napi_value> {
    let mut raw_value = ptr::null_mut();
    let len = val.words.len();
    check_status!(unsafe {
      sys::napi_create_bigint_words(
        env,
        match val.sign_bit {
          true => 1,
          false => 0,
        },
        len,
        val.words.as_ptr(),
        &mut raw_value,
      )
    })?;
    Ok(raw_value)
  }
}

impl ToNapiValue for i128 {
  unsafe fn to_napi_value(env: sys::napi_env, val: Self) -> crate::Result<sys::napi_value> {
    let mut raw_value = ptr::null_mut();
    let sign_bit = if val > 0 { 0 } else { 1 };
    let words = &val as *const i128 as *const u64;
    check_status!(unsafe {
      sys::napi_create_bigint_words(env, sign_bit, 2, words, &mut raw_value)
    })?;
    Ok(raw_value)
  }
}

impl ToNapiValue for u128 {
  unsafe fn to_napi_value(env: sys::napi_env, val: Self) -> crate::Result<sys::napi_value> {
    let mut raw_value = ptr::null_mut();
    let words = &val as *const u128 as *const u64;
    check_status!(unsafe { sys::napi_create_bigint_words(env, 0, 2, words, &mut raw_value) })?;
    Ok(raw_value)
  }
}

impl ToNapiValue for i64n {
  unsafe fn to_napi_value(env: sys::napi_env, val: Self) -> crate::Result<sys::napi_value> {
    let mut raw_value = ptr::null_mut();
    check_status!(unsafe { sys::napi_create_bigint_int64(env, val.0, &mut raw_value) })?;
    Ok(raw_value)
  }
}

impl ToNapiValue for u64 {
  unsafe fn to_napi_value(env: sys::napi_env, val: Self) -> crate::Result<sys::napi_value> {
    let mut raw_value = ptr::null_mut();
    check_status!(unsafe { sys::napi_create_bigint_uint64(env, val, &mut raw_value) })?;
    Ok(raw_value)
  }
}

impl ToNapiValue for usize {
  unsafe fn to_napi_value(env: sys::napi_env, val: Self) -> crate::Result<sys::napi_value> {
    let mut raw_value = ptr::null_mut();
    check_status!(unsafe { sys::napi_create_bigint_uint64(env, val as u64, &mut raw_value) })?;
    Ok(raw_value)
  }
}

impl ToNapiValue for isize {
  unsafe fn to_napi_value(env: sys::napi_env, val: Self) -> crate::Result<sys::napi_value> {
    let mut raw_value = ptr::null_mut();
    check_status!(unsafe { sys::napi_create_bigint_int64(env, val as i64, &mut raw_value) })?;
    Ok(raw_value)
  }
}

impl From<u64> for BigInt {
  fn from(val: u64) -> Self {
    BigInt {
      sign_bit: false,
      words: vec![val],
    }
  }
}
