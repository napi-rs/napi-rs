use std::{
  ptr,
  rc::Rc,
  sync::{Arc, Mutex},
};

use crate::{check_status, sys, Error, JsUnknown, NapiRaw, NapiValue, Result, Status, ValueType};

mod array;
mod arraybuffer;
#[cfg(feature = "napi6")]
mod bigint;
mod boolean;
mod buffer;
mod class;
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
mod value_ref;

pub use crate::js_values::JsUnknown as Unknown;
#[cfg(feature = "napi5")]
pub use crate::JsDate as Date;
pub use array::*;
pub use arraybuffer::*;
#[cfg(feature = "napi6")]
pub use bigint::*;
pub use buffer::*;
pub use class::*;
pub use either::*;
pub use external::*;
pub use function::*;
pub use nil::*;
pub use object::*;
#[cfg(all(feature = "tokio_rt", feature = "napi4"))]
pub use promise::*;
pub use string::*;
pub use symbol::*;
pub use task::*;
pub use value_ref::*;

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

impl ValidateNapiValue for JsUnknown {}

impl ToNapiValue for sys::napi_value {
  unsafe fn to_napi_value(_env: sys::napi_env, val: Self) -> Result<sys::napi_value> {
    Ok(val)
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

  fn from_unknown(value: JsUnknown) -> Result<Self> {
    unsafe { Self::from_napi_value(value.0.env, value.0.value) }
  }
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
  /// # Safety
  ///
  /// this function called to validate whether napi value passed to rust is valid type
  /// The reason why this function return `napi_value` is that if a `Promise<T>` passed in
  /// we need to return `Promise.reject(T)`, not the `T`.
  /// So we need to create `Promise.reject(T)` in this function.
  unsafe fn validate(env: sys::napi_env, napi_val: sys::napi_value) -> Result<sys::napi_value> {
    let value_type = Self::value_type();
    if value_type == ValueType::Unknown {
      return Ok(ptr::null_mut());
    }

    let mut result = -1;
    check_status!(
      unsafe { sys::napi_typeof(env, napi_val, &mut result) },
      "Failed to detect napi value type",
    )?;

    let received_type = ValueType::from(result);
    if value_type == received_type {
      Ok(ptr::null_mut())
    } else {
      Err(Error::new(
        Status::InvalidArg,
        format!(
          "Expect value to be {}, but received {}",
          value_type, received_type
        ),
      ))
    }
  }
}

impl<T: TypeName> TypeName for Option<T> {
  fn type_name() -> &'static str {
    T::type_name()
  }

  fn value_type() -> ValueType {
    T::value_type()
  }
}

impl<T: ValidateNapiValue> ValidateNapiValue for Option<T> {
  unsafe fn validate(env: sys::napi_env, napi_val: sys::napi_value) -> Result<sys::napi_value> {
    let mut result = -1;
    check_status!(
      unsafe { sys::napi_typeof(env, napi_val, &mut result) },
      "Failed to detect napi value type",
    )?;

    let received_type = ValueType::from(result);
    if received_type == ValueType::Null || received_type == ValueType::Undefined {
      Ok(ptr::null_mut())
    } else if let Ok(validate_ret) = unsafe { T::validate(env, napi_val) } {
      Ok(validate_ret)
    } else {
      Err(Error::new(
        Status::InvalidArg,
        format!(
          "Expect value to be Option<{}>, but received {}",
          T::value_type(),
          received_type
        ),
      ))
    }
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
        let reason = unsafe { String::to_napi_value(env, e.reason.clone())? };
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

impl<T: TypeName> TypeName for Rc<T> {
  fn type_name() -> &'static str {
    T::type_name()
  }

  fn value_type() -> ValueType {
    T::value_type()
  }
}

impl<T: ValidateNapiValue> ValidateNapiValue for Rc<T> {
  unsafe fn validate(env: sys::napi_env, napi_val: sys::napi_value) -> Result<sys::napi_value> {
    let mut result = -1;
    check_status!(
      unsafe { sys::napi_typeof(env, napi_val, &mut result) },
      "Failed to detect napi value type",
    )?;

    let received_type = ValueType::from(result);
    if let Ok(validate_ret) = unsafe { T::validate(env, napi_val) } {
      Ok(validate_ret)
    } else {
      Err(Error::new(
        Status::InvalidArg,
        format!(
          "Expect value to be Rc<{}>, but received {}",
          T::value_type(),
          received_type
        ),
      ))
    }
  }
}

impl<T> FromNapiValue for Rc<T>
where
  T: FromNapiValue,
{
  unsafe fn from_napi_value(env: sys::napi_env, napi_val: sys::napi_value) -> Result<Self> {
    let mut val_type = 0;

    check_status!(
      unsafe { sys::napi_typeof(env, napi_val, &mut val_type) },
      "Failed to convert napi value into rust type `Rc<T>`",
    )?;

    Ok(Rc::new(unsafe { T::from_napi_value(env, napi_val)? }))
  }
}

impl<T> ToNapiValue for Rc<T>
where
  T: ToNapiValue + Clone,
{
  unsafe fn to_napi_value(env: sys::napi_env, val: Self) -> Result<sys::napi_value> {
    unsafe { T::to_napi_value(env, (*val).clone()) }
  }
}

impl<T: TypeName> TypeName for Arc<T> {
  fn type_name() -> &'static str {
    T::type_name()
  }

