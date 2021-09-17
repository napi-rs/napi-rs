use std::convert::From;
use std::ffi::CString;
use std::ptr;

use crate::{sys, Callback, Result};

#[derive(Clone, Default)]
pub struct Property {
  pub name: CString,
  getter: sys::napi_callback,
  setter: sys::napi_callback,
  method: sys::napi_callback,
  attrs: PropertyAttributes,
  pub(crate) is_ctor: bool,
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

impl Default for PropertyAttributes {
  fn default() -> Self {
    PropertyAttributes::Default
  }
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

impl Property {
  #[inline]
  pub fn new(name: &str) -> Result<Self> {
    Ok(Property {
      name: CString::new(name)?,
      ..Default::default()
    })
  }

  #[inline]
  pub fn with_name(mut self, name: &str) -> Self {
    self.name = CString::new(name).unwrap();
    self
  }

  #[inline]
  pub fn with_method(mut self, callback: Callback) -> Self {
    self.method = Some(callback);
    self
  }

  #[inline]
  pub fn with_getter(mut self, callback: Callback) -> Self {
    self.getter = Some(callback);
    self
  }

  #[inline]
  pub fn with_setter(mut self, callback: Callback) -> Self {
    self.setter = Some(callback);
    self
  }

  #[inline]
  pub fn with_property_attributes(mut self, attributes: PropertyAttributes) -> Self {
    self.attrs = attributes;
    self
  }

  #[inline]
  pub(crate) fn raw(&self) -> sys::napi_property_descriptor {
    sys::napi_property_descriptor {
      utf8name: self.name.as_ptr(),
      name: ptr::null_mut(),
      method: self.method,
      getter: self.getter,
      setter: self.setter,
      value: ptr::null_mut(),
      attributes: self.attrs.into(),
      data: ptr::null_mut(),
    }
  }

  #[inline]
  pub fn with_ctor(mut self, callback: Callback) -> Self {
    self.method = Some(callback);
    self.is_ctor = true;
    self
  }
}
