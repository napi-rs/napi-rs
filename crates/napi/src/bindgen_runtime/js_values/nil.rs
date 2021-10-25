use std::ptr;

use crate::{bindgen_prelude::*, check_status, sys, type_of, Error, Result, Status, ValueType};

pub struct Null;
pub type Undefined = ();

impl TypeName for Null {
  fn type_name() -> &'static str {
    "null"
  }
}

impl ValidateNapiValue for Null {
  fn type_of() -> Vec<ValueType> {
    vec![ValueType::Null]
  }
}

impl FromNapiValue for Null {
  unsafe fn from_napi_value(env: sys::napi_env, napi_val: sys::napi_value) -> Result<Self> {
    match type_of!(env, napi_val) {
      Ok(ValueType::Null) => Ok(Null),
      _ => Err(Error::new(
        Status::InvalidArg,
        "Value is not null".to_owned(),
      )),
    }
  }
}

impl ToNapiValue for Null {
  unsafe fn to_napi_value(env: sys::napi_env, _val: Self) -> Result<sys::napi_value> {
    let mut ret = ptr::null_mut();

    check_status!(
      sys::napi_get_null(env, &mut ret),
      "Failed to create napi null value"
    )?;

    Ok(ret)
  }
}

impl TypeName for Undefined {
  fn type_name() -> &'static str {
    "undefined"
  }
}

impl ValidateNapiValue for Undefined {
  fn type_of() -> Vec<ValueType> {
    vec![ValueType::Undefined]
  }
}

impl FromNapiValue for Undefined {
  unsafe fn from_napi_value(env: sys::napi_env, napi_val: sys::napi_value) -> Result<Self> {
    // TODO: with typecheck
    match type_of!(env, napi_val) {
      Ok(ValueType::Undefined) => Ok(()),
      _ => Err(Error::new(
        Status::InvalidArg,
        "Value is not undefined".to_owned(),
      )),
    }
  }
}

impl ToNapiValue for Undefined {
  unsafe fn to_napi_value(env: sys::napi_env, _val: Self) -> Result<sys::napi_value> {
    let mut ret = ptr::null_mut();

    check_status!(
      sys::napi_get_undefined(env, &mut ret),
      "Failed to create napi null value"
    )?;

    Ok(ret)
  }
}
