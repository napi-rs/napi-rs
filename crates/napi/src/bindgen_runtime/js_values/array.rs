use crate::{bindgen_prelude::*, check_status, sys, ValueType};
use std::ptr;

pub struct Array {
  env: sys::napi_env,
  inner: sys::napi_value,
  len: u32,
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

    Ok(Array {
      env,
      inner: ptr,
      len,
    })
  }

  pub fn get<T: FromNapiValue>(&self, index: u32) -> Result<Option<T>> {
    if index >= self.len() {
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

      if index >= self.len() {
        self.len = index + 1;
      }

      Ok(())
    }
  }

  pub fn insert<T: ToNapiValue>(&mut self, val: T) -> Result<()> {
    self.set(self.len(), val)?;
    Ok(())
  }

  #[allow(clippy::len_without_is_empty)]
  pub fn len(&self) -> u32 {
    self.len
  }
}

impl TypeName for Array {
  fn type_name() -> &'static str {
    "Array"
  }
}

impl ToNapiValue for Array {
  unsafe fn to_napi_value(_env: sys::napi_env, val: Self) -> Result<sys::napi_value> {
    Ok(val.inner)
  }
}

impl FromNapiValue for Array {
  unsafe fn from_napi_value(env: sys::napi_env, napi_val: sys::napi_value) -> Result<Self> {
    let mut is_arr = false;
    check_status!(
      sys::napi_is_array(env, napi_val, &mut is_arr),
      "Failed to check given napi value is array"
    )?;

    if is_arr {
      let mut len = 0;

      check_status!(
        sys::napi_get_array_length(env, napi_val, &mut len),
        "Failed to get Array length",
      )?;

      Ok(Array {
        inner: napi_val,
        env,
        len,
      })
    } else {
      Err(Error::new(
        Status::InvalidArg,
        "Given napi value is not an array".to_owned(),
      ))
    }
  }
}

impl ValidateNapiValue for Array {
  fn type_of() -> Vec<ValueType> {
    vec![ValueType::Object]
  }
}

impl<T> TypeName for Vec<T> {
  fn type_name() -> &'static str {
    "Array<T>"
  }
}

impl<T> ToNapiValue for Vec<T>
where
  T: ToNapiValue,
{
  unsafe fn to_napi_value(env: sys::napi_env, val: Self) -> Result<sys::napi_value> {
    let mut arr = Array::new(env, val.len() as u32)?;

    for (i, v) in val.into_iter().enumerate() {
      arr.set(i as u32, v)?;
    }

    Array::to_napi_value(env, arr)
  }
}

impl<T> FromNapiValue for Vec<T>
where
  T: FromNapiValue,
{
  unsafe fn from_napi_value(env: sys::napi_env, napi_val: sys::napi_value) -> Result<Self> {
    let arr = Array::from_napi_value(env, napi_val)?;
    let mut vec = vec![];

    for i in 0..arr.len() {
      if let Some(val) = arr.get::<T>(i)? {
        vec.push(val);
      } else {
        return Err(Error::new(
          Status::InvalidArg,
          "Found inconsistent data type in Array<T> when converting to Rust Vec<T>".to_owned(),
        ));
      }
    }

    Ok(vec)
  }
}

impl<T> ValidateNapiValue for Vec<T>
where
  T: FromNapiValue,
{
  fn type_of() -> Vec<ValueType> {
    vec![ValueType::Object]
  }
}
