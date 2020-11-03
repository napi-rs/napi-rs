use std::convert::TryFrom;
use std::convert::TryInto;

use crate::{sys, Error, Result, Status};

#[derive(Copy, Clone, Debug, PartialEq, PartialOrd, Ord, Eq, Hash)]
pub enum ValueType {
  Unknown = 100,
  Undefined = 0,
  Null = 1,
  Boolean = 2,
  Number = 3,
  String = 4,
  Symbol = 5,
  Object = 6,
  Function = 7,
  External = 8,
  #[cfg(feature = "napi6")]
  Bigint = 9,
}

impl TryInto<sys::napi_valuetype> for ValueType {
  type Error = Error;

  fn try_into(self) -> Result<sys::napi_valuetype> {
    match self {
      ValueType::Unknown => Err(Error::from_status(Status::Unknown)),
      #[cfg(feature = "napi6")]
      ValueType::Bigint => Ok(sys::napi_valuetype::napi_bigint),
      ValueType::Boolean => Ok(sys::napi_valuetype::napi_boolean),
      ValueType::External => Ok(sys::napi_valuetype::napi_external),
      ValueType::Function => Ok(sys::napi_valuetype::napi_function),
      ValueType::Null => Ok(sys::napi_valuetype::napi_null),
      ValueType::Number => Ok(sys::napi_valuetype::napi_number),
      ValueType::Object => Ok(sys::napi_valuetype::napi_object),
      ValueType::String => Ok(sys::napi_valuetype::napi_string),
      ValueType::Symbol => Ok(sys::napi_valuetype::napi_symbol),
      ValueType::Undefined => Ok(sys::napi_valuetype::napi_undefined),
    }
  }
}

impl TryFrom<sys::napi_valuetype> for ValueType {
  type Error = Error;

  fn try_from(value: sys::napi_valuetype) -> Result<Self> {
    match value {
      #[cfg(feature = "napi6")]
      sys::napi_valuetype::napi_bigint => Ok(ValueType::Bigint),
      sys::napi_valuetype::napi_boolean => Ok(ValueType::Boolean),
      sys::napi_valuetype::napi_external => Ok(ValueType::External),
      sys::napi_valuetype::napi_function => Ok(ValueType::Function),
      sys::napi_valuetype::napi_null => Ok(ValueType::Null),
      sys::napi_valuetype::napi_number => Ok(ValueType::Number),
      sys::napi_valuetype::napi_object => Ok(ValueType::Object),
      sys::napi_valuetype::napi_string => Ok(ValueType::String),
      sys::napi_valuetype::napi_symbol => Ok(ValueType::Symbol),
      sys::napi_valuetype::napi_undefined => Ok(ValueType::Undefined),
      _ => Err(Error::from_status(Status::Unknown)),
    }
  }
}
