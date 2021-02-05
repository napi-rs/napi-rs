use std::ffi::CString;
use std::ptr;

use crate::{check_status, sys, Env, Error};

pub struct JsError(Error);

pub struct JsTypeError(Error);

pub struct JsRangeError(Error);

macro_rules! impl_error_methods {
  ($js_value:ident, $kind:expr) => {
    impl $js_value {
      #[inline(always)]
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
        let create_code_status = sys::napi_create_string_utf8(
          env,
          error_code_string.as_ptr(),
          status_len,
          &mut error_code,
        );
        debug_assert!(
          create_code_status == sys::Status::napi_ok,
          "Create error code failed"
        );
        let create_reason_status =
          sys::napi_create_string_utf8(env, reason.as_ptr(), reason_len, &mut reason_string);
        debug_assert!(
          create_reason_status == sys::Status::napi_ok,
          "Create error reason failed"
        );
        let create_error_status = $kind(env, error_code, reason_string, &mut js_error);
        debug_assert!(
          create_error_status == sys::Status::napi_ok,
          "Create error failed"
        );
        js_error
      }

      #[inline(always)]
      /// # Safety
      ///
      /// This function is safety if env is not null ptr.
      pub unsafe fn throw_into(self, env: sys::napi_env) {
        let js_error = self.into_value(env);
        let throw_status = sys::napi_throw(env, js_error);
        debug_assert!(throw_status == sys::Status::napi_ok, "Throw failed");
      }

      #[inline(always)]
      pub fn throw(&self, env: &Env) -> Result<(), Error> {
        let error_status = format!("{:?}", self.0.status);
        let status_len = error_status.len();
        let error_code_string = CString::new(error_status).unwrap();
        let reason_len = self.0.reason.len();
        let reason = CString::new(self.0.reason.clone()).unwrap();
        let mut error_code = ptr::null_mut();
        let mut reason_string = ptr::null_mut();
        let mut js_error = ptr::null_mut();
        check_status!(unsafe {
          sys::napi_create_string_utf8(
            env.0,
            error_code_string.as_ptr(),
            status_len,
            &mut error_code,
          )
        })?;
        check_status!(unsafe {
          sys::napi_create_string_utf8(env.0, reason.as_ptr(), reason_len, &mut reason_string)
        })?;
        check_status!(unsafe { $kind(env.0, error_code, reason_string, &mut js_error) })?;
        check_status!(unsafe { sys::napi_throw(env.0, js_error) })
      }
    }

    impl From<Error> for $js_value {
      fn from(err: Error) -> Self {
        Self(err)
      }
    }
  };
}

impl_error_methods!(JsError, sys::napi_create_error);
impl_error_methods!(JsTypeError, sys::napi_create_type_error);
impl_error_methods!(JsRangeError, sys::napi_create_range_error);
