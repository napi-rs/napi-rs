use crate::{bindgen_prelude::*, check_status, sys, type_of, JsObject, ValueType};
use std::{ffi::CString, ptr};

pub type Object = JsObject;

impl Object {
  #[cfg(feature = "serde-json")]
  pub(crate) fn new(env: sys::napi_env) -> Result<Self> {
    let mut ptr = ptr::null_mut();
    unsafe {
      check_status!(
        sys::napi_create_object(env, &mut ptr),
        "Failed to create napi Object"
      )?;
    }

    Ok(Self(crate::Value {
      env,
      value: ptr,
      value_type: ValueType::Object,
    }))
  }

  pub fn get<K: AsRef<str>, V: FromNapiValue>(&self, field: K) -> Result<Option<V>> {
    let c_field = CString::new(field.as_ref())?;

    unsafe {
      let mut ret = ptr::null_mut();

      check_status!(
        sys::napi_get_named_property(self.0.env, self.0.value, c_field.as_ptr(), &mut ret),
        "Failed to get property with field `{}`",
        field.as_ref(),
      )?;

      let ty = type_of!(self.0.env, ret)?;

      Ok(if ty == ValueType::Undefined {
        None
      } else {
        Some(V::from_napi_value(self.0.env, ret)?)
      })
    }
  }

  pub fn set<K: AsRef<str>, V: ToNapiValue>(&mut self, field: K, val: V) -> Result<()> {
    let c_field = CString::new(field.as_ref())?;

    unsafe {
      let napi_val = V::to_napi_value(self.0.env, val)?;

      check_status!(
        sys::napi_set_named_property(self.0.env, self.0.value, c_field.as_ptr(), napi_val),
        "Failed to set property with field `{}`",
        c_field.to_string_lossy(),
      )?;

      Ok(())
    }
  }

  pub fn keys(obj: &Object) -> Result<Vec<String>> {
    let mut names = ptr::null_mut();
    unsafe {
      check_status!(
        sys::napi_get_property_names(obj.0.env, obj.0.value, &mut names),
        "Failed to get property names of given object"
      )?;
    }

    let names = unsafe { Array::from_napi_value(obj.0.env, names)? };
    let mut ret = vec![];

    for i in 0..names.len() {
      ret.push(names.get::<String>(i)?.unwrap());
    }

    Ok(ret)
  }
}

impl TypeName for Object {
  fn type_name() -> &'static str {
    "Object"
  }

  fn value_type() -> ValueType {
    ValueType::Object
  }
}

impl ValidateNapiValue for JsObject {}
