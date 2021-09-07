use crate::{check_status, sys, Result};
use std::ptr;

mod array;
mod buffer;
mod nil;
mod number;
mod object;
mod string;

pub use array::*;
pub use buffer::*;
pub use nil::*;
pub use object::*;
pub use string::*;

pub trait TypeName {
  fn type_name() -> &'static str;
}

pub trait ToNapiValue {
  /// # Safety
  ///
  /// this function called to convert rust values to napi values
  unsafe fn to_napi_value(env: sys::napi_env, val: Self) -> Result<sys::napi_value>;
}

pub trait FromNapiValue: Sized {
  /// # Safety
  ///
  /// this function called to convert napi values to native rust values
  unsafe fn from_napi_value(env: sys::napi_env, napi_val: sys::napi_value) -> Result<Self>;
}

pub trait FromNapiRef {
  /// # Safety
  ///
  /// this function called to convert napi values to native rust values
  unsafe fn from_napi_ref(env: sys::napi_env, napi_val: sys::napi_value) -> Result<&'static Self>;
}

pub trait FromNapiMutRef {
  /// # Safety
  ///
  /// this function called to convert napi values to native rust values
  unsafe fn from_napi_mut_ref(
    env: sys::napi_env,
    napi_val: sys::napi_value,
  ) -> Result<&'static mut Self>;
}

impl<T> TypeName for Option<T>
where
  T: TypeName,
{
  fn type_name() -> &'static str {
    "Option"
  }
}

impl<T> FromNapiValue for Option<T>
where
  T: FromNapiValue + TypeName,
{
  unsafe fn from_napi_value(env: sys::napi_env, napi_val: sys::napi_value) -> Result<Self> {
    let mut val_type = 0;

    check_status!(
      sys::napi_typeof(env, napi_val, &mut val_type),
      "Failed to convert napi value into rust type `Option<{}>`",
      T::type_name()
    )?;

    match val_type {
      sys::ValueType::napi_undefined => Ok(None),
      _ => Ok(Some(T::from_napi_value(env, napi_val)?)),
    }
  }
}

impl<T> ToNapiValue for Option<T>
where
  T: ToNapiValue + TypeName,
{
  unsafe fn to_napi_value(env: sys::napi_env, val: Self) -> Result<sys::napi_value> {
    match val {
      Some(val) => T::to_napi_value(env, val),
      None => {
        let mut ptr = ptr::null_mut();
        check_status!(
          sys::napi_get_undefined(env, &mut ptr),
          "Failed to convert rust type `Option<{}>` into napi value",
          T::type_name(),
        )?;
        Ok(ptr)
      }
    }
  }
}
