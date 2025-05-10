use crate::{
  bindgen_prelude::{FromNapiValue, TypeName, ValidateNapiValue},
  sys, JsValue, Result, Value, ValueType,
};

#[deprecated(
  since = "3.0.0",
  note = "Please use `napi::bindgen_prelude::External` instead"
)]
pub struct JsExternal(pub(crate) Value);

impl TypeName for JsExternal {
  fn type_name() -> &'static str {
    "external"
  }

  fn value_type() -> ValueType {
    ValueType::External
  }
}

impl ValidateNapiValue for JsExternal {}

impl FromNapiValue for JsExternal {
  unsafe fn from_napi_value(env: sys::napi_env, napi_val: sys::napi_value) -> Result<Self> {
    Ok(Self(Value {
      env,
      value: napi_val,
      value_type: ValueType::External,
    }))
  }
}

impl JsValue<'_> for JsExternal {
  fn value(&self) -> Value {
    self.0
  }
}
