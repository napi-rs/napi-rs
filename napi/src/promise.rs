use futures::prelude::*;
use std::os::raw::{c_char, c_void};
use std::ptr;

use crate::error::check_status;
use crate::{sys, Env, NapiValue, Result};

struct FuturePromise<T, V: NapiValue> {
  deferred: sys::napi_deferred,
  resolver: Box<dyn FnOnce(&mut Env, T) -> Result<V>>,
}

#[inline]
pub async fn resolve_from_future<
  T,
  V: NapiValue,
  R: FnOnce(&mut Env, T) -> Result<V> + 'static,
  F: Future<Output = Result<T>>,
>(
  env: sys::napi_env,
  fut: F,
  resolver: R,
  raw_deferred: sys::napi_deferred,
) -> Result<()> {
  let mut async_resource_name = ptr::null_mut();
  let s = "napi_resolve_promise_from_future";
  let status = unsafe {
    sys::napi_create_string_utf8(
      env,
      s.as_ptr() as *const c_char,
      s.len() as u64,
      &mut async_resource_name,
    )
  };
  check_status(status)?;

  let initial_thread_count: u64 = 1;
  let mut tsfn_value = ptr::null_mut();
  let future_promise = FuturePromise {
    deferred: raw_deferred,
    resolver: Box::from(resolver),
  };
  let status = unsafe {
    sys::napi_create_threadsafe_function(
      env,
      ptr::null_mut(),
      ptr::null_mut(),
      async_resource_name,
      0,
      initial_thread_count,
      ptr::null_mut(),
      None,
      Box::leak(Box::from(future_promise)) as *mut _ as *mut c_void,
      Some(call_js_cb::<T, V>),
      &mut tsfn_value,
    )
  };
  check_status(status)?;
  let val = fut.await?;
  check_status(unsafe {
    sys::napi_call_threadsafe_function(
      tsfn_value,
      Box::into_raw(Box::from(val)) as *mut _ as *mut c_void,
      sys::napi_threadsafe_function_call_mode::napi_tsfn_nonblocking,
    )
  })?;
  check_status(unsafe {
    sys::napi_release_threadsafe_function(
      tsfn_value,
      sys::napi_threadsafe_function_release_mode::napi_tsfn_release,
    )
  })
}

unsafe extern "C" fn call_js_cb<T, V: NapiValue>(
  raw_env: sys::napi_env,
  _js_callback: sys::napi_value,
  context: *mut c_void,
  data: *mut c_void,
) {
  let mut env = Env::from_raw(raw_env);
  let future_promise = Box::from_raw(context as *mut FuturePromise<T, V>);
  let value = ptr::read(data as *const _);
  let js_value_to_resolve = (future_promise.resolver)(&mut env, value);
  let deferred = future_promise.deferred;
  match js_value_to_resolve {
    Ok(v) => {
      let status = sys::napi_resolve_deferred(raw_env, deferred, v.raw_value());
      debug_assert!(status == sys::napi_status::napi_ok, "Resolve promise failed");
    }
    Err(e) => {
      let status = sys::napi_reject_deferred(raw_env, deferred, e.into_raw(raw_env));
      debug_assert!(status == sys::napi_status::napi_ok, "Reject promise failed");
    }
  };
}
