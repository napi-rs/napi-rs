use std::ops::Deref;
use std::ptr;

use crate::{check_status, sys, Env, IntoNapiValue, Result};

pub struct EscapableHandleScope<T: IntoNapiValue> {
  handle_scope: sys::napi_escapable_handle_scope,
  value: T,
}

impl<T: IntoNapiValue> EscapableHandleScope<T> {
  #[inline]
  pub fn open(env: sys::napi_env, value: T) -> Result<Self> {
    let mut handle_scope = ptr::null_mut();
    check_status!(unsafe { sys::napi_open_escapable_handle_scope(env, &mut handle_scope) })?;
    let mut result = ptr::null_mut();
    check_status!(unsafe {
      sys::napi_escape_handle(env, handle_scope, IntoNapiValue::raw(&value), &mut result)
    })?;
    Ok(Self {
      value,
      handle_scope,
    })
  }

  pub fn close(self, env: Env) -> Result<()> {
    check_status!(unsafe { sys::napi_close_escapable_handle_scope(env.0, self.handle_scope) })
  }
}

impl<T: IntoNapiValue> Deref for EscapableHandleScope<T> {
  type Target = T;

  fn deref(&self) -> &T {
    &self.value
  }
}
