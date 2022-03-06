use std::ptr;

use crate::{bindgen_prelude::*, check_status, sys, JsObject, Value, ValueType};

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

  pub fn coerce_to_object(self) -> Result<JsObject> {
    let mut new_raw_value = ptr::null_mut();
    check_status!(unsafe { sys::napi_coerce_to_object(self.env, self.inner, &mut new_raw_value) })?;
    Ok(JsObject(Value {
      env: self.env,
      value: new_raw_value,
      value_type: ValueType::Object,
    }))
  }
}

impl TypeName for Array {
  fn type_name() -> &'static str {
    "Array"
  }

  fn value_type() -> ValueType {
    ValueType::Object
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
      unsafe { sys::napi_is_array(env, napi_val, &mut is_arr) },
      "Failed to check given napi value is array"
    )?;

    if is_arr {
      let mut len = 0;

      check_status!(
        unsafe { sys::napi_get_array_length(env, napi_val, &mut len) },
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

impl Array {
  /// Create `Array` from `Vec<T>`
  pub fn from_vec<T>(env: &Env, value: Vec<T>) -> Result<Self>
  where
    T: ToNapiValue,
  {
    let mut arr = Array::new(env.0, value.len() as u32)?;
    value.into_iter().enumerate().try_for_each(|(index, val)| {
      arr.set(index as u32, val)?;
      Ok::<(), Error>(())
    })?;
    Ok(arr)
  }

  /// Create `Array` from `&Vec<String>`
  pub fn from_ref_vec_string(env: &Env, value: &[String]) -> Result<Self> {
    let mut arr = Array::new(env.0, value.len() as u32)?;
    value.iter().enumerate().try_for_each(|(index, val)| {
      arr.set(index as u32, val.as_str())?;
      Ok::<(), Error>(())
    })?;
    Ok(arr)
  }

  /// Create `Array` from `&Vec<T: Copy + ToNapiValue>`
  pub fn from_ref_vec<T>(env: &Env, value: &[T]) -> Result<Self>
  where
    T: ToNapiValue + Copy,
  {
    let mut arr = Array::new(env.0, value.len() as u32)?;
    value.iter().enumerate().try_for_each(|(index, val)| {
      arr.set(index as u32, *val)?;
      Ok::<(), Error>(())
    })?;
    Ok(arr)
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

  fn value_type() -> ValueType {
    ValueType::Object
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

    unsafe { Array::to_napi_value(env, arr) }
  }
}

macro_rules! impl_for_primitive_type {
  ($primitive_type:ident) => {
    impl ToNapiValue for &Vec<$primitive_type> {
      unsafe fn to_napi_value(env: sys::napi_env, val: Self) -> Result<sys::napi_value> {
        let mut arr = Array::new(env, val.len() as u32)?;

        for (i, v) in val.iter().enumerate() {
          arr.set(i as u32, *v)?;
        }

        unsafe { Array::to_napi_value(env, arr) }
      }
    }
  };
}

impl_for_primitive_type!(u32);
impl_for_primitive_type!(i32);
impl_for_primitive_type!(i64);
impl_for_primitive_type!(f64);
impl_for_primitive_type!(bool);

impl ToNapiValue for &Vec<String> {
  unsafe fn to_napi_value(env: sys::napi_env, val: Self) -> Result<sys::napi_value> {
    let mut arr = Array::new(env, val.len() as u32)?;

    for (i, v) in val.iter().enumerate() {
      arr.set(i as u32, v.as_str())?;
    }

    unsafe { Array::to_napi_value(env, arr) }
  }
}

impl<T> FromNapiValue for Vec<T>
where
  T: FromNapiValue,
{
  unsafe fn from_napi_value(env: sys::napi_env, napi_val: sys::napi_value) -> Result<Self> {
    let arr = unsafe { Array::from_napi_value(env, napi_val)? };
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
  unsafe fn validate(
    env: sys::napi_env,
    napi_val: sys::napi_value,
  ) -> Result<napi_sys::napi_value> {
    let mut is_array = false;
    check_status!(
      unsafe { sys::napi_is_array(env, napi_val, &mut is_array) },
      "Failed to check given napi value is array"
    )?;
    if !is_array {
      return Err(Error::new(
        Status::InvalidArg,
        "Expected an array".to_owned(),
      ));
    }
    Ok(ptr::null_mut())
  }
}
