use futures::prelude::*;
use std::os::raw::{c_char, c_void};
use std::ptr;

use crate::error::check_status;
use crate::{sys, Env, NapiValue, Result};

pub struct FuturePromise<T, V: NapiValue> {
  deferred: sys::napi_deferred,
  env: sys::napi_env,
  tsfn: sys::napi_threadsafe_function,
  async_resource_name: sys::napi_value,
  resolver: Box<dyn FnOnce(&mut Env, T) -> Result<V>>,
}

unsafe impl<T, V: NapiValue> Send for FuturePromise<T, V> {}

impl<T, V: NapiValue> FuturePromise<T, V> {
  pub fn create(
    env: sys::napi_env,
    raw_deferred: sys::napi_deferred,
    resolver: Box<dyn FnOnce(&mut Env, T) -> Result<V>>,
  ) -> Result<Self> {
    let mut async_resource_name = ptr::null_mut();
    let s = "napi_resolve_promise_from_future";
    check_status(unsafe {
      sys::napi_create_string_utf8(
        env,
        s.as_ptr() as *const c_char,
        s.len() as _,
        &mut async_resource_name,
      )
    })?;

    Ok(FuturePromise {
      deferred: raw_deferred,
      resolver,
      env,
      tsfn: ptr::null_mut(),
      async_resource_name,
    })
  }

  pub(crate) fn start(self) -> Result<TSFNValue> {
    let mut tsfn_value = ptr::null_mut();
    let async_resource_name = self.async_resource_name;
    let initial_thread_count = 1;
    let env = self.env;
    let self_ref = Box::leak(Box::from(self));
    check_status(unsafe {
      sys::napi_create_threadsafe_function(
        env,
        ptr::null_mut(),
        ptr::null_mut(),
        async_resource_name,
        0,
        initial_thread_count as _,
        ptr::null_mut(),
        None,
        self_ref as *mut _ as *mut c_void,
        Some(call_js_cb::<T, V>),
        &mut tsfn_value,
      )
    })?;
    self_ref.tsfn = tsfn_value;
    Ok(TSFNValue(tsfn_value))
  }
}

pub(crate) struct TSFNValue(sys::napi_threadsafe_function);

unsafe impl Send for TSFNValue {}

#[inline]
pub(crate) async fn resolve_from_future<T: Send, F: Future<Output = Result<T>>>(
  tsfn_value: TSFNValue,
  fut: F,
) {
  let val = fut.await;
  check_status(unsafe { sys::napi_acquire_threadsafe_function(tsfn_value.0) })
    .expect("Failed to acquire thread safe function");
  check_status(unsafe {
    sys::napi_call_threadsafe_function(
      tsfn_value.0,
      Box::into_raw(Box::from(val)) as *mut _ as *mut c_void,
      sys::napi_threadsafe_function_call_mode::napi_tsfn_nonblocking,
    )
  })
  .expect("Failed to call thread safe function");
}

unsafe extern "C" fn call_js_cb<T, V: NapiValue>(
  raw_env: sys::napi_env,
  _js_callback: sys::napi_value,
  context: *mut c_void,
  data: *mut c_void,
) {
  let mut env = Env::from_raw(raw_env);
  let future_promise = Box::from_raw(context as *mut FuturePromise<T, V>);
  let value: Result<T> = ptr::read(data as *const _);
  let resolver = future_promise.resolver;
  let deferred = future_promise.deferred;
  let tsfn = future_promise.tsfn;
  let js_value_to_resolve = value.and_then(move |v| (resolver)(&mut env, v));
  match js_value_to_resolve {
    Ok(v) => {
      let status = sys::napi_resolve_deferred(raw_env, deferred, v.raw());
      debug_assert!(
        status == sys::napi_status::napi_ok,
        "Resolve promise failed"
      );
    }
    Err(e) => {
      let status = sys::napi_reject_deferred(raw_env, deferred, e.into_raw(raw_env));
      debug_assert!(status == sys::napi_status::napi_ok, "Reject promise failed");
    }
  };
  check_status(sys::napi_release_threadsafe_function(
    tsfn,
    sys::napi_threadsafe_function_release_mode::napi_tsfn_release,
  ))
  .expect("Release threadsafe function failed");
}
