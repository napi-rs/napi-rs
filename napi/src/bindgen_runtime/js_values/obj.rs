use crate::{bindgen_prelude::*, check_status, sys, type_of, ValueType};
use std::{ffi::CString, ptr};

pub struct Object {
  env: sys::napi_env,
  inner: sys::napi_value,
}

pub struct Array {
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

  pub fn get<T: FromNapiValue>(&self, field: String) -> Result<Option<T>> {
    let c_field = CString::new(field)?;

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
        Some(T::from_napi_value(self.env, ret)?)
      })
    }
  }

  pub fn set<T: ToNapiValue>(&mut self, field: String, val: T) -> Result<()> {
    let c_field = CString::new(field)?;

    unsafe {
      let napi_val = T::to_napi_value(self.env, val)?;

      check_status!(
        sys::napi_set_named_property(self.env, self.inner, c_field.as_ptr(), napi_val),
        "Failed to set property with field `{}`",
        c_field.to_string_lossy(),
      )?;

      Ok(())
    }
  }
}

impl Array {
  pub(crate) fn new(env: sys::napi_env, len: u32) -> Result<Self> {
    let mut ptr = ptr::null_mut();
    unsafe {
      check_status!(
        sys::napi_create_array_with_length(env, len as usize, &mut ptr),
        "Failed to create napi Array"
      )?;
    }

    Ok(Array { env, inner: ptr })
  }

  pub fn get<T: FromNapiValue>(&self, index: u32) -> Result<Option<T>> {
    if index >= self.len()? {
      return Ok(None);
    }

    let mut ret = ptr::null_mut();
    unsafe {
      check_status!(
        sys::napi_get_element(self.env, self.inner, index, &mut ret),
        "Failed to get element with index `{}`",
        index,
      )?;

      Ok(Some(T::from_napi_value(self.env, ret)?))
    }
  }

  pub fn set<T: ToNapiValue>(&mut self, index: u32, val: T) -> Result<()> {
    unsafe {
      let napi_val = T::to_napi_value(self.env, val)?;

      check_status!(
        sys::napi_set_element(self.env, self.inner, index, napi_val),
        "Failed to set element with index `{}`",
        index,
      )?;

      Ok(())
    }
  }

  pub fn insert<T: ToNapiValue>(&mut self, val: T) -> Result<()> {
    self.set(self.len()?, val)?;
    Ok(())
  }

  #[allow(clippy::len_without_is_empty)]
  pub fn len(&self) -> Result<u32> {
    let len = ptr::null_mut();

    unsafe {
      check_status!(
        sys::napi_get_array_length(self.env, self.inner, len),
        "Failed to get Array length",
      )?;

      Ok(*len)
    }
  }
}

impl ToNapiValue for Array {
  unsafe fn to_napi_value(_env: sys::napi_env, val: Self) -> Result<sys::napi_value> {
    Ok(val.inner)
  }
}
