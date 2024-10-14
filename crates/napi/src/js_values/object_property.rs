use std::convert::From;
#[cfg(feature = "napi5")]
use std::ffi::c_void;
use std::ffi::CString;
use std::ptr;

use bitflags::bitflags;

#[cfg(feature = "napi5")]
use crate::bindgen_runtime::{FromNapiValue, This};
use crate::{bindgen_runtime::ToNapiValue, sys, Callback, Env, NapiRaw, Result};

#[cfg(feature = "napi5")]
#[derive(Copy, Clone)]
pub struct PropertyClosures {
  pub setter_closure: *mut c_void,
  pub getter_closure: *mut c_void,
}

#[cfg(feature = "napi5")]
impl Default for PropertyClosures {
  fn default() -> Self {
    Self {
      setter_closure: ptr::null_mut(),
      getter_closure: ptr::null_mut(),
    }
  }
}

#[derive(Clone)]
pub struct Property {
  pub name: CString,
  getter: sys::napi_callback,
  setter: sys::napi_callback,
  method: sys::napi_callback,
  attrs: PropertyAttributes,
  value: sys::napi_value,
  pub(crate) is_ctor: bool,
  #[cfg(feature = "napi5")]
  pub(crate) closures: PropertyClosures,
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
      #[cfg(feature = "napi5")]
      closures: PropertyClosures::default(),
    }
  }
}

bitflags! {
  #[derive(Debug, Copy, Clone)]
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

  #[cfg(feature = "napi5")]
  pub fn with_getter_closure<R, F>(mut self, callback: F) -> Self
  where
    F: 'static + Fn(Env, This) -> Result<R>,
    R: ToNapiValue,
  {
    let boxed_callback = Box::new(callback);
    let closure_data_ptr: *mut F = Box::into_raw(boxed_callback);
    self.closures.getter_closure = closure_data_ptr.cast();

    let fun = crate::trampoline_getter::<R, F>;
    self.getter = Some(fun);
    self
  }

  pub fn with_setter(mut self, callback: Callback) -> Self {
    self.setter = Some(callback);
    self
  }

  #[cfg(feature = "napi5")]
  pub fn with_setter_closure<F, V>(mut self, callback: F) -> Self
  where
    F: 'static + Fn(crate::Env, This, V) -> Result<()>,
    V: FromNapiValue,
  {
    let boxed_callback = Box::new(callback);
    let closure_data_ptr: *mut F = Box::into_raw(boxed_callback);
    self.closures.setter_closure = closure_data_ptr.cast();

    let fun = crate::trampoline_setter::<V, F>;
    self.setter = Some(fun);
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

  pub fn with_napi_value<T: ToNapiValue>(mut self, env: &Env, value: T) -> Result<Self> {
    self.value = unsafe { T::to_napi_value(env.0, value)? };
    Ok(self)
  }

  pub(crate) fn raw(&self) -> sys::napi_property_descriptor {
    #[cfg(feature = "napi5")]
    let closures = Box::into_raw(Box::new(self.closures));
    sys::napi_property_descriptor {
      utf8name: self.name.as_ptr(),
      name: ptr::null_mut(),
      method: self.method,
      getter: self.getter,
      setter: self.setter,
      value: self.value,
      attributes: self.attrs.into(),
      #[cfg(not(feature = "napi5"))]
      data: ptr::null_mut(),
      #[cfg(feature = "napi5")]
      data: closures.cast(),
    }
  }

  pub fn with_ctor(mut self, callback: Callback) -> Self {
    self.method = Some(callback);
    self.is_ctor = true;
    self
  }
}
