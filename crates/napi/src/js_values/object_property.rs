use std::convert::From;
use std::ffi::CString;
use std::ptr;

use bitflags::bitflags;

use crate::{sys, Callback, NapiRaw, Result};

#[derive(Clone)]
pub struct Property {
  pub name: CString,
  getter: sys::napi_callback,
  setter: sys::napi_callback,
  method: sys::napi_callback,
  attrs: PropertyAttributes,
  value: sys::napi_value,
  pub(crate) is_ctor: bool,
}

impl Default for Property {
  fn default() -> Self {
    Property {
      name: Default::default(),
      getter: Default::default(),
      setter: Default::default(),
      method: Default::default(),
      attrs: Default::default(),
      value: ptr::null_mut(),
      is_ctor: Default::default(),
    }
  }
}

bitflags! {
  pub struct PropertyAttributes: i32 {
    const Default = sys::PropertyAttributes::default;
    const Writable = sys::PropertyAttributes::writable;
    const Enumerable = sys::PropertyAttributes::enumerable;
    const Configurable = sys::PropertyAttributes::configurable;
    const Static = sys::PropertyAttributes::static_;
  }
}

impl Default for PropertyAttributes {
  fn default() -> Self {
    PropertyAttributes::Configurable | PropertyAttributes::Enumerable | PropertyAttributes::Writable
  }
}

impl From<PropertyAttributes> for sys::napi_property_attributes {
  fn from(value: PropertyAttributes) -> Self {
    value.bits()
  }
}

impl Property {
  pub fn new(name: &str) -> Result<Self> {
    Ok(Property {
      name: CString::new(name)?,
      ..Default::default()
    })
  }

  pub fn with_name(mut self, name: &str) -> Self {
    self.name = CString::new(name).unwrap();
    self
  }

  pub fn with_method(mut self, callback: Callback) -> Self {
    self.method = Some(callback);
    self
  }

  pub fn with_getter(mut self, callback: Callback) -> Self {
    self.getter = Some(callback);
    self
  }

  pub fn with_setter(mut self, callback: Callback) -> Self {
    self.setter = Some(callback);
    self
  }

  pub fn with_property_attributes(mut self, attributes: PropertyAttributes) -> Self {
    self.attrs = attributes;
    self
  }

  pub fn with_value<T: NapiRaw>(mut self, value: &T) -> Self {
    self.value = unsafe { T::raw(value) };
    self
  }

  pub(crate) fn raw(&self) -> sys::napi_property_descriptor {
    sys::napi_property_descriptor {
      utf8name: self.name.as_ptr(),
      name: ptr::null_mut(),
      method: self.method,
      getter: self.getter,
      setter: self.setter,
      value: self.value,
      attributes: self.attrs.into(),
      data: ptr::null_mut(),
    }
  }

  pub fn with_ctor(mut self, callback: Callback) -> Self {
    self.method = Some(callback);
    self.is_ctor = true;
    self
  }
}
