use std::ptr;

use crate::{bindgen_prelude::*, check_status, sys, type_of, Error, Result, Status, ValueType};

pub struct Null;

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
