use crate::{bindgen_prelude::*, check_status, sys, ValueType};

impl TypeName for bool {
  fn type_name() -> &'static str {
    "bool"
  }
}

impl ValidateNapiValue for bool {
  fn type_of() -> Vec<ValueType> {
    vec![ValueType::Boolean]
  }
}

impl ToNapiValue for bool {
  unsafe fn to_napi_value(env: sys::napi_env, val: bool) -> Result<sys::napi_value> {
    let mut ptr = std::ptr::null_mut();

    check_status!(
      sys::napi_get_boolean(env, val, &mut ptr),
      "Failed to convert rust type `bool` into napi value",
    )?;

    Ok(ptr)
  }
}

impl FromNapiValue for bool {
  unsafe fn from_napi_value(env: sys::napi_env, napi_val: sys::napi_value) -> Result<Self> {
    let mut ret = false;

    check_status!(
      sys::napi_get_value_bool(env, napi_val, &mut ret),
      "Failed to convert napi value into rust type `bool`",
    )?;

    Ok(ret)
  }
}
