use std::convert::{From, TryFrom};
use std::error;
use std::ffi::CString;
use std::fmt;
#[cfg(feature = "serde-json")]
use std::fmt::Display;
use std::os::raw::{c_char, c_void};

#[cfg(feature = "serde-json")]
use serde::{de, ser};
#[cfg(feature = "serde-json")]
use serde_json::Error as SerdeJSONError;

use crate::{sys, Status};

pub type Result<T> = std::result::Result<T, Error>;

/// Represent `JsError`.
/// Return this Error in `js_function`, **napi-rs** will throw it as `JsError` for you.
/// If you want throw it as `TypeError` or `RangeError`, you can use `JsTypeError/JsRangeError::from(Error).throw_into(env)`
#[derive(Debug, Clone)]
pub struct Error {
  pub status: Status,
  pub reason: String,
}

impl error::Error for Error {}

#[cfg(feature = "serde-json")]
impl ser::Error for Error {
  fn custom<T: Display>(msg: T) -> Self {
    Error::new(Status::InvalidArg, msg.to_string())
  }
}

#[cfg(feature = "serde-json")]
impl de::Error for Error {
  fn custom<T: Display>(msg: T) -> Self {
    Error::new(Status::InvalidArg, msg.to_string())
  }
}

#[cfg(feature = "serde-json")]
impl From<SerdeJSONError> for Error {
  fn from(value: SerdeJSONError) -> Self {
    Error::new(Status::InvalidArg, format!("{}", value))
  }
}

impl fmt::Display for Error {
  fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
    if !self.reason.is_empty() {
      write!(f, "{:?}, {}", self.status, self.reason)
    } else {
      write!(f, "{:?}", self.status)
    }
  }
}

impl Error {
  pub fn new(status: Status, reason: String) -> Self {
    Error { status, reason }
  }

  pub fn from_status(status: Status) -> Self {
    Error {
      status,
      reason: "".to_owned(),
    }
  }

  pub fn from_reason(reason: String) -> Self {
    Error {
      status: Status::GenericFailure,
      reason,
    }
  }
}

impl From<std::ffi::NulError> for Error {
  fn from(error: std::ffi::NulError) -> Self {
    Error {
      status: Status::GenericFailure,
      reason: format!("{}", error),
    }
  }
}

impl From<std::io::Error> for Error {
  fn from(error: std::io::Error) -> Self {
    Error {
      status: Status::GenericFailure,
      reason: format!("{}", error),
    }
  }
}

#[derive(Clone, Debug)]
pub struct ExtendedErrorInfo {
  pub message: String,
  pub engine_reserved: *mut c_void,
  pub engine_error_code: u32,
  pub error_code: Status,
}

impl TryFrom<sys::napi_extended_error_info> for ExtendedErrorInfo {
  type Error = Error;

  fn try_from(value: sys::napi_extended_error_info) -> Result<Self> {
    Ok(Self {
      message: unsafe {
        CString::from_raw(value.error_message as *mut c_char)
          .into_string()
          .map_err(|e| Error::new(Status::GenericFailure, format!("{}", e)))?
      },
      engine_error_code: value.engine_error_code,
      engine_reserved: value.engine_reserved,
      error_code: Status::from(value.error_code),
    })
  }
}

#[doc(hidden)]
#[macro_export]
macro_rules! check_status {
  ($code:expr) => {{
    let c = $code;
    match c {
      $crate::sys::Status::napi_ok => Ok(()),
      _ => Err($crate::Error::new($crate::Status::from(c), "".to_owned())),
    }
  }};
}
