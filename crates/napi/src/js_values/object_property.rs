use std::convert::From;
use std::ffi::c_void;
use std::ffi::CString;
use std::ptr;
#[cfg(feature = "napi5")]
use std::rc::Rc;

use bitflags::bitflags;

#[cfg(feature = "napi5")]
use crate::bindgen_runtime::{FromNapiValue, This};
use crate::{bindgen_runtime::ToNapiValue, sys, Callback, Env, JsValue, Result};

#[cfg(feature = "napi5")]
#[derive(Copy, Clone)]
pub struct PropertyClosures {
  pub setter_closure: *mut c_void,
  pub getter_closure: *mut c_void,
  /// Still filled, but no longer used to drop the closure: the boxed callback
  /// data owns it now. Kept so this public struct does not change.
  pub setter_drop_fn: Option<unsafe fn(*mut c_void)>,
  /// See `setter_drop_fn`.
  pub getter_drop_fn: Option<unsafe fn(*mut c_void)>,
}

#[cfg(feature = "napi5")]
impl Default for PropertyClosures {
  fn default() -> Self {
    Self {
      setter_closure: ptr::null_mut(),
      getter_closure: ptr::null_mut(),
      setter_drop_fn: None,
      getter_drop_fn: None,
    }
  }
}

/// Owns one boxed accessor closure and drops it with the last reference.
#[cfg(feature = "napi5")]
pub(crate) struct OwnedClosure {
  ptr: *mut c_void,
  drop_fn: unsafe fn(*mut c_void),
}

#[cfg(feature = "napi5")]
impl Drop for OwnedClosure {
  fn drop(&mut self) {
    unsafe { (self.drop_fn)(self.ptr) };
  }
}

/// The callback data `Property::raw` boxes. `closures` comes first, so the
/// trampolines can read the data as a `PropertyClosures`.
#[cfg(feature = "napi5")]
#[repr(C)]
pub(crate) struct PropertyClosuresData {
  closures: PropertyClosures,
  _owners: [Option<Rc<OwnedClosure>>; 2],
}

#[derive(Clone)]
pub struct Property {
  utf8_name: Option<CString>,
  #[cfg(feature = "napi9")]
  symbol_name: Option<String>,
  name: sys::napi_value,
  getter: sys::napi_callback,
  setter: sys::napi_callback,
  method: sys::napi_callback,
  attrs: PropertyAttributes,
  value: sys::napi_value,
  data: *mut c_void,
  pub(crate) is_ctor: bool,
  #[cfg(feature = "napi5")]
  pub(crate) closures: PropertyClosures,
  #[cfg(feature = "napi5")]
  getter_owner: Option<Rc<OwnedClosure>>,
  #[cfg(feature = "napi5")]
  setter_owner: Option<Rc<OwnedClosure>>,
}

