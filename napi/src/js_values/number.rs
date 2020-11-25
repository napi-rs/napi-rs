use std::convert::TryFrom;

use super::Value;
use crate::check_status;
use crate::{sys, Error, Result};

pub struct JsNumber(pub(crate) Value);

impl TryFrom<JsNumber> for usize {
  type Error = Error;

  fn try_from(value: JsNumber) -> Result<usize> {
    let mut result = 0;
    check_status!(unsafe { sys::napi_get_value_int64(value.0.env, value.0.value, &mut result) })?;
    Ok(result as usize)
  }
}

impl TryFrom<JsNumber> for u32 {
  type Error = Error;

  fn try_from(value: JsNumber) -> Result<u32> {
    let mut result = 0;
    check_status!(unsafe { sys::napi_get_value_uint32(value.0.env, value.0.value, &mut result) })?;
    Ok(result)
  }
}

impl TryFrom<JsNumber> for i32 {
  type Error = Error;

  fn try_from(value: JsNumber) -> Result<i32> {
    let mut result = 0;
    check_status!(unsafe { sys::napi_get_value_int32(value.0.env, value.0.value, &mut result) })?;
    Ok(result)
  }
}

impl TryFrom<JsNumber> for i64 {
  type Error = Error;

  fn try_from(value: JsNumber) -> Result<i64> {
    let mut result = 0;
    check_status!(unsafe { sys::napi_get_value_int64(value.0.env, value.0.value, &mut result) })?;
    Ok(result)
  }
}

impl TryFrom<JsNumber> for f64 {
  type Error = Error;

  fn try_from(value: JsNumber) -> Result<f64> {
    let mut result = 0_f64;
    check_status!(unsafe { sys::napi_get_value_double(value.0.env, value.0.value, &mut result) })?;
    Ok(result)
  }
}
