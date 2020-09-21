use std::convert::TryFrom;

use super::Value;
use crate::error::check_status;
use crate::{sys, Error, Result};

#[derive(Debug)]
pub struct JsBoolean<'env>(pub(crate) Value<'env>);

impl<'env> JsBoolean<'env> {
  pub fn get_value(&self) -> Result<bool> {
    let mut result = false;
    check_status(unsafe { sys::napi_get_value_bool(self.0.env.0, self.0.value, &mut result) })?;
    Ok(result)
  }
}

impl<'env> TryFrom<JsBoolean<'env>> for bool {
  type Error = Error;

  fn try_from(value: JsBoolean) -> Result<bool> {
    value.get_value()
  }
}
