use std::convert::From;
use std::error::Error as StdError;
use std::fmt;
#[cfg(feature = "serde-json")]
use std::fmt::Display;
use std::os::raw::c_char;
use std::ptr;

#[cfg(feature = "serde-json")]
use serde::{de, ser};

use crate::{sys, Status};

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, Clone)]
pub struct Error {
  pub status: Status,
  pub reason: String,
}

impl StdError for Error {}

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

impl fmt::Display for Error {
  fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
    write!(f, "{:?}: {}", self.status, self.reason)
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

  pub(crate) fn into_raw(self, env: sys::napi_env) -> sys::napi_value {
    let mut err = ptr::null_mut();
    let s = self.reason;
    unsafe {
      let mut err_reason = ptr::null_mut();
      let status = sys::napi_create_string_utf8(
        env,
        s.as_ptr() as *const c_char,
        s.len() as _,
        &mut err_reason,
      );
      debug_assert!(status == sys::Status::napi_ok, "Create error reason failed");
      let status = sys::napi_create_error(env, ptr::null_mut(), err_reason, &mut err);
      debug_assert!(status == sys::Status::napi_ok, "Create error failed");
    };
    err
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

#[inline]
pub fn check_status(code: sys::napi_status) -> Result<()> {
  let status = Status::from(code);
  match status {
    Status::Ok => Ok(()),
    _ => Err(Error::new(status, "".to_owned())),
  }
}
