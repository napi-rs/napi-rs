#[cfg(feature = "serde-json")]
use std::fmt::Display;
use std::{
  convert::{From, TryFrom},
  error,
  ffi::{CStr, CString},
  fmt,
  os::raw::{c_char, c_void},
  ptr,
};

#[cfg(feature = "serde-json")]
use serde::{de, ser};
#[cfg(feature = "serde-json")]
use serde_json::Error as SerdeJSONError;

use crate::{check_status, sys, Status};

pub type Result<T> = std::result::Result<T, Error>;

/// Represent `JsError`.
/// Return this Error in `js_function`, **napi-rs** will throw it as `JsError` for you.
/// If you want throw it as `TypeError` or `RangeError`, you can use `JsTypeError/JsRangeError::from(Error).throw_into(env)`
#[derive(Debug, Clone)]
pub struct Error {
  pub status: Status,
  pub reason: String,
  // Convert raw `JsError` into Error
  // Only be used in `async fn(p: Promise<T>)` scenario
  #[cfg(all(feature = "tokio_rt", feature = "napi4"))]
  pub(crate) maybe_raw: sys::napi_ref,
}

unsafe impl Send for Error {}
unsafe impl Sync for Error {}

impl error::Error for Error {}

impl From<std::convert::Infallible> for Error {
  fn from(_: std::convert::Infallible) -> Self {
    unreachable!()
  }
}

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

#[cfg(all(feature = "tokio_rt", feature = "napi4"))]
impl From<sys::napi_ref> for Error {
  fn from(value: sys::napi_ref) -> Self {
    Self {
      status: Status::InvalidArg,
      reason: "".to_string(),
      maybe_raw: value,
    }
  }
}

#[cfg(feature = "anyhow")]
impl From<anyhow::Error> for Error {
  fn from(value: anyhow::Error) -> Self {
    Error::new(Status::GenericFailure, format!("{}", value))
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
    Error {
      status,
      reason,
      #[cfg(all(feature = "tokio_rt", feature = "napi4"))]
      maybe_raw: ptr::null_mut(),
    }
  }

  pub fn from_status(status: Status) -> Self {
    Error {
      status,
      reason: "".to_owned(),
      #[cfg(all(feature = "tokio_rt", feature = "napi4"))]
      maybe_raw: ptr::null_mut(),
    }
  }

  pub fn from_reason<T: Into<String>>(reason: T) -> Self {
    Error {
      status: Status::GenericFailure,
      reason: reason.into(),
      #[cfg(all(feature = "tokio_rt", feature = "napi4"))]
      maybe_raw: ptr::null_mut(),
    }
  }
}

impl From<std::ffi::NulError> for Error {
  fn from(error: std::ffi::NulError) -> Self {
    Error {
      status: Status::GenericFailure,
      reason: format!("{}", error),
      #[cfg(all(feature = "tokio_rt", feature = "napi4"))]
      maybe_raw: ptr::null_mut(),
    }
  }
}