impl Default for Property {
  fn default() -> Self {
    Property {
      utf8_name: Default::default(),
      #[cfg(feature = "napi9")]
      symbol_name: None,
      name: ptr::null_mut(),
      getter: Default::default(),
      setter: Default::default(),
      method: Default::default(),
      attrs: Default::default(),
      value: ptr::null_mut(),
      data: ptr::null_mut(),
      is_ctor: Default::default(),
      #[cfg(feature = "napi5")]
      closures: PropertyClosures::default(),
      #[cfg(feature = "napi5")]
      getter_owner: None,
      #[cfg(feature = "napi5")]
      setter_owner: None,
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
  pub fn new() -> Self {
    Default::default()
  }

  /// Replaces any key set earlier on this `Property`.
  pub fn with_utf8_name(mut self, name: &str) -> Result<Self> {
    self.utf8_name = Some(CString::new(name)?);
    self.name = ptr::null_mut();
    #[cfg(feature = "napi9")]
    {
      self.symbol_name = None;
    }
    Ok(self)
  }

  /// Stores a global symbol key, resolved in the current environment when the
  /// property is defined. Replaces any key set earlier on this `Property`.
  /// Requires the `napi9` feature or a higher Node-API feature.
  ///
  /// Used by `#[napi(symbol_for)]` codegen. Not public API and not covered by
  /// semver.
  #[cfg(feature = "napi9")]
  #[doc(hidden)]
  pub fn with_symbol_name(mut self, name: &str) -> Self {
    self.utf8_name = None;
    self.name = ptr::null_mut();
    self.symbol_name = Some(name.to_owned());
    self
  }

  /// Replaces any key set earlier on this `Property`.
  pub fn with_name<T: ToNapiValue>(mut self, env: &Env, name: T) -> Result<Self> {
    self.name = unsafe { T::to_napi_value(env.0, name)? };
    self.utf8_name = None;
    #[cfg(feature = "napi9")]
    {
      self.symbol_name = None;
    }
    Ok(self)
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
    let drop_fn = |ptr: *mut c_void| unsafe {
      drop(Box::from_raw(ptr as *mut F));
    };
    self.closures.getter_closure = closure_data_ptr.cast();
    self.closures.getter_drop_fn = Some(drop_fn);
    self.getter_owner = Some(Rc::new(OwnedClosure {
      ptr: closure_data_ptr.cast(),
      drop_fn,
    }));

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
    let drop_fn = |ptr: *mut c_void| unsafe {
      drop(Box::from_raw(ptr as *mut F));
    };
    self.closures.setter_closure = closure_data_ptr.cast();
    self.closures.setter_drop_fn = Some(drop_fn);
    self.setter_owner = Some(Rc::new(OwnedClosure {
      ptr: closure_data_ptr.cast(),
      drop_fn,
    }));

    let fun = crate::trampoline_setter::<V, F>;
    self.setter = Some(fun);
    self
  }

  pub fn with_property_attributes(mut self, attributes: PropertyAttributes) -> Self {
    self.attrs = attributes;
    self
  }

  pub fn with_value<'env, T: JsValue<'env>>(mut self, value: &T) -> Self {
    self.value = T::raw(value);
    self
  }

  pub fn with_napi_value<T: ToNapiValue>(mut self, env: &Env, value: T) -> Result<Self> {
    self.value = unsafe { T::to_napi_value(env.0, value)? };
    Ok(self)
  }

  #[doc(hidden)]
  pub fn with_data(mut self, data: *mut c_void) -> Self {
    self.data = data;
    self
  }

  #[cfg(all(feature = "napi5", not(feature = "noop")))]
  pub(crate) fn has_owned_closure(&self) -> bool {
    self.getter_owner.is_some() || self.setter_owner.is_some()
  }

  #[cfg(feature = "napi5")]
  pub(crate) fn has_closure_data(&self) -> bool {
    self.data.is_null()
      && (!self.closures.getter_closure.is_null() || !self.closures.setter_closure.is_null())
  }

  pub(crate) fn raw(&self, _env: sys::napi_env) -> Result<sys::napi_property_descriptor> {
    let name = self.name;
    // Only the registry key is shared across environments, never a napi_value.
    // The lookup runs before this property's closure data is allocated.
    #[cfg(feature = "napi9")]
    let name = if let Some(symbol_name) = &self.symbol_name {
      let mut symbol = ptr::null_mut();
      crate::check_status!(unsafe {
        sys::node_api_symbol_for(
          _env,
          symbol_name.as_ptr().cast(),
          symbol_name.len() as isize,
          &mut symbol,
        )
      })?;
      symbol
    } else {
      name
    };
    #[cfg(feature = "napi5")]
    let data = if !self.data.is_null() {
      self.data
    } else if self.closures.getter_closure.is_null() && self.closures.setter_closure.is_null() {
      // No closures to allocate, avoid memory leak
      ptr::null_mut()
    } else {
      // Only allocate when we actually have closures
      Box::into_raw(Box::new(PropertyClosuresData {
        closures: self.closures,
        _owners: [self.getter_owner.clone(), self.setter_owner.clone()],
      }))
      .cast()
    };

    Ok(sys::napi_property_descriptor {
      utf8name: match self.utf8_name {
        Some(ref name) => name.as_ptr(),
        None => ptr::null(),
      },
      name,
      method: self.method,
      getter: self.getter,
      setter: self.setter,
      value: self.value,
      attributes: self.attrs.into(),
      #[cfg(not(feature = "napi5"))]
      data: self.data,
      #[cfg(feature = "napi5")]
      data,
    })
  }

  pub fn with_ctor(mut self, callback: Callback) -> Self {
    self.method = Some(callback);
    self.is_ctor = true;
    self
  }
}

/// Builds the symbol-keyed `Property` for `#[napi(symbol_for = "...")]`.
/// Checked against the features of this crate, so a missing `napi9` gives a
/// clear error instead of a missing method.
#[cfg(feature = "napi9")]
#[doc(hidden)]
#[macro_export]
macro_rules! symbol_for_property {
  ($name:expr) => {
    $crate::bindgen_prelude::Property::new().with_symbol_name($name)
  };
}

#[cfg(not(feature = "napi9"))]
#[doc(hidden)]
#[macro_export]
macro_rules! symbol_for_property {
  ($name:expr) => {{
    compile_error!("`symbol_for` requires the `napi9` feature of the `napi` crate");
    $crate::bindgen_prelude::Property::new()
  }};
}

#[cfg(all(test, feature = "napi9"))]
mod tests {
  use super::*;

  // Name conversion is stubbed so the builder can be tested without a JS
  // environment. The opaque value is only compared, never dereferenced.
  struct TestName;

  impl ToNapiValue for TestName {
    unsafe fn to_napi_value(_env: sys::napi_env, _value: Self) -> Result<sys::napi_value> {
      Ok(ptr::dangling_mut())
    }
  }

  #[test]
  fn utf8_name_replaces_symbol_and_value_names() {
    let env = Env::from_raw(ptr::null_mut());
    for property in [
      Property::new().with_symbol_name("old"),
      Property::new().with_name(&env, TestName).unwrap(),
    ] {
      let property = property.with_utf8_name("new").unwrap();
      assert_eq!(property.utf8_name.as_ref().unwrap().as_bytes(), b"new");
      assert!(property.symbol_name.is_none());
      assert!(property.name.is_null());
    }
  }

  #[test]
  fn value_name_replaces_symbol_and_utf8_names() {
    let env = Env::from_raw(ptr::null_mut());
    for property in [
      Property::new().with_symbol_name("old"),
      Property::new().with_utf8_name("old").unwrap(),
    ] {
      let property = property.with_name(&env, TestName).unwrap();
      assert!(property.utf8_name.is_none());
      assert!(property.symbol_name.is_none());
      assert_eq!(property.name, ptr::dangling_mut());
    }
  }

  #[test]
  fn symbol_name_replaces_utf8_and_value_names() {
    let env = Env::from_raw(ptr::null_mut());
    for property in [
      Property::new().with_utf8_name("old").unwrap(),
      Property::new().with_name(&env, TestName).unwrap(),
    ] {
      let property = property.with_symbol_name("new");
      assert_eq!(property.symbol_name.as_deref(), Some("new"));
      assert!(property.utf8_name.is_none());
      assert!(property.name.is_null());
    }
  }

  #[cfg(not(feature = "noop"))]
  #[test]
  #[should_panic(expected = "register_class does not accept closure-backed properties")]
  fn register_class_rejects_closure_properties() {
    struct ClosureClass;
    let property = Property::new()
      .with_utf8_name("value")
      .unwrap()
      .with_getter_closure(|_env, _this| Ok(1u32));
    crate::bindgen_runtime::register_class(
      std::any::TypeId::of::<ClosureClass>(),
      None,
      "ClosureClass",
      vec![property],
      false,
    );
  }
}
