use super::check_status;
use crate::{bindgen_runtime::TypeName, sys, Result, Value, ValueType};

pub struct JsDate(pub(crate) Value);

impl TypeName for JsDate {
  fn type_name() -> &'static str {
    "Date"
  }

  fn value_type() -> crate::ValueType {
    ValueType::Object
  }
}

impl JsDate {
  pub fn value_of(&self) -> Result<f64> {
    let mut timestamp: f64 = 0.0;
    check_status!(unsafe { sys::napi_get_date_value(self.0.env, self.0.value, &mut timestamp) })?;
    Ok(timestamp)
  }
}
