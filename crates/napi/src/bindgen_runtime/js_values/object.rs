use crate::{bindgen_prelude::*, check_status, sys, type_of, JsObject, ValueType};
use std::ptr;

pub type Object = JsObject;

impl Object {
  #[allow(unused)]
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

  pub fn get<V: FromNapiValue>(&self, field: &str) -> Result<Option<V>> {
    unsafe {
      self
        .get_inner(field)?
        .map(|v| V::from_napi_value(self.0.env, v))
        .transpose()
    }
  }

  fn get_inner(&self, field: &str) -> Result<Option<sys::napi_value>> {
    unsafe {
      let mut property_key = std::ptr::null_mut();
      check_status!(
        sys::napi_create_string_utf8(
          self.0.env,
          field.as_ptr().cast(),
          field.len() as isize,
          &mut property_key,
        ),
        "Failed to create property key with `{field}`"
      )?;

      let mut ret = ptr::null_mut();

      check_status!(
        sys::napi_get_property(self.0.env, self.0.value, property_key, &mut ret),
        "Failed to get property with field `{field}`",
      )?;

      let ty = type_of!(self.0.env, ret)?;

      Ok(if ty == ValueType::Undefined {
        None
      } else {
        Some(ret)
      })
    }
  }

  pub fn set<K: AsRef<str>, V: ToNapiValue>(&mut self, field: K, val: V) -> Result<()> {
    unsafe { self.set_inner(field.as_ref(), V::to_napi_value(self.0.env, val)?) }
  }

  unsafe fn set_inner(&mut self, field: &str, napi_val: sys::napi_value) -> Result<()> {
    let mut property_key = std::ptr::null_mut();
    check_status!(
      unsafe {
        sys::napi_create_string_utf8(
          self.0.env,
          field.as_ptr().cast(),
          field.len() as isize,
          &mut property_key,
        )
      },
      "Failed to create property key with `{field}`"
    )?;

    check_status!(
      unsafe { sys::napi_set_property(self.0.env, self.0.value, property_key, napi_val) },
      "Failed to set property with field `{field}`"
    )?;
    Ok(())
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
