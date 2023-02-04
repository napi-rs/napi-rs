use std::convert::TryInto;

use super::*;
use crate::{bindgen_runtime::FromNapiValue, Env};

pub struct JsGlobal(pub(crate) Value);

pub struct JsTimeout(pub(crate) Value);

pub struct JSON(pub(crate) Value);

impl FromNapiValue for JSON {
  unsafe fn from_napi_value(env: sys::napi_env, napi_val: sys::napi_value) -> Result<Self> {
    Ok(JSON(Value {
      env,
      value: napi_val,
      value_type: ValueType::Object,
    }))
  }
}

impl JSON {
  pub fn stringify<V: NapiRaw>(&self, value: V) -> Result<std::string::String> {
    let func: JsFunction = self.get_named_property_unchecked("stringify")?;
    let result = func
      .call(None, &[value])
      .map(|ret| unsafe { ret.cast::<JsString>() })?;
    result.into_utf8()?.as_str().map(|s| s.to_owned())
  }
}

impl JsGlobal {
  pub fn set_interval(&self, handler: JsFunction, interval: f64) -> Result<JsTimeout> {
    let func: JsFunction = self.get_named_property_unchecked("setInterval")?;
    func
      .call(
        None,
        &[
          handler.into_unknown(),
          unsafe { Env::from_raw(self.0.env) }
            .create_double(interval)?
            .into_unknown(),
        ],
      )
      .and_then(|ret| ret.try_into())
  }

  pub fn clear_interval(&self, timer: JsTimeout) -> Result<JsUndefined> {
    let func: JsFunction = self.get_named_property_unchecked("clearInterval")?;
    func
      .call(None, &[timer.into_unknown()])
      .and_then(|ret| ret.try_into())
  }

  pub fn set_timeout(&self, handler: JsFunction, interval: f64) -> Result<JsTimeout> {
    let func: JsFunction = self.get_named_property_unchecked("setTimeout")?;
    func
      .call(
        None,
        &[
          handler.into_unknown(),
          unsafe { Env::from_raw(self.0.env) }
            .create_double(interval)?
            .into_unknown(),
        ],
      )
      .and_then(|ret| ret.try_into())
  }

  pub fn clear_timeout(&self, timer: JsTimeout) -> Result<JsUndefined> {
    let func: JsFunction = self.get_named_property_unchecked("clearTimeout")?;
    func
      .call(None, &[timer.into_unknown()])
      .and_then(|ret| ret.try_into())
  }
}
