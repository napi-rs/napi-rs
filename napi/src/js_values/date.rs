use super::check_status;
use crate::{sys, Result, Value};

#[repr(transparent)]
#[derive(Debug)]
pub struct JsDate(pub(crate) Value);

impl JsDate {
  pub fn value_of(&self) -> Result<f64> {
    let mut timestamp: f64 = 0.0;
    check_status(unsafe { sys::napi_get_date_value(self.0.env, self.0.value, &mut timestamp) })?;
    Ok(timestamp)
  }
}
