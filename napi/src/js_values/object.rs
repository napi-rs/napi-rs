use std::ffi::CString;
use std::ptr;

use super::Value;
use crate::error::check_status;
use crate::{sys, Env, Error, JsBuffer, JsNumber, JsString, NapiValue, Result, Status};

#[derive(Clone, Copy, Debug)]
pub struct JsObject(pub(crate) Value);

impl JsObject {
  pub fn set_property<V: NapiValue>(&mut self, key: JsString, value: V) -> Result<()> {
    let status =
      unsafe { sys::napi_set_property(self.0.env, self.0.value, key.0.value, value.raw_value()) };
    check_status(status)?;
    Ok(())
  }

  pub fn set_number_indexed_property<V: NapiValue>(
    &mut self,
    key: JsNumber,
    value: V,
  ) -> Result<()> {
    let status =
      unsafe { sys::napi_set_property(self.0.env, self.0.value, key.0.value, value.raw_value()) };
    check_status(status)?;
    Ok(())
  }

  pub fn set_named_property<T: NapiValue>(&mut self, name: &str, value: T) -> Result<()> {
    let key = CString::new(name)?;
    let status = unsafe {
      sys::napi_set_named_property(self.0.env, self.0.value, key.as_ptr(), value.raw_value())
    };
    check_status(status)?;
    Ok(())
  }

  pub fn get_named_property<T: NapiValue>(&self, name: &str) -> Result<T> {
    let key = CString::new(name)?;
    let mut raw_value = ptr::null_mut();
    let status = unsafe {
      sys::napi_get_named_property(self.0.env, self.0.value, key.as_ptr(), &mut raw_value)
    };
    check_status(status)?;
    T::from_raw(self.0.env, raw_value)
  }

  pub fn get_property_names<T: NapiValue>(&self) -> Result<T> {
    let mut raw_value = ptr::null_mut();
    let status = unsafe { sys::napi_get_property_names(self.0.env, self.0.value, &mut raw_value) };
    check_status(status)?;
    T::from_raw(self.0.env, raw_value)
  }

  pub fn set_index<T: NapiValue>(&mut self, index: usize, value: T) -> Result<()> {
    self.set_number_indexed_property(Env::from_raw(self.0.env).create_int64(index as i64)?, value)
  }

  pub fn get_index<T: NapiValue>(&self, index: u32) -> Result<T> {
    let mut raw_value = ptr::null_mut();
    let status = unsafe { sys::napi_get_element(self.0.env, self.0.value, index, &mut raw_value) };
    check_status(status)?;
    T::from_raw(self.0.env, raw_value)
  }

  pub fn is_array(&self) -> Result<bool> {
    let mut is_array = false;
    let status = unsafe { sys::napi_is_array(self.0.env, self.0.value, &mut is_array) };
    check_status(status)?;
    Ok(is_array)
  }

  pub fn is_buffer(&self) -> Result<bool> {
    let mut is_buffer = false;
    let status = unsafe { sys::napi_is_buffer(self.0.env, self.0.value, &mut is_buffer) };
    check_status(status)?;
    Ok(is_buffer)
  }

  pub fn to_buffer(&self) -> Result<JsBuffer> {
    JsBuffer::from_raw(self.0.env, self.0.value)
  }

  pub fn get_array_length(&self) -> Result<u32> {
    if self.is_array()? != true {
      return Err(Error::new(
        Status::ArrayExpected,
        "Object is not array".to_owned(),
      ));
    }
    let mut length: u32 = 0;
    let status = unsafe { sys::napi_get_array_length(self.0.env, self.raw_value(), &mut length) };
    check_status(status)?;
    Ok(length)
  }
}
