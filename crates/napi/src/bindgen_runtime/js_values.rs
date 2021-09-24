use crate::{check_status, sys, Error, Result, Status, ValueType};
use std::ptr;

mod array;
mod boolean;
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

#[cfg(feature = "latin1")]
pub use string::latin1_string::*;

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

pub trait ValidateNapiValue: FromNapiValue + TypeName {
  fn type_of() -> Vec<ValueType> {
    vec![]
  }

  /// # Safety
  ///
  /// this function called to validate whether napi value passed to rust is valid type
  unsafe fn validate(env: sys::napi_env, napi_val: sys::napi_value) -> Result<()> {
    let available_types = Self::type_of();
    if available_types.is_empty() {
      return Ok(());
    }

    let mut result = -1;
    check_status!(
      sys::napi_typeof(env, napi_val, &mut result),
      "Failed to detect napi value type",
    )?;

    let received_type = ValueType::from(result);
    if available_types.contains(&received_type) {
      Ok(())
    } else {
      Err(Error::new(
        Status::InvalidArg,
        if available_types.len() > 1 {
          format!(
            "Expect value to be one of {:?}, but received {}",
            available_types, received_type
          )
        } else {
          format!(
            "Expect value to be {}, but received {}",
            available_types[0], received_type
          )
        },
      ))
    }
  }
}

impl<T> TypeName for Option<T> {
  fn type_name() -> &'static str {
    "Option"
  }
}

impl<T> FromNapiValue for Option<T>
where
  T: FromNapiValue,
{
  unsafe fn from_napi_value(env: sys::napi_env, napi_val: sys::napi_value) -> Result<Self> {
    let mut val_type = 0;

    check_status!(
      sys::napi_typeof(env, napi_val, &mut val_type),
      "Failed to convert napi value into rust type `Option<T>`",
    )?;

    match val_type {
      sys::ValueType::napi_undefined | sys::ValueType::napi_null => Ok(None),
      _ => Ok(Some(T::from_napi_value(env, napi_val)?)),
    }
  }
}

impl<T> ToNapiValue for Option<T>
where
  T: ToNapiValue,
{
  unsafe fn to_napi_value(env: sys::napi_env, val: Self) -> Result<sys::napi_value> {
    match val {
      Some(val) => T::to_napi_value(env, val),
      None => {
        let mut ptr = ptr::null_mut();
        check_status!(
          sys::napi_get_null(env, &mut ptr),
          "Failed to convert rust type `Option<T>` into napi value",
        )?;
        Ok(ptr)
      }
    }
  }
}

impl<T> ToNapiValue for Result<T>
where
  T: ToNapiValue,
{
  unsafe fn to_napi_value(env: sys::napi_env, val: Self) -> Result<sys::napi_value> {
    match val {
      Ok(v) => T::to_napi_value(env, v),
      Err(e) => {
        let error_code = String::to_napi_value(env, format!("{:?}", e.status))?;
        let reason = String::to_napi_value(env, e.reason)?;
        let mut error = ptr::null_mut();
        check_status!(
          sys::napi_create_error(env, error_code, reason, &mut error),
          "Failed to create napi error"
        )?;

        Ok(error)
      }
    }
  }
}
