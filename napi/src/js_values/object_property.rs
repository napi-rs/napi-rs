use std::convert::From;
use std::ffi::CString;
use std::ptr;

use crate::{error::check_status, sys, Callback, Env, NapiValue, Result};

#[derive(Debug, Clone, Copy)]
pub struct Property<'env> {
  name: &'env str,
  pub(crate) raw_descriptor: sys::napi_property_descriptor,
}

#[repr(u32)]
#[derive(Debug, Copy, Clone, PartialEq, Eq, Hash)]
pub enum PropertyAttributes {
  Default = sys::napi_property_attributes::napi_default as _,
  Writable = sys::napi_property_attributes::napi_writable as _,
  Enumerable = sys::napi_property_attributes::napi_enumerable as _,
  Configurable = sys::napi_property_attributes::napi_configurable as _,
  Static = sys::napi_property_attributes::napi_static as _,
}

impl From<PropertyAttributes> for sys::napi_property_attributes {
  fn from(value: PropertyAttributes) -> Self {
    match value {
      PropertyAttributes::Default => sys::napi_property_attributes::napi_default,
      PropertyAttributes::Writable => sys::napi_property_attributes::napi_writable,
      PropertyAttributes::Enumerable => sys::napi_property_attributes::napi_enumerable,
      PropertyAttributes::Configurable => sys::napi_property_attributes::napi_configurable,
      PropertyAttributes::Static => sys::napi_property_attributes::napi_static,
    }
  }
}

impl<'env> Property<'env> {
  pub fn new(env: &'env Env, name: &'env str) -> Result<Self> {
    let string_value = CString::new(name)?;
    let mut result = ptr::null_mut();
    check_status(unsafe {
      sys::napi_create_string_utf8(env.0, string_value.as_ptr(), name.len() as _, &mut result)
    })?;
    Ok(Property {
      name,
      raw_descriptor: sys::napi_property_descriptor {
        utf8name: ptr::null_mut(),
        name: result,
        method: None,
        getter: None,
        setter: None,
        value: ptr::null_mut(),
        attributes: sys::napi_property_attributes::napi_default,
        data: ptr::null_mut(),
      },
    })
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

  pub fn with_setter(mut self, callback: Callback) -> Self {
    self.raw_descriptor.setter = Some(callback);
    self
  }

  pub fn with_property_attributes(mut self, attributes: PropertyAttributes) {
    self.raw_descriptor.attributes = attributes.into();
  }

  pub(crate) fn raw(&self) -> sys::napi_property_descriptor {
    self.raw_descriptor
  }
}
