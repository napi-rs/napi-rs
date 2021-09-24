use crate::{bindgen_prelude::*, check_status, sys, type_of, ValueType};
use std::{ffi::CString, ptr};

pub struct Object {
  env: sys::napi_env,
  inner: sys::napi_value,
}

impl Object {
  pub(crate) fn new(env: sys::napi_env) -> Result<Self> {
    let mut ptr = ptr::null_mut();
    unsafe {
      check_status!(
        sys::napi_create_object(env, &mut ptr),
        "Failed to create napi Object"
      )?;
    }

    Ok(Object { env, inner: ptr })
  }

  pub fn get<K: AsRef<str>, V: FromNapiValue>(&self, field: K) -> Result<Option<V>> {
    let c_field = CString::new(field.as_ref())?;

    unsafe {
      let mut ret = ptr::null_mut();

      check_status!(
        sys::napi_get_named_property(self.env, self.inner, c_field.as_ptr(), &mut ret),
        "Failed to get property with field `{}`",
        c_field.to_string_lossy(),
      )?;

      let ty = type_of!(self.env, ret)?;

      Ok(if ty == ValueType::Undefined {
        None
      } else {
        Some(V::from_napi_value(self.env, ret)?)
      })
    }
  }

  pub fn set<K: AsRef<str>, V: ToNapiValue>(&mut self, field: K, val: V) -> Result<()> {
    let c_field = CString::new(field.as_ref())?;

    unsafe {
      let napi_val = V::to_napi_value(self.env, val)?;

      check_status!(
        sys::napi_set_named_property(self.env, self.inner, c_field.as_ptr(), napi_val),
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
        sys::napi_get_property_names(obj.env, obj.inner, &mut names),
        "Failed to get property names of given object"
      )?;
    }

    let names = unsafe { Array::from_napi_value(obj.env, names)? };
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
}

impl ToNapiValue for Object {
  unsafe fn to_napi_value(_env: sys::napi_env, val: Self) -> Result<sys::napi_value> {
    Ok(val.inner)
  }
}

impl FromNapiValue for Object {
  unsafe fn from_napi_value(env: sys::napi_env, napi_val: sys::napi_value) -> Result<Self> {
    let value_type = type_of!(env, napi_val)?;
    match value_type {
      ValueType::Object => Ok(Self {
        inner: napi_val,
        env,
      }),
      _ => Err(Error::new(
        Status::InvalidArg,
        "Given napi value is not an object".to_owned(),
      )),
    }
  }
}
