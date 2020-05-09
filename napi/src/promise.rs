use futures::prelude::*;
use std::os::raw::c_char;
use std::ptr;

use crate::{check_status, sys, Env, Result, Value, ValueType};

#[inline]
pub async fn resolve<
  T,
  V: ValueType,
  R: FnOnce(&mut Env, T) -> Result<Value<V>>,
  F: Future<Output = Result<T>>,
>(
  env: sys::napi_env,
  fut: F,
  resolver: R,
  raw_deferred: sys::napi_deferred,
) -> Result<()> {
  let mut raw_resource = ptr::null_mut();
  let status = unsafe { sys::napi_create_object(env, &mut raw_resource) };
  check_status(status)?;
  let mut raw_name = ptr::null_mut();
  let s = "napi_async_context";
  let status = unsafe {
    sys::napi_create_string_utf8(
      env,
      s.as_ptr() as *const c_char,
      s.len() as u64,
      &mut raw_name,
    )
  };
  check_status(status)?;
  let mut raw_context = ptr::null_mut();
  unsafe {
    let status = sys::napi_async_init(env, raw_resource, raw_name, &mut raw_context);
    check_status(status)?;
  }
  let mut handle_scope = ptr::null_mut();
  match fut.await {
    Ok(v) => unsafe {
      check_status(sys::napi_open_handle_scope(env, &mut handle_scope))?;
      let mut tmp_env = Env::from_raw(env);
      let js_value = resolver(&mut tmp_env, v)?;
      check_status(sys::napi_resolve_deferred(
        env,
        raw_deferred,
        js_value.raw_value,
      ))?;
      check_status(sys::napi_close_handle_scope(env, handle_scope))?;
    },
    Err(e) => unsafe {
      check_status(sys::napi_open_handle_scope(env, &mut handle_scope))?;
      check_status(sys::napi_reject_deferred(
        env,
        raw_deferred,
        Env::from_raw(env)
          .create_error(e)
          .map(|e| e.into_raw())
          .unwrap_or(ptr::null_mut()),
      ))?;
      check_status(sys::napi_close_handle_scope(env, handle_scope))?;
    },
  };
  Ok(())
}
