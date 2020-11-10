use std::convert::TryInto;

use crate::{sys, Error, Result, Status};

#[repr(u8)]
#[derive(Copy, Clone, Debug, PartialEq, PartialOrd, Ord, Eq, Hash)]
pub enum ValueType {
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
  Unknown = 255,
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

impl From<sys::napi_valuetype> for ValueType {
  fn from(value: sys::napi_valuetype) -> Self {
    match value {
      #[cfg(feature = "napi6")]
      sys::napi_valuetype::napi_bigint => ValueType::Bigint,
      sys::napi_valuetype::napi_boolean => ValueType::Boolean,
      sys::napi_valuetype::napi_external => ValueType::External,
      sys::napi_valuetype::napi_function => ValueType::Function,
      sys::napi_valuetype::napi_null => ValueType::Null,
      sys::napi_valuetype::napi_number => ValueType::Number,
      sys::napi_valuetype::napi_object => ValueType::Object,
      sys::napi_valuetype::napi_string => ValueType::String,
      sys::napi_valuetype::napi_symbol => ValueType::Symbol,
      sys::napi_valuetype::napi_undefined => ValueType::Undefined,
    }
  }
}
