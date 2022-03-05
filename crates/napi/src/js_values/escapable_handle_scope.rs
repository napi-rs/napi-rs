use std::ops::Deref;
use std::ptr;

use crate::check_status;
use crate::{sys, Env, NapiRaw, Result};

pub struct EscapableHandleScope<T: NapiRaw> {
  handle_scope: sys::napi_escapable_handle_scope,
  value: T,
}

impl<T: NapiRaw> EscapableHandleScope<T> {
  pub fn open(env: Env, value: T) -> Result<Self> {
    let mut handle_scope = ptr::null_mut();
    check_status!(unsafe { sys::napi_open_escapable_handle_scope(env.0, &mut handle_scope) })?;
    let mut result = ptr::null_mut();
    check_status!(unsafe {
      sys::napi_escape_handle(env.0, handle_scope, NapiRaw::raw(&value), &mut result)
    })?;
    Ok(Self {
      handle_scope,
      value,
    })
  }

  pub fn close(self, env: Env) -> Result<()> {
    check_status!(unsafe { sys::napi_close_escapable_handle_scope(env.0, self.handle_scope) })
  }
}

impl<T: NapiRaw> Deref for EscapableHandleScope<T> {
  type Target = T;

  fn deref(&self) -> &T {
    &self.value
  }
}