impl From<std::io::Error> for Error {
  fn from(error: std::io::Error) -> Self {
    Error {
      status: Status::GenericFailure,
      reason: format!("{}", error),
      #[cfg(all(feature = "tokio_rt", feature = "napi4"))]
      maybe_raw: ptr::null_mut(),
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

pub struct JsError(Error);

#[cfg(feature = "anyhow")]
impl From<anyhow::Error> for JsError {
  fn from(value: anyhow::Error) -> Self {
    JsError(Error::new(Status::GenericFailure, value.to_string()))
  }
}

pub struct JsTypeError(Error);

pub struct JsRangeError(Error);

#[cfg(feature = "experimental")]
pub struct JsSyntaxError(Error);

macro_rules! impl_object_methods {
  ($js_value:ident, $kind:expr) => {
    impl $js_value {
      /// # Safety
      ///
      /// This function is safety if env is not null ptr.
      pub unsafe fn into_value(self, env: sys::napi_env) -> sys::napi_value {
        let error_status = format!("{:?}", self.0.status);
        let status_len = error_status.len();
        let error_code_string = CString::new(error_status).unwrap();
        let reason_len = self.0.reason.len();
        let reason = CString::new(self.0.reason).unwrap();
        let mut error_code = ptr::null_mut();
        let mut reason_string = ptr::null_mut();
        let mut js_error = ptr::null_mut();
        let create_code_status = unsafe {
          sys::napi_create_string_utf8(env, error_code_string.as_ptr(), status_len, &mut error_code)
        };
        debug_assert!(create_code_status == sys::Status::napi_ok);
        let create_reason_status = unsafe {
          sys::napi_create_string_utf8(env, reason.as_ptr(), reason_len, &mut reason_string)
        };
        debug_assert!(create_reason_status == sys::Status::napi_ok);
        let create_error_status = unsafe { $kind(env, error_code, reason_string, &mut js_error) };
        debug_assert!(create_error_status == sys::Status::napi_ok);
        js_error
      }

      /// # Safety
      ///
      /// This function is safety if env is not null ptr.
      pub unsafe fn throw_into(self, env: sys::napi_env) {
        #[cfg(debug_assertions)]
        let reason = self.0.reason.clone();
        let status = self.0.status;
        if status == Status::PendingException {
          return;
        }
        let js_error = unsafe { self.into_value(env) };
        #[cfg(debug_assertions)]
        let throw_status = unsafe { sys::napi_throw(env, js_error) };
        unsafe { sys::napi_throw(env, js_error) };
        #[cfg(debug_assertions)]
        assert!(
          throw_status == sys::Status::napi_ok,
          "Throw error failed, status: [{}], raw message: \"{}\", raw status: [{}]",
          Status::from(throw_status),
          reason,
          Status::from(status)
        );
      }

      #[allow(clippy::not_unsafe_ptr_arg_deref)]
      pub fn throw(&self, env: sys::napi_env) -> Result<()> {
        let error_status = format!("{:?}\0", self.0.status);
        let status_len = error_status.len();
        let error_code_string =
          unsafe { CStr::from_bytes_with_nul_unchecked(error_status.as_bytes()) };
        let reason_len = self.0.reason.len();
        let reason_c_string = format!("{}\0", self.0.reason.clone());
        let reason = unsafe { CStr::from_bytes_with_nul_unchecked(reason_c_string.as_bytes()) };
        let mut error_code = ptr::null_mut();
        let mut reason_string = ptr::null_mut();
        let mut js_error = ptr::null_mut();
        check_status!(unsafe {
          sys::napi_create_string_utf8(env, error_code_string.as_ptr(), status_len, &mut error_code)
        })?;
        check_status!(unsafe {
          sys::napi_create_string_utf8(env, reason.as_ptr(), reason_len, &mut reason_string)
        })?;
        check_status!(unsafe { $kind(env, error_code, reason_string, &mut js_error) })?;
        check_status!(unsafe { sys::napi_throw(env, js_error) })
      }
    }

    impl From<Error> for $js_value {
      fn from(err: Error) -> Self {
        Self(err)
      }
    }
  };
}

impl_object_methods!(JsError, sys::napi_create_error);
impl_object_methods!(JsTypeError, sys::napi_create_type_error);
impl_object_methods!(JsRangeError, sys::napi_create_range_error);
#[cfg(feature = "experimental")]
impl_object_methods!(JsSyntaxError, sys::node_api_create_syntax_error);

#[doc(hidden)]
#[macro_export]
macro_rules! error {
  ($status:expr, $($msg:tt)*) => {
    $crate::Error::new($status, format!($($msg)*))
  };
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

  ($code:expr, $($msg:tt)*) => {{
    let c = $code;
    match c {
      $crate::sys::Status::napi_ok => Ok(()),
      _ => Err($crate::Error::new($crate::Status::from(c), format!($($msg)*))),
    }
  }};
}
