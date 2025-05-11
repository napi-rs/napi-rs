use std::ops::Deref;
use std::ptr;

use crate::{check_status, sys, Env, JsValue, Result};

pub struct EscapableHandleScope<T> {
  handle_scope: sys::napi_escapable_handle_scope,
  value: T,
}

impl<'env, T: JsValue<'env>> EscapableHandleScope<T> {
  pub fn open(env: Env, value: T) -> Result<Self> {
    let mut handle_scope = ptr::null_mut();
    check_status!(unsafe { sys::napi_open_escapable_handle_scope(env.0, &mut handle_scope) })?;
    let mut result = ptr::null_mut();
    check_status!(unsafe {
      sys::napi_escape_handle(env.0, handle_scope, value.raw(), &mut result)
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

impl<'env, T: JsValue<'env>> Deref for EscapableHandleScope<T> {
  type Target = T;

  fn deref(&self) -> &T {
    &self.value
  }
}
