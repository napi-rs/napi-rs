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
  #[cfg(napi6)]
  Bigint = 9,
}

impl TryInto<sys::napi_valuetype> for ValueType {
  type Error = Error;

  fn try_into(self) -> Result<sys::napi_valuetype> {
    use sys::napi_valuetype::*;
    match self {
      ValueType::Unknown => Err(Error::from_status(Status::Unknown)),
      #[cfg(napi6)]
      ValueType::Bigint => Ok(napi_bigint),
      ValueType::Boolean => Ok(napi_boolean),
      ValueType::External => Ok(napi_external),
      ValueType::Function => Ok(napi_function),
      ValueType::Null => Ok(napi_null),
      ValueType::Number => Ok(napi_number),
      ValueType::Object => Ok(napi_object),
      ValueType::String => Ok(napi_string),
      ValueType::Symbol => Ok(napi_symbol),
      ValueType::Undefined => Ok(napi_undefined),
    }
  }
}

impl From<sys::napi_valuetype> for ValueType {
  fn from(value: sys::napi_valuetype) -> Self {
    use sys::napi_valuetype::*;
    match value {
      #[cfg(napi6)]
      napi_bigint => ValueType::Bigint,
      napi_boolean => ValueType::Boolean,
      napi_external => ValueType::External,
      napi_function => ValueType::Function,
      napi_null => ValueType::Null,
      napi_number => ValueType::Number,
      napi_object => ValueType::Object,
      napi_string => ValueType::String,
      napi_symbol => ValueType::Symbol,
      napi_undefined => ValueType::Undefined,
    }
  }
}
