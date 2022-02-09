use std::ptr;

use crate::{check_status, sys, Error, JsUnknown, NapiRaw, NapiValue, Result, Status, ValueType};

mod array;
mod arraybuffer;
#[cfg(feature = "napi6")]
mod bigint;
mod boolean;
mod buffer;
#[cfg(all(feature = "chrono_date", feature = "napi5"))]
mod date;
mod either;
mod external;
mod function;
mod map;
mod nil;
mod number;
mod object;
#[cfg(all(feature = "tokio_rt", feature = "napi4"))]
mod promise;
#[cfg(feature = "serde-json")]
mod serde;
mod string;
mod symbol;
mod task;

#[cfg(feature = "napi5")]
pub use crate::JsDate as Date;
pub use array::*;
pub use arraybuffer::*;
#[cfg(feature = "napi6")]
pub use bigint::*;
pub use buffer::*;
pub use either::*;
pub use external::*;
#[cfg(feature = "napi4")]
pub use function::*;
pub use nil::*;
pub use object::*;
#[cfg(all(feature = "tokio_rt", feature = "napi4"))]
pub use promise::*;
pub use string::*;
pub use symbol::*;
pub use task::*;

#[cfg(feature = "latin1")]
pub use string::latin1_string::*;

pub trait TypeName {
  fn type_name() -> &'static str;

  fn value_type() -> ValueType;
}

pub trait ToNapiValue {
  /// # Safety
  ///
  /// this function called to convert rust values to napi values
  unsafe fn to_napi_value(env: sys::napi_env, val: Self) -> Result<sys::napi_value>;
}

impl TypeName for JsUnknown {
  fn type_name() -> &'static str {
    "unknown"
  }

  fn value_type() -> ValueType {
    ValueType::Unknown
  }
}

impl<T: NapiRaw> ToNapiValue for T {
  unsafe fn to_napi_value(_env: sys::napi_env, val: Self) -> Result<sys::napi_value> {
    Ok(unsafe { NapiRaw::raw(&val) })
  }
}

impl<T: NapiValue> FromNapiValue for T {
  unsafe fn from_napi_value(env: sys::napi_env, napi_val: sys::napi_value) -> Result<Self> {
    Ok(unsafe { T::from_raw_unchecked(env, napi_val) })
  }
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
      unsafe { sys::napi_typeof(env, napi_val, &mut result) },
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

impl<T: TypeName> TypeName for Option<T> {
  fn type_name() -> &'static str {
    "Option"
  }

  fn value_type() -> ValueType {
    T::value_type()
  }
}

impl<T> FromNapiValue for Option<T>
where
  T: FromNapiValue,
{
  unsafe fn from_napi_value(env: sys::napi_env, napi_val: sys::napi_value) -> Result<Self> {
    let mut val_type = 0;

    check_status!(
      unsafe { sys::napi_typeof(env, napi_val, &mut val_type) },
      "Failed to convert napi value into rust type `Option<T>`",
    )?;

    match val_type {
      sys::ValueType::napi_undefined | sys::ValueType::napi_null => Ok(None),
      _ => Ok(Some(unsafe { T::from_napi_value(env, napi_val)? })),
    }
  }
}

impl<T> ToNapiValue for Option<T>
where
  T: ToNapiValue,
{
  unsafe fn to_napi_value(env: sys::napi_env, val: Self) -> Result<sys::napi_value> {
    match val {
      Some(val) => unsafe { T::to_napi_value(env, val) },
      None => {
        let mut ptr = ptr::null_mut();
        check_status!(
          unsafe { sys::napi_get_null(env, &mut ptr) },
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
      Ok(v) => unsafe { T::to_napi_value(env, v) },
      Err(e) => {
        let error_code = unsafe { String::to_napi_value(env, format!("{:?}", e.status))? };
        let reason = unsafe { String::to_napi_value(env, e.reason)? };
        let mut error = ptr::null_mut();
        check_status!(
          unsafe { sys::napi_create_error(env, error_code, reason, &mut error) },
          "Failed to create napi error"
        )?;

        Ok(error)
      }
    }
  }
}
