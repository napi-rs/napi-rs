use super::*;
use crate::bindgen_runtime::{FnArgs, FromNapiValue, Function, Unknown};

pub struct JsGlobal<'env>(
  pub(crate) Value,
  pub(crate) std::marker::PhantomData<&'env ()>,
);

impl JsValue for JsGlobal<'_> {
  fn value(&self) -> Value {
    self.0
  }
}

impl JsObjectValue for JsGlobal<'_> {}

pub struct JsTimeout<'env>(
  pub(crate) Value,
  pub(crate) std::marker::PhantomData<&'env ()>,
);

impl JsValue for JsTimeout<'_> {
  fn value(&self) -> Value {
    self.0
  }
}

impl JsObjectValue for JsTimeout<'_> {}

impl FromNapiValue for JsTimeout<'_> {
  unsafe fn from_napi_value(env: sys::napi_env, napi_val: sys::napi_value) -> Result<Self> {
    Ok(JsTimeout(
      Value {
        env,
        value: napi_val,
        value_type: ValueType::Object,
      },
      std::marker::PhantomData,
    ))
  }
}
pub struct JSON<'env>(
  pub(crate) Value,
  pub(crate) std::marker::PhantomData<&'env ()>,
);

impl JsValue for JSON<'_> {
  fn value(&self) -> Value {
    self.0
  }
}

impl JsObjectValue for JSON<'_> {}

impl FromNapiValue for JSON<'_> {
  unsafe fn from_napi_value(env: sys::napi_env, napi_val: sys::napi_value) -> Result<Self> {
    Ok(JSON(
      Value {
        env,
        value: napi_val,
        value_type: ValueType::Object,
      },
      std::marker::PhantomData,
    ))
  }
}

impl JSON<'_> {
  pub fn stringify<V: NapiRaw>(&self, value: V) -> Result<std::string::String> {
    let func: Function<V, std::string::String> = self.get_named_property_unchecked("stringify")?;
    func.call(value)
  }
}

type SupportType<'a> = Function<'a, FnArgs<(Function<'a, (), Unknown>, f64)>, JsTimeout<'a>>;

impl<'env> JsGlobal<'env> {
  pub fn set_interval(
    &self,
    handler: Function<(), Unknown>,
    interval: f64,
  ) -> Result<JsTimeout<'env>> {
    let func: SupportType = self.get_named_property_unchecked("setInterval")?;
    func.call(FnArgs {
      data: (handler, interval),
    })
  }

  pub fn clear_interval(&self, timer: JsTimeout) -> Result<()> {
    let func: Function<JsTimeout, ()> = self.get_named_property_unchecked("clearInterval")?;
    func.call(timer)
  }

  pub fn set_timeout(
    &self,
    handler: Function<(), Unknown>,
    interval: f64,
  ) -> Result<JsTimeout<'env>> {
    let func: SupportType = self.get_named_property_unchecked("setTimeout")?;
    func.call(FnArgs {
      data: (handler, interval),
    })
  }

  pub fn clear_timeout(&self, timer: JsTimeout) -> Result<()> {
    let func: Function<JsTimeout, ()> = self.get_named_property_unchecked("clearTimeout")?;
    func.call(timer)
  }
}
