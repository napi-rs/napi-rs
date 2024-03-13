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

impl ValidateNapiValue for Array {}

impl<T> TypeName for Vec<T> {
  fn type_name() -> &'static str {
    "Array<T>"
  }

  fn value_type() -> ValueType {
    ValueType::Object
  }
}

impl<T, const N: usize> ToNapiValue for [T; N]
where
  T: ToNapiValue + Copy,
{
  unsafe fn to_napi_value(env: sys::napi_env, val: Self) -> Result<sys::napi_value> {
    let mut arr = Array::new(env, val.len() as u32)?;

    for (i, v) in val.into_iter().enumerate() {
      arr.set(i as u32, v)?;
    }

    unsafe { Array::to_napi_value(env, arr) }
  }
}

impl<T> ToNapiValue for &[T]
where
  T: ToNapiValue + Copy,
{
  unsafe fn to_napi_value(env: sys::napi_env, val: Self) -> Result<sys::napi_value> {
    let mut arr = Array::new(env, val.len() as u32)?;

    for (i, v) in val.iter().enumerate() {
      arr.set(i as u32, *v)?;
    }

    unsafe { Array::to_napi_value(env, arr) }
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

impl_for_primitive_type!(u8);
impl_for_primitive_type!(i8);
impl_for_primitive_type!(u16);
impl_for_primitive_type!(i16);
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
  unsafe fn validate(env: sys::napi_env, napi_val: sys::napi_value) -> Result<sys::napi_value> {
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

macro_rules! arr_get {
  ($arr:expr, $n:expr) => {
    if let Some(e) = $arr.get($n)? {
      e
    } else {
      return Err(Error::new(
        Status::InvalidArg,
        format!(
          "Found inconsistent data type in Array[{}] when converting to Rust T",
          $n
        )
        .to_owned(),
      ));
    }
  };
}

macro_rules! tuple_from_napi_value {
  ($total:expr, $($n:expr),+) => {
    unsafe fn from_napi_value(env: sys::napi_env, napi_val: sys::napi_value) -> Result<Self> {
      let arr = unsafe { Array::from_napi_value(env, napi_val)? };
      if arr.len() < $total {
        return Err(Error::new(
            Status::InvalidArg,
            format!("Array length < {}",$total).to_owned(),
        ));
      }
      Ok(($(arr_get!(arr,$n)),+))
    }
  }
}

macro_rules! impl_tuple_validate_napi_value {
  ($($ident:ident),+) => {
    impl<$($ident: FromNapiValue),*> ValidateNapiValue for ($($ident,)*) {}
    impl<$($ident: FromNapiValue),*> TypeName for ($($ident,)*) {
      fn type_name() -> &'static str {
        concat!("Tuple", "(", $(stringify!($ident), ","),*, ")")
      }
      fn value_type() -> ValueType {
        ValueType::Object
      }
    }
  };
}

impl<T0, T1> FromNapiValue for (T0, T1)
where
  T0: FromNapiValue,
  T1: FromNapiValue,
{
  tuple_from_napi_value!(2, 0, 1);
}

impl<T0, T1, T2> FromNapiValue for (T0, T1, T2)
where
  T0: FromNapiValue,
  T1: FromNapiValue,
  T2: FromNapiValue,
{
  tuple_from_napi_value!(3, 0, 1, 2);
}

impl<T0, T1, T2, T3> FromNapiValue for (T0, T1, T2, T3)
where
  T0: FromNapiValue,
  T1: FromNapiValue,
  T2: FromNapiValue,
  T3: FromNapiValue,
{
  tuple_from_napi_value!(4, 0, 1, 2, 3);
}

impl<T0, T1, T2, T3, T4> FromNapiValue for (T0, T1, T2, T3, T4)
where
  T0: FromNapiValue,
  T1: FromNapiValue,
  T2: FromNapiValue,
  T3: FromNapiValue,
  T4: FromNapiValue,
{
  tuple_from_napi_value!(5, 0, 1, 2, 3, 4);
}

impl<T0, T1, T2, T3, T4, T5> FromNapiValue for (T0, T1, T2, T3, T4, T5)
where
  T0: FromNapiValue,
  T1: FromNapiValue,
  T2: FromNapiValue,
  T3: FromNapiValue,
  T4: FromNapiValue,
  T5: FromNapiValue,
{
  tuple_from_napi_value!(6, 0, 1, 2, 3, 4, 5);
}

impl<T0, T1, T2, T3, T4, T5, T6> FromNapiValue for (T0, T1, T2, T3, T4, T5, T6)
where
  T0: FromNapiValue,
  T1: FromNapiValue,
  T2: FromNapiValue,
  T3: FromNapiValue,
  T4: FromNapiValue,
  T5: FromNapiValue,
  T6: FromNapiValue,
{
  tuple_from_napi_value!(7, 0, 1, 2, 3, 4, 5, 6);
}

impl<T0, T1, T2, T3, T4, T5, T6, T7> FromNapiValue for (T0, T1, T2, T3, T4, T5, T6, T7)
where
  T0: FromNapiValue,
  T1: FromNapiValue,
  T2: FromNapiValue,
  T3: FromNapiValue,
  T4: FromNapiValue,
  T5: FromNapiValue,
  T6: FromNapiValue,
  T7: FromNapiValue,
{
  tuple_from_napi_value!(8, 0, 1, 2, 3, 4, 5, 6, 7);
}

impl<T0, T1, T2, T3, T4, T5, T6, T7, T8> FromNapiValue for (T0, T1, T2, T3, T4, T5, T6, T7, T8)
where
  T0: FromNapiValue,
  T1: FromNapiValue,
  T2: FromNapiValue,
  T3: FromNapiValue,
  T4: FromNapiValue,
  T5: FromNapiValue,
  T6: FromNapiValue,
  T7: FromNapiValue,
  T8: FromNapiValue,
{
  tuple_from_napi_value!(9, 0, 1, 2, 3, 4, 5, 6, 7, 8);
}

impl<T0, T1, T2, T3, T4, T5, T6, T7, T8, T9> FromNapiValue
  for (T0, T1, T2, T3, T4, T5, T6, T7, T8, T9)
where
  T0: FromNapiValue,
  T1: FromNapiValue,
  T2: FromNapiValue,
  T3: FromNapiValue,
  T4: FromNapiValue,
  T5: FromNapiValue,
  T6: FromNapiValue,
  T7: FromNapiValue,
  T8: FromNapiValue,
  T9: FromNapiValue,
{
  tuple_from_napi_value!(10, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9);
}

impl<T0, T1, T2, T3, T4, T5, T6, T7, T8, T9, T10> FromNapiValue
  for (T0, T1, T2, T3, T4, T5, T6, T7, T8, T9, T10)
where
  T0: FromNapiValue,
  T1: FromNapiValue,
  T2: FromNapiValue,
  T3: FromNapiValue,
  T4: FromNapiValue,
  T5: FromNapiValue,
  T6: FromNapiValue,
  T7: FromNapiValue,
  T8: FromNapiValue,
  T9: FromNapiValue,
  T10: FromNapiValue,
{
  tuple_from_napi_value!(11, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10);
}

impl<T0, T1, T2, T3, T4, T5, T6, T7, T8, T9, T10, T11> FromNapiValue
  for (T0, T1, T2, T3, T4, T5, T6, T7, T8, T9, T10, T11)
where
  T0: FromNapiValue,
  T1: FromNapiValue,
  T2: FromNapiValue,
  T3: FromNapiValue,
  T4: FromNapiValue,
  T5: FromNapiValue,
  T6: FromNapiValue,
  T7: FromNapiValue,
  T8: FromNapiValue,
  T9: FromNapiValue,
  T10: FromNapiValue,
  T11: FromNapiValue,
{
  tuple_from_napi_value!(12, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11);
}

impl<T0, T1, T2, T3, T4, T5, T6, T7, T8, T9, T10, T11, T12> FromNapiValue
  for (T0, T1, T2, T3, T4, T5, T6, T7, T8, T9, T10, T11, T12)
where
  T0: FromNapiValue,
  T1: FromNapiValue,
  T2: FromNapiValue,
  T3: FromNapiValue,
  T4: FromNapiValue,
  T5: FromNapiValue,
  T6: FromNapiValue,
  T7: FromNapiValue,
  T8: FromNapiValue,
  T9: FromNapiValue,
  T10: FromNapiValue,
  T11: FromNapiValue,
  T12: FromNapiValue,
{
  tuple_from_napi_value!(13, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12);
}

impl<T0, T1, T2, T3, T4, T5, T6, T7, T8, T9, T10, T11, T12, T13> FromNapiValue
  for (T0, T1, T2, T3, T4, T5, T6, T7, T8, T9, T10, T11, T12, T13)
where
  T0: FromNapiValue,
  T1: FromNapiValue,
  T2: FromNapiValue,
  T3: FromNapiValue,
  T4: FromNapiValue,
  T5: FromNapiValue,
  T6: FromNapiValue,
  T7: FromNapiValue,
  T8: FromNapiValue,
  T9: FromNapiValue,
  T10: FromNapiValue,
  T11: FromNapiValue,
  T12: FromNapiValue,
  T13: FromNapiValue,
{
  tuple_from_napi_value!(14, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13);
}

impl<T0, T1, T2, T3, T4, T5, T6, T7, T8, T9, T10, T11, T12, T13, T14> FromNapiValue
  for (
    T0,
    T1,
    T2,
    T3,
    T4,
    T5,
    T6,
    T7,
    T8,
    T9,
    T10,
    T11,
    T12,
    T13,
    T14,
  )
where
  T0: FromNapiValue,
  T1: FromNapiValue,
  T2: FromNapiValue,
  T3: FromNapiValue,
  T4: FromNapiValue,
  T5: FromNapiValue,
  T6: FromNapiValue,
  T7: FromNapiValue,
  T8: FromNapiValue,
  T9: FromNapiValue,
  T10: FromNapiValue,
  T11: FromNapiValue,
  T12: FromNapiValue,
  T13: FromNapiValue,
  T14: FromNapiValue,
{
  tuple_from_napi_value!(15, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14);
}

impl<T0, T1, T2, T3, T4, T5, T6, T7, T8, T9, T10, T11, T12, T13, T14, T15> FromNapiValue
  for (
    T0,
    T1,
    T2,
    T3,
    T4,
    T5,
    T6,
    T7,
    T8,
    T9,
    T10,
    T11,
    T12,
    T13,
    T14,
    T15,
  )
where
  T0: FromNapiValue,
  T1: FromNapiValue,
  T2: FromNapiValue,
  T3: FromNapiValue,
  T4: FromNapiValue,
  T5: FromNapiValue,
  T6: FromNapiValue,
  T7: FromNapiValue,
  T8: FromNapiValue,
  T9: FromNapiValue,
  T10: FromNapiValue,
  T11: FromNapiValue,
  T12: FromNapiValue,
  T13: FromNapiValue,
  T14: FromNapiValue,
  T15: FromNapiValue,
{
  tuple_from_napi_value!(16, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15);
}

impl_tuple_validate_napi_value!(T0, T1);
impl_tuple_validate_napi_value!(T0, T1, T2);
impl_tuple_validate_napi_value!(T0, T1, T2, T3);
impl_tuple_validate_napi_value!(T0, T1, T2, T3, T4);
impl_tuple_validate_napi_value!(T0, T1, T2, T3, T4, T5);
impl_tuple_validate_napi_value!(T0, T1, T2, T3, T4, T5, T6);
impl_tuple_validate_napi_value!(T0, T1, T2, T3, T4, T5, T6, T7);
impl_tuple_validate_napi_value!(T0, T1, T2, T3, T4, T5, T6, T7, T8);
impl_tuple_validate_napi_value!(T0, T1, T2, T3, T4, T5, T6, T7, T8, T9);
impl_tuple_validate_napi_value!(T0, T1, T2, T3, T4, T5, T6, T7, T8, T9, T10);
impl_tuple_validate_napi_value!(T0, T1, T2, T3, T4, T5, T6, T7, T8, T9, T10, T11);
impl_tuple_validate_napi_value!(T0, T1, T2, T3, T4, T5, T6, T7, T8, T9, T10, T11, T12);
impl_tuple_validate_napi_value!(T0, T1, T2, T3, T4, T5, T6, T7, T8, T9, T10, T11, T12, T13);
impl_tuple_validate_napi_value!(T0, T1, T2, T3, T4, T5, T6, T7, T8, T9, T10, T11, T12, T13, T14);
impl_tuple_validate_napi_value!(
  T0, T1, T2, T3, T4, T5, T6, T7, T8, T9, T10, T11, T12, T13, T14, T15
);
