use std::ptr;

use crate::{sys, Callback, Env, NapiValue, Result};

#[derive(Clone, Debug)]
pub struct Property {
  name: String,
  raw_descriptor: sys::napi_property_descriptor,
}

impl Property {
  pub fn new(name: &str) -> Self {
    Property {
      name: String::from(name),
      raw_descriptor: sys::napi_property_descriptor {
        utf8name: ptr::null_mut(),
        name: ptr::null_mut(),
        method: None,
        getter: None,
        setter: None,
        value: ptr::null_mut(),
        attributes: sys::napi_property_attributes::napi_default,
        data: ptr::null_mut(),
      },
    }
  }

  pub fn with_value<T: NapiValue>(mut self, value: T) -> Self {
    self.raw_descriptor.value = T::raw_value(&value);
    self
  }

  pub fn with_method(mut self, callback: Callback) -> Self {
    self.raw_descriptor.method = Some(callback);
    self
  }

  pub fn with_getter(mut self, callback: Callback) -> Self {
    self.raw_descriptor.getter = Some(callback);
    self
  }

  pub(crate) fn into_raw(mut self, env: &Env) -> Result<sys::napi_property_descriptor> {
    self.raw_descriptor.name = env.create_string(&self.name)?.into_raw();
    Ok(self.raw_descriptor)
  }
}
