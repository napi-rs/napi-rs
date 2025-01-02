use super::*;
use crate::bindgen_runtime::{FnArgs, FromNapiValue, Function, Unknown};

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
    let func: Function<V, std::string::String> = self.get_named_property_unchecked("stringify")?;
    func.call(value)
  }
}

type SupportType<'a> = Function<'a, FnArgs<(Function<'a, (), Unknown>, f64)>, JsTimeout>;
impl JsGlobal {
  pub fn set_interval(&self, handler: Function<(), Unknown>, interval: f64) -> Result<JsTimeout> {
    let func: SupportType = self.get_named_property_unchecked("setInterval")?;
    func.call(FnArgs {
      data: (handler, interval),
    })
  }

  pub fn clear_interval(&self, timer: JsTimeout) -> Result<JsUndefined> {
    let func: Function<JsTimeout, JsUndefined> =
      self.get_named_property_unchecked("clearInterval")?;
    func.call(timer)
  }

  pub fn set_timeout(&self, handler: Function<(), Unknown>, interval: f64) -> Result<JsTimeout> {
    let func: SupportType = self.get_named_property_unchecked("setTimeout")?;
    func.call(FnArgs {
      data: (handler, interval),
    })
  }

  pub fn clear_timeout(&self, timer: JsTimeout) -> Result<JsUndefined> {
    let func: Function<JsTimeout, JsUndefined> =
      self.get_named_property_unchecked("clearTimeout")?;
    func.call(timer)
  }
}
