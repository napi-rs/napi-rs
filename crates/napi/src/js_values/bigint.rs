use std::convert::TryFrom;
use std::ptr;

use super::*;
use crate::{bindgen_runtime::TypeName, check_status, sys, Result};

#[derive(Clone, Copy)]
pub struct JsBigInt {
  pub(crate) raw: Value,
  pub word_count: usize,
}

impl TypeName for JsBigInt {
  fn type_name() -> &'static str {
    "BigInt"
  }

  fn value_type() -> ValueType {
    ValueType::BigInt
  }
}

impl ValidateNapiValue for JsBigInt {}

impl JsBigInt {
  pub(crate) fn from_raw_unchecked(
    env: sys::napi_env,
    value: sys::napi_value,
    word_count: usize,
  ) -> Self {
    Self {
      raw: Value {
        env,
        value,
        value_type: ValueType::Object,
      },
      word_count,
    }
  }

  pub fn into_unknown(self) -> Result<JsUnknown> {
    unsafe { JsUnknown::from_raw(self.raw.env, self.raw.value) }
  }

  pub fn coerce_to_number(self) -> Result<JsNumber> {
    let mut new_raw_value = ptr::null_mut();
    check_status!(unsafe {
      sys::napi_coerce_to_number(self.raw.env, self.raw.value, &mut new_raw_value)
    })?;
    Ok(JsNumber(Value {
      env: self.raw.env,
      value: new_raw_value,
      value_type: ValueType::Number,
    }))
  }

  pub fn coerce_to_string(self) -> Result<JsString> {
    let mut new_raw_value = ptr::null_mut();
    check_status!(unsafe {
      sys::napi_coerce_to_string(self.raw.env, self.raw.value, &mut new_raw_value)
    })?;
    Ok(JsString(Value {
      env: self.raw.env,
      value: new_raw_value,
      value_type: ValueType::String,
    }))
  }

  pub fn coerce_to_object(self) -> Result<JsObject> {
    let mut new_raw_value = ptr::null_mut();
    check_status!(unsafe {
      sys::napi_coerce_to_object(self.raw.env, self.raw.value, &mut new_raw_value)
    })?;
    Ok(JsObject(Value {
      env: self.raw.env,
      value: new_raw_value,
      value_type: ValueType::Object,
    }))
  }

  pub fn is_date(&self) -> Result<bool> {
    let mut is_date = true;
    check_status!(unsafe { sys::napi_is_date(self.raw.env, self.raw.value, &mut is_date) })?;
    Ok(is_date)
  }

  pub fn is_error(&self) -> Result<bool> {
    let mut result = false;
    check_status!(unsafe { sys::napi_is_error(self.raw.env, self.raw.value, &mut result) })?;
    Ok(result)
  }

  pub fn is_typedarray(&self) -> Result<bool> {
    let mut result = false;
    check_status!(unsafe { sys::napi_is_typedarray(self.raw.env, self.raw.value, &mut result) })?;
    Ok(result)
  }

  pub fn is_dataview(&self) -> Result<bool> {
    let mut result = false;
    check_status!(unsafe { sys::napi_is_dataview(self.raw.env, self.raw.value, &mut result) })?;
    Ok(result)
  }

  pub fn is_array(&self) -> Result<bool> {
    let mut is_array = false;
    check_status!(unsafe { sys::napi_is_array(self.raw.env, self.raw.value, &mut is_array) })?;
    Ok(is_array)
  }

  pub fn is_buffer(&self) -> Result<bool> {
    let mut is_buffer = false;
    check_status!(unsafe { sys::napi_is_buffer(self.raw.env, self.raw.value, &mut is_buffer) })?;
    Ok(is_buffer)
  }

  pub fn instanceof<Constructor: NapiRaw>(&self, constructor: Constructor) -> Result<bool> {
    let mut result = false;
    check_status!(unsafe {
      sys::napi_instanceof(self.raw.env, self.raw.value, constructor.raw(), &mut result)
    })?;
    Ok(result)
  }
}

impl NapiRaw for JsBigInt {
  unsafe fn raw(&self) -> sys::napi_value {
    self.raw.value
  }
}

impl NapiRaw for &JsBigInt {
  unsafe fn raw(&self) -> sys::napi_value {
    self.raw.value
  }
}

impl NapiValue for JsBigInt {
  unsafe fn from_raw(env: sys::napi_env, value: sys::napi_value) -> Result<Self> {
    let mut word_count = 0usize;
    check_status!(unsafe {
      sys::napi_get_value_bigint_words(
        env,
        value,
        ptr::null_mut(),
        &mut word_count,
        ptr::null_mut(),
      )
    })?;
    Ok(JsBigInt {
      raw: Value {
        env,
        value,
        value_type: ValueType::BigInt,
      },
      word_count,
    })
  }

