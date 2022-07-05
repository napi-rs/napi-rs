use std::convert::TryFrom;

use super::Value;
use crate::bindgen_runtime::{TypeName, ValidateNapiValue};
use crate::{check_status, ValueType};
use crate::{sys, Error, Result};

#[derive(Clone, Copy)]
pub struct JsBoolean(pub(crate) Value);

impl TypeName for JsBoolean {
  fn type_name() -> &'static str {
    "bool"
  }

  fn value_type() -> crate::ValueType {
    ValueType::Boolean
  }
}

impl ValidateNapiValue for JsBoolean {}

impl JsBoolean {
  pub fn get_value(&self) -> Result<bool> {
    let mut result = false;
    check_status!(unsafe { sys::napi_get_value_bool(self.0.env, self.0.value, &mut result) })?;
    Ok(result)
  }
}

impl TryFrom<JsBoolean> for bool {
  type Error = Error;

  fn try_from(value: JsBoolean) -> Result<bool> {
    value.get_value()
  }
}
