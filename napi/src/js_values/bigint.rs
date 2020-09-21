use std::convert::TryFrom;
use std::ptr;

use super::*;
use crate::error::check_status;
use crate::{sys, Env, Result};

#[derive(Debug)]
pub struct JsBigint<'env> {
  pub(crate) raw: Value<'env>,
  pub word_count: u64,
}

impl<'env> JsBigint<'env> {
  pub(crate) fn from_raw_unchecked(
    env: &'env Env,
    value: sys::napi_value,
    word_count: u64,
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

  #[inline]
  pub fn into_unknown(self) -> Result<JsUnknown<'env>> {
    JsUnknown::from_raw(self.raw.env, self.raw.value)
  }

  #[inline]
  pub fn coerce_to_number(self) -> Result<JsNumber<'env>> {
    let mut new_raw_value = ptr::null_mut();
    check_status(unsafe {
      sys::napi_coerce_to_number(self.raw.env.0, self.raw.value, &mut new_raw_value)
    })?;
    Ok(JsNumber(Value {
      env: self.raw.env,
      value: new_raw_value,
      value_type: ValueType::Number,
    }))
  }

  #[inline]
  pub fn coerce_to_string(self) -> Result<JsString<'env>> {
    let mut new_raw_value = ptr::null_mut();
    check_status(unsafe {
      sys::napi_coerce_to_string(self.raw.env.0, self.raw.value, &mut new_raw_value)
    })?;
    Ok(JsString(Value {
      env: self.raw.env,
      value: new_raw_value,
      value_type: ValueType::String,
    }))
  }
  #[inline]
  pub fn coerce_to_object(self) -> Result<JsObject<'env>> {
    let mut new_raw_value = ptr::null_mut();
    check_status(unsafe {
      sys::napi_coerce_to_object(self.raw.env.0, self.raw.value, &mut new_raw_value)
    })?;
    Ok(JsObject(Value {
      env: self.raw.env,
      value: new_raw_value,
      value_type: ValueType::Object,
    }))
  }

  #[inline]
  #[cfg(napi5)]
  pub fn is_date(&self) -> Result<bool> {
    let mut is_date = true;
    check_status(unsafe { sys::napi_is_date(self.raw.env.0, self.raw.value, &mut is_date) })?;
    Ok(is_date)
  }

  #[inline]
  pub fn is_error(&self) -> Result<bool> {
    let mut result = false;
    check_status(unsafe { sys::napi_is_error(self.raw.env.0, self.raw.value, &mut result) })?;
    Ok(result)
  }

  #[inline]
  pub fn is_typedarray(&self) -> Result<bool> {
    let mut result = false;
    check_status(unsafe { sys::napi_is_typedarray(self.raw.env.0, self.raw.value, &mut result) })?;
    Ok(result)
  }

  #[inline]
  pub fn is_dataview(&self) -> Result<bool> {
    let mut result = false;
    check_status(unsafe { sys::napi_is_dataview(self.raw.env.0, self.raw.value, &mut result) })?;
    Ok(result)
  }

  #[inline]
  pub fn is_array(&self) -> Result<bool> {
    let mut is_array = false;
    check_status(unsafe { sys::napi_is_array(self.raw.env.0, self.raw.value, &mut is_array) })?;
    Ok(is_array)
  }

  #[inline]
  pub fn is_buffer(&self) -> Result<bool> {
    let mut is_buffer = false;
    check_status(unsafe { sys::napi_is_buffer(self.raw.env.0, self.raw.value, &mut is_buffer) })?;
    Ok(is_buffer)
  }

  #[inline]
  pub fn instanceof<Constructor: NapiValue<'env>>(&self, constructor: Constructor) -> Result<bool> {
    let mut result = false;
    check_status(unsafe {
      sys::napi_instanceof(
        self.raw.env.0,
        self.raw.value,
        constructor.raw_value(),
        &mut result,
      )
    })?;
    Ok(result)
  }
}

