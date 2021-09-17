use std::ptr;

use crate::{bindgen_prelude::*, check_status, sys, type_of, Error, Result, Status, ValueType};

pub struct Null;
pub type Undefined = ();

impl TypeName for Null {
  fn type_name() -> &'static str {
    "null"
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

impl ToNapiValue for Result<()> {
  unsafe fn to_napi_value(env: sys::napi_env, val: Self) -> Result<sys::napi_value> {
    match val {
      Ok(_) => Ok(Null::to_napi_value(env, Null).unwrap_or_else(|_| ptr::null_mut())),
      Err(e) => {
        let error_code = String::to_napi_value(env, format!("{:?}", e.status))?;
        let reason = String::to_napi_value(env, e.reason)?;
        let mut error = ptr::null_mut();
        check_status!(
          sys::napi_create_error(env, error_code, reason, &mut error),
          "Failed to create napi error"
        )?;

        Ok(error)
      }
    }
  }
}
