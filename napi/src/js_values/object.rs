use std::ffi::CString;
use std::ptr;

use super::Value;
use crate::error::check_status;
use crate::{sys, Error, JsString, NapiValue, Property, Result, Status};

#[derive(Debug)]
pub struct JsObject(pub(crate) Value);

impl JsObject {
  pub fn set_property<V>(&mut self, key: JsString, value: V) -> Result<()>
  where
    V: NapiValue,
  {
    check_status(unsafe {
      sys::napi_set_property(self.0.env, self.0.value, key.0.value, value.raw_value())
    })
  }

  pub fn set_named_property<T>(&mut self, name: &str, value: T) -> Result<()>
  where
    T: NapiValue,
  {
    let key = CString::new(name)?;
    check_status(unsafe {
      sys::napi_set_named_property(self.0.env, self.0.value, key.as_ptr(), value.raw_value())
    })
  }

  pub fn get_named_property<T>(&self, name: &str) -> Result<T>
  where
    T: NapiValue,
  {
    let key = CString::new(name)?;
    let mut raw_value = ptr::null_mut();
    check_status(unsafe {
      sys::napi_get_named_property(self.0.env, self.0.value, key.as_ptr(), &mut raw_value)
    })?;
    T::from_raw(self.0.env, raw_value)
  }

  pub fn has_named_property(&self, name: &str) -> Result<bool> {
    let mut result = false;
    let key = CString::new(name)?;
    check_status(unsafe {
      sys::napi_has_named_property(self.0.env, self.0.value, key.as_ptr(), &mut result)
    })?;
    Ok(result)
  }

  pub fn has_own_property(&self, key: &str) -> Result<bool> {
    let mut result = false;
    let string = CString::new(key)?;
    let mut js_key = ptr::null_mut();
    check_status(unsafe {
      sys::napi_create_string_utf8(self.0.env, string.as_ptr(), key.len() as _, &mut js_key)
    })?;
    check_status(unsafe {
      sys::napi_has_own_property(self.0.env, self.0.value, js_key, &mut result)
    })?;
    Ok(result)
  }

  pub fn has_own_property_js<K>(&self, key: K) -> Result<bool>
  where
    K: NapiValue,
  {
    let mut result = false;
    check_status(unsafe {
      sys::napi_has_own_property(self.0.env, self.0.value, key.raw_value(), &mut result)
    })?;
    Ok(result)
  }

  pub fn has_property(&self, name: &str) -> Result<bool> {
    let string = CString::new(name)?;
    let mut js_key = ptr::null_mut();
    let mut result = false;
    check_status(unsafe {
      sys::napi_create_string_utf8(self.0.env, string.as_ptr(), name.len() as _, &mut js_key)
    })?;
    check_status(unsafe { sys::napi_has_property(self.0.env, self.0.value, js_key, &mut result) })?;
    Ok(result)
  }

  pub fn has_property_js<K>(&self, name: K) -> Result<bool>
  where
    K: NapiValue,
  {
    let mut result = false;
    check_status(unsafe {
      sys::napi_has_property(self.0.env, self.0.value, name.raw_value(), &mut result)
    })?;
    Ok(result)
  }

  pub fn get_property<K, T>(&self, key: &K) -> Result<T>
  where
    K: NapiValue,
    T: NapiValue,
  {
    let mut raw_value = ptr::null_mut();
    check_status(unsafe {
      sys::napi_get_property(self.0.env, self.0.value, key.raw_value(), &mut raw_value)
    })?;
    T::from_raw(self.0.env, raw_value)
  }

  pub fn get_property_names<T>(&self) -> Result<T>
  where
    T: NapiValue,
  {
    let mut raw_value = ptr::null_mut();
    let status = unsafe { sys::napi_get_property_names(self.0.env, self.0.value, &mut raw_value) };
    check_status(status)?;
    T::from_raw(self.0.env, raw_value)
  }

  pub fn get_prototype<T>(&self) -> Result<T>
  where
    T: NapiValue,
  {
    let mut result = ptr::null_mut();
    check_status(unsafe { sys::napi_get_prototype(self.0.env, self.0.value, &mut result) })?;
    T::from_raw(self.0.env, result)
  }

  pub fn set_element<T>(&mut self, index: u32, value: T) -> Result<()>
  where
    T: NapiValue,
  {
    check_status(unsafe {
      sys::napi_set_element(self.0.env, self.0.value, index, value.raw_value())
    })
  }

  pub fn has_element(&self, index: u32) -> Result<bool> {
    let mut result = false;
    check_status(unsafe { sys::napi_has_element(self.0.env, self.0.value, index, &mut result) })?;
    Ok(result)
  }

  pub fn delete_element<T>(&mut self, index: u32) -> Result<bool> {
    let mut result = false;
    check_status(unsafe {
      sys::napi_delete_element(self.0.env, self.0.value, index, &mut result)
    })?;
    Ok(result)
  }

  pub fn get_element<T>(&self, index: u32) -> Result<T>
  where
    T: NapiValue,
  {
    let mut raw_value = ptr::null_mut();
    check_status(unsafe {
      sys::napi_get_element(self.0.env, self.0.value, index, &mut raw_value)
    })?;
    T::from_raw(self.0.env, raw_value)
  }

  pub fn define_properties(&mut self, properties: &mut [Property]) -> Result<()> {
    check_status(unsafe {
      sys::napi_define_properties(
        self.0.env,
        self.0.value,
        properties.len() as _,
        properties
          .iter_mut()
          .map(|property| property.as_raw(self.0.env))
          .collect::<Result<Vec<sys::napi_property_descriptor>>>()?
          .as_ptr(),
      )
    })
  }

  pub fn is_array(&self) -> Result<bool> {
    let mut is_array = false;
    check_status(unsafe { sys::napi_is_array(self.0.env, self.0.value, &mut is_array) })?;
    Ok(is_array)
  }

  pub fn is_buffer(&self) -> Result<bool> {
    let mut is_buffer = false;
    check_status(unsafe { sys::napi_is_buffer(self.0.env, self.0.value, &mut is_buffer) })?;
    Ok(is_buffer)
  }

  pub fn get_array_length(&self) -> Result<u32> {
    if self.is_array()? != true {
      return Err(Error::new(
        Status::ArrayExpected,
        "Object is not array".to_owned(),
      ));
    }
    self.get_array_length_unchecked()
  }

  #[inline]
  pub fn get_array_length_unchecked(&self) -> Result<u32> {
    let mut length: u32 = 0;
    check_status(unsafe { sys::napi_get_array_length(self.0.env, self.raw_value(), &mut length) })?;
    Ok(length)
  }
}