impl<'env> NapiValue<'env> for JsBigint<'env> {
  fn raw_value(&self) -> sys::napi_value {
    self.raw.value
  }

  fn from_raw(env: &'env Env, value: sys::napi_value) -> Result<Self> {
    let mut word_count: u64 = 0;
    check_status(unsafe {
      sys::napi_get_value_bigint_words(
        env.0,
        value,
        ptr::null_mut(),
        &mut word_count,
        ptr::null_mut(),
      )
    })?;
    Ok(JsBigint {
      raw: Value {
        env,
        value,
        value_type: ValueType::Bigint,
      },
      word_count,
    })
  }

  fn from_raw_unchecked(env: &'env Env, value: sys::napi_value) -> Self {
    let mut word_count: u64 = 0;
    let status = unsafe {
      sys::napi_get_value_bigint_words(
        env.0,
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
    JsBigint {
      raw: Value {
        env,
        value,
        value_type: ValueType::Bigint,
      },
      word_count,
    }
  }
}

/// The BigInt will be converted losslessly when the value is over what an int64 could hold.
impl<'env> TryFrom<JsBigint<'env>> for i64 {
  type Error = Error;

  fn try_from(value: JsBigint) -> Result<i64> {
    value.get_i64().map(|(v, _)| v)
  }
}

/// The BigInt will be converted losslessly when the value is over what an uint64 could hold.
impl<'env> TryFrom<JsBigint<'env>> for u64 {
  type Error = Error;

  fn try_from(value: JsBigint) -> Result<u64> {
    value.get_u64().map(|(v, _)| v)
  }
}

impl<'env> JsBigint<'env> {
  /// https://nodejs.org/api/n-api.html#n_api_napi_get_value_bigint_words
  #[inline]
  pub fn get_words(&mut self) -> Result<(bool, Vec<u64>)> {
    let mut words: Vec<u64> = Vec::with_capacity(self.word_count as usize);
    let word_count = &mut self.word_count;
    let mut sign_bit = 0;
    check_status(unsafe {
      sys::napi_get_value_bigint_words(
        self.raw.env.0,
        self.raw.value,
        &mut sign_bit,
        word_count,
        words.as_mut_ptr(),
      )
    })?;

    unsafe {
      words.set_len(self.word_count as usize);
    };

    Ok((sign_bit == 1, words))
  }

  #[inline]
  pub fn get_u64(&self) -> Result<(u64, bool)> {
    let mut val: u64 = 0;
    let mut loss = false;
    check_status(unsafe {
      sys::napi_get_value_bigint_uint64(self.raw.env.0, self.raw.value, &mut val, &mut loss)
    })?;

    Ok((val, loss))
  }

  #[inline]
  pub fn get_i64(&self) -> Result<(i64, bool)> {
    let mut val: i64 = 0;
    let mut loss: bool = false;
    check_status(unsafe {
      sys::napi_get_value_bigint_int64(self.raw.env.0, self.raw.value, &mut val, &mut loss)
    })?;
    Ok((val, loss))
  }

  #[inline]
  pub fn get_i128(&mut self) -> Result<(i128, bool)> {
    let (signed, words) = self.get_words()?;
    let len = words.len();
    let i128_words: [i64; 2] = [words[0] as _, words[1] as _];
    let mut val = unsafe { ptr::read(i128_words.as_ptr() as *const i128) };
    if signed {
      val = -val;
    }
    Ok((val, len > 2))
  }

  #[inline]
  pub fn get_u128(&mut self) -> Result<(bool, u128, bool)> {
    let (signed, words) = self.get_words()?;
    let len = words.len();
    let u128_words: [u64; 2] = [words[0], words[1]];
    let val = unsafe { ptr::read(u128_words.as_ptr() as *const u128) };
    Ok((signed, val, len > 2))
  }
}