  unsafe fn from_raw_unchecked(env: sys::napi_env, value: sys::napi_value) -> Self {
    let mut word_count = 0usize;
    let status = unsafe {
      sys::napi_get_value_bigint_words(
        env,
        value,
        ptr::null_mut(),
        &mut word_count,
        ptr::null_mut(),
      )
    };
    debug_assert!(
      Status::from(status) == Status::Ok,
      "napi_get_value_bigint_words failed"
    );
    JsBigInt {
      raw: Value {
        env,
        value,
        value_type: ValueType::BigInt,
      },
      word_count,
    }
  }
}

/// The BigInt will be converted losslessly when the value is over what an int64 could hold.
impl TryFrom<JsBigInt> for i64 {
  type Error = Error;

  fn try_from(value: JsBigInt) -> Result<i64> {
    value.get_i64().map(|(v, _)| v)
  }
}

/// The BigInt will be converted losslessly when the value is over what an uint64 could hold.
impl TryFrom<JsBigInt> for u64 {
  type Error = Error;

  fn try_from(value: JsBigInt) -> Result<u64> {
    value.get_u64().map(|(v, _)| v)
  }
}

impl JsBigInt {
  /// <https://nodejs.org/api/n-api.html#n_api_napi_get_value_bigint_words>
  pub fn get_words(&mut self) -> Result<(bool, Vec<u64>)> {
    let mut words: Vec<u64> = Vec::with_capacity(self.word_count);
    let word_count = &mut self.word_count;
    let mut sign_bit = 0;
    check_status!(unsafe {
      sys::napi_get_value_bigint_words(
        self.raw.env,
        self.raw.value,
        &mut sign_bit,
        word_count,
        words.as_mut_ptr(),
      )
    })?;

    unsafe {
      words.set_len(self.word_count);
    };

    Ok((sign_bit == 1, words))
  }

  pub fn get_u64(&self) -> Result<(u64, bool)> {
    let mut val: u64 = 0;
    let mut lossless = false;
    check_status!(unsafe {
      sys::napi_get_value_bigint_uint64(self.raw.env, self.raw.value, &mut val, &mut lossless)
    })?;

    Ok((val, lossless))
  }

  pub fn get_i64(&self) -> Result<(i64, bool)> {
    let mut val: i64 = 0;
    let mut lossless: bool = false;
    check_status!(unsafe {
      sys::napi_get_value_bigint_int64(self.raw.env, self.raw.value, &mut val, &mut lossless)
    })?;
    Ok((val, lossless))
  }

  pub fn get_i128(&mut self) -> Result<(i128, bool)> {
    let (signed, words) = self.get_words()?;

    let low_part = words.first().copied().unwrap_or(0).to_ne_bytes();
    let high_part = words.get(1).copied().unwrap_or(0).to_ne_bytes();

    let mut val = [0_u8; std::mem::size_of::<i128>()];
    let high_val: &mut [u8];
    let low_val: &mut [u8];
    if cfg!(target_endian = "little") {
      (low_val, high_val) = val.split_at_mut(low_part.len());
    } else {
      (high_val, low_val) = val.split_at_mut(low_part.len());
    }

    high_val.copy_from_slice(&high_part);
    low_val.copy_from_slice(&low_part);

    let mut val = i128::from_ne_bytes(val);

    let mut loss = words.len() > 2;
    let mut overflow = false;

    if signed {
      let result = val.overflowing_neg();
      val = result.0;
      overflow = result.1;
    }

    loss = overflow || loss;

    Ok((val, loss))
  }

  pub fn get_u128(&mut self) -> Result<(bool, u128, bool)> {
    let (signed, words) = self.get_words()?;

    let low_part = words.first().copied().unwrap_or(0).to_ne_bytes();
    let high_part = words.get(1).copied().unwrap_or(0).to_ne_bytes();

    let mut val = [0_u8; std::mem::size_of::<i128>()];
    let high_val: &mut [u8];
    let low_val: &mut [u8];
    if cfg!(target_endian = "little") {
      (low_val, high_val) = val.split_at_mut(low_part.len());
    } else {
      (high_val, low_val) = val.split_at_mut(low_part.len());
    }

    high_val.copy_from_slice(&high_part);
    low_val.copy_from_slice(&low_part);

    let val = u128::from_ne_bytes(val);

    let len = words.len();

    Ok((signed, val, len > 2))
  }
}