  fn value_type() -> ValueType {
    T::value_type()
  }
}

impl<T: ValidateNapiValue> ValidateNapiValue for Arc<T> {
  unsafe fn validate(env: sys::napi_env, napi_val: sys::napi_value) -> Result<sys::napi_value> {
    let mut result = -1;
    check_status!(
      unsafe { sys::napi_typeof(env, napi_val, &mut result) },
      "Failed to detect napi value type",
    )?;

    let received_type = ValueType::from(result);
    if let Ok(validate_ret) = unsafe { T::validate(env, napi_val) } {
      Ok(validate_ret)
    } else {
      Err(Error::new(
        Status::InvalidArg,
        format!(
          "Expect value to be Arc<{}>, but received {}",
          T::value_type(),
          received_type
        ),
      ))
    }
  }
}

impl<T> FromNapiValue for Arc<T>
where
  T: FromNapiValue,
{
  unsafe fn from_napi_value(env: sys::napi_env, napi_val: sys::napi_value) -> Result<Self> {
    let mut val_type = 0;

    check_status!(
      unsafe { sys::napi_typeof(env, napi_val, &mut val_type) },
      "Failed to convert napi value into rust type `Arc<T>`",
    )?;

    Ok(Arc::new(unsafe { T::from_napi_value(env, napi_val)? }))
  }
}

impl<T> ToNapiValue for Arc<T>
where
  T: ToNapiValue + Clone,
{
  unsafe fn to_napi_value(env: sys::napi_env, val: Self) -> Result<sys::napi_value> {
    unsafe { T::to_napi_value(env, (*val).clone()) }
  }
}

impl<T: TypeName> TypeName for Mutex<T> {
  fn type_name() -> &'static str {
    T::type_name()
  }

  fn value_type() -> ValueType {
    T::value_type()
  }
}

impl<T: ValidateNapiValue> ValidateNapiValue for Mutex<T> {
  unsafe fn validate(env: sys::napi_env, napi_val: sys::napi_value) -> Result<sys::napi_value> {
    let mut result = -1;
    check_status!(
      unsafe { sys::napi_typeof(env, napi_val, &mut result) },
      "Failed to detect napi value type",
    )?;

    let received_type = ValueType::from(result);
    if let Ok(validate_ret) = unsafe { T::validate(env, napi_val) } {
      Ok(validate_ret)
    } else {
      Err(Error::new(
        Status::InvalidArg,
        format!(
          "Expect value to be Mutex<{}>, but received {}",
          T::value_type(),
          received_type
        ),
      ))
    }
  }
}

impl<T> FromNapiValue for Mutex<T>
where
  T: FromNapiValue,
{
  unsafe fn from_napi_value(env: sys::napi_env, napi_val: sys::napi_value) -> Result<Self> {
    let mut val_type = 0;

    check_status!(
      unsafe { sys::napi_typeof(env, napi_val, &mut val_type) },
      "Failed to convert napi value into rust type `Mutex<T>`",
    )?;

    Ok(Mutex::new(unsafe { T::from_napi_value(env, napi_val)? }))
  }
}

impl<T> ToNapiValue for Mutex<T>
where
  T: ToNapiValue + Clone,
{
  unsafe fn to_napi_value(env: sys::napi_env, val: Self) -> Result<sys::napi_value> {
    unsafe {
      match val.lock() {
        Ok(inner) => T::to_napi_value(env, inner.clone()),
        Err(_) => Err(Error::new(
          Status::GenericFailure,
          "Failed to acquire a lock",
        )),
      }
    }
  }
}
