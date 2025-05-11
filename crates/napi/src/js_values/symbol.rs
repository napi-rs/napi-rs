use crate::{
  bindgen_runtime::{FromNapiValue, TypeName, ValidateNapiValue},
  sys, JsValue, Result, Value, ValueType,
};

#[derive(Clone, Copy)]
/// represent `Symbol` value in JavaScript
pub struct JsSymbol<'env>(
  pub(crate) Value,
  pub(crate) std::marker::PhantomData<&'env ()>,
);

impl TypeName for JsSymbol<'_> {
  fn type_name() -> &'static str {
    "symbol"
  }

  fn value_type() -> ValueType {
    ValueType::Symbol
  }
}

impl<'env> JsValue<'env> for JsSymbol<'env> {
  fn value(&self) -> Value {
    self.0
  }
}

impl FromNapiValue for JsSymbol<'_> {
  unsafe fn from_napi_value(env: sys::napi_env, napi_val: sys::napi_value) -> Result<Self> {
    Ok(JsSymbol(
      Value {
        env,
        value: napi_val,
        value_type: ValueType::Symbol,
      },
      std::marker::PhantomData,
    ))
  }
}

impl ValidateNapiValue for JsSymbol<'_> {}
