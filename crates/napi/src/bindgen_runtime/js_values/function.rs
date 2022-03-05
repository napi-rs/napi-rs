use super::ValidateNapiValue;

pub use crate::JsFunction;

impl ValidateNapiValue for JsFunction {
  fn type_of() -> Vec<crate::ValueType> {
    vec![crate::ValueType::Function]
  }
}
