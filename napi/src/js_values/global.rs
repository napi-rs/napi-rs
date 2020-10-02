use std::convert::TryInto;

use super::*;
use crate::Env;

#[repr(transparent)]
#[derive(Debug)]
pub struct JsGlobal(pub(crate) Value);

#[repr(transparent)]
#[derive(Debug)]
pub struct JsTimeout(pub(crate) Value);

impl JsGlobal {
  pub fn set_interval(&self, handler: JsFunction, interval: f64) -> Result<JsTimeout> {
    let func: JsFunction = self.get_named_property("setInterval")?;
    func
      .call(
        None,
        &[
          handler.into_unknown(),
          Env::from_raw(self.0.env)
            .create_double(interval)?
            .into_unknown(),
        ],
      )
      .and_then(|ret| ret.try_into())
  }
}
