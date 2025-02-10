use std::ptr;

use crate::{bindgen_prelude::*, check_status, sys, type_of, Error, Result, Status, ValueType};

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Ord, PartialOrd)]
pub struct Null;
pub type Undefined = ();

impl TypeName for Null {
  fn type_name() -> &'static str {
    "null"
  }

  fn value_type() -> ValueType {
    ValueType::Null
  }
}

impl ValidateNapiValue for Null {}

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
      unsafe { sys::napi_get_null(env, &mut ret) },
      "Failed to create napi null value"
    )?;

    Ok(ret)
  }
}

impl ToNapiValue for &Null {
  unsafe fn to_napi_value(env: sys::napi_env, val: Self) -> Result<sys::napi_value> {
    ToNapiValue::to_napi_value(env, *val)
  }
}

impl ToNapiValue for &mut Null {
  unsafe fn to_napi_value(env: sys::napi_env, val: Self) -> Result<sys::napi_value> {
    ToNapiValue::to_napi_value(env, *val)
  }
}

impl TypeName for Undefined {
  fn type_name() -> &'static str {
    "undefined"
  }

  fn value_type() -> ValueType {
    ValueType::Undefined
  }
}

impl ValidateNapiValue for Undefined {}

impl FromNapiValue for Undefined {
  unsafe fn from_napi_value(env: sys::napi_env, napi_val: sys::napi_value) -> Result<Self> {
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
      unsafe { sys::napi_get_undefined(env, &mut ret) },
      "Failed to create napi undefined value"
    )?;

    Ok(ret)
  }
}

impl ToNapiValue for &Undefined {
  unsafe fn to_napi_value(env: sys::napi_env, _: Self) -> Result<sys::napi_value> {
    ToNapiValue::to_napi_value(env, ())
  }
}

impl ToNapiValue for &mut Undefined {
  unsafe fn to_napi_value(env: sys::napi_env, _: Self) -> Result<sys::napi_value> {
    ToNapiValue::to_napi_value(env, ())
  }
}
