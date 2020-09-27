use std::ops::Deref;
use std::ptr;

use super::check_status;
use crate::{sys, Env, NapiValue, Result};

pub struct EscapableHandleScope<T: NapiValue> {
  handle_scope: sys::napi_escapable_handle_scope,
  value: T,
}

impl<T: NapiValue> EscapableHandleScope<T> {
  #[inline]
  pub fn open(env: sys::napi_env, value: T) -> Result<Self> {
    let mut handle_scope = ptr::null_mut();
    check_status(unsafe { sys::napi_open_escapable_handle_scope(env, &mut handle_scope) })?;
    let mut result = ptr::null_mut();
    check_status(unsafe {
      sys::napi_escape_handle(env, handle_scope, NapiValue::raw(&value), &mut result)
    })?;
    Ok(Self {
      value,
      handle_scope,
    })
  }

  #[must_use]
  pub fn close(self, env: Env) -> Result<()> {
    check_status(unsafe { sys::napi_close_escapable_handle_scope(env.0, self.handle_scope) })
  }
}

impl<T: NapiValue> Deref for EscapableHandleScope<T> {
  type Target = T;

  fn deref(&self) -> &T {
    &self.value
  }
}
