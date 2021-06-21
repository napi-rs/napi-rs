use std::future::Future;
use std::marker::PhantomData;
use std::os::raw::{c_char, c_void};
use std::ptr;

use crate::{check_status, sys, Env, JsError, NapiRaw, Result};

pub struct FuturePromise<T, V: NapiRaw, F: FnOnce(&mut Env, T) -> Result<V>> {
  deferred: sys::napi_deferred,
  env: sys::napi_env,
  tsfn: sys::napi_threadsafe_function,
  async_resource_name: sys::napi_value,
  resolver: F,
  _data: PhantomData<T>,
  _value: PhantomData<V>,
}

unsafe impl<T, V: NapiRaw, F: FnOnce(&mut Env, T) -> Result<V>> Send for FuturePromise<T, V, F> {}

impl<T, V: NapiRaw, F: FnOnce(&mut Env, T) -> Result<V>> FuturePromise<T, V, F> {
  #[inline]
  pub fn create(env: sys::napi_env, raw_deferred: sys::napi_deferred, resolver: F) -> Result<Self> {
    let mut async_resource_name = ptr::null_mut();
    let s = "napi_resolve_promise_from_future";
    check_status!(unsafe {
      sys::napi_create_string_utf8(
        env,
        s.as_ptr() as *const c_char,
        s.len(),
        &mut async_resource_name,
      )
    })?;

    Ok(FuturePromise {
      deferred: raw_deferred,
      resolver,
      env,
      tsfn: ptr::null_mut(),
      async_resource_name,
      _data: PhantomData,
      _value: PhantomData,
    })
  }

  #[inline]
  pub(crate) fn start(self) -> Result<TSFNValue> {
    let mut tsfn_value = ptr::null_mut();
    let async_resource_name = self.async_resource_name;
    let env = self.env;
    let self_ref = Box::leak(Box::from(self));
    check_status!(unsafe {
      sys::napi_create_threadsafe_function(
        env,
        ptr::null_mut(),
        ptr::null_mut(),
        async_resource_name,
        0,
        1,
        ptr::null_mut(),
        None,
        self_ref as *mut FuturePromise<T, V, F> as *mut c_void,
        Some(call_js_cb::<T, V, F>),
        &mut tsfn_value,
      )
    })?;
    self_ref.tsfn = tsfn_value;
    Ok(TSFNValue(tsfn_value))
  }
}

pub(crate) struct TSFNValue(sys::napi_threadsafe_function);

unsafe impl Send for TSFNValue {}

#[inline(always)]
pub(crate) async fn resolve_from_future<T: Send, F: Future<Output = Result<T>>>(
  tsfn_value: TSFNValue,
  fut: F,
) {
  let val = fut.await;
  check_status!(unsafe {
    sys::napi_call_threadsafe_function(
      tsfn_value.0,
      Box::into_raw(Box::from(val)) as *mut T as *mut c_void,
      sys::napi_threadsafe_function_call_mode::napi_tsfn_nonblocking,
    )
  })
  .expect("Failed to call thread safe function");
  check_status!(unsafe {
    sys::napi_release_threadsafe_function(
      tsfn_value.0,
      sys::napi_threadsafe_function_release_mode::napi_tsfn_release,
    )
  })
  .expect("Failed to release thread safe function");
}

unsafe extern "C" fn call_js_cb<T, V: NapiRaw, F: FnOnce(&mut Env, T) -> Result<V>>(
  raw_env: sys::napi_env,
  _js_callback: sys::napi_value,
  context: *mut c_void,
  data: *mut c_void,
) {
  let mut env = Env::from_raw(raw_env);
  let future_promise = Box::from_raw(context as *mut FuturePromise<T, V, F>);
  let value = Box::from_raw(data as *mut Result<T>);
  let resolver = future_promise.resolver;
  let deferred = future_promise.deferred;
  let js_value_to_resolve = value.and_then(move |v| (resolver)(&mut env, v));
  match js_value_to_resolve {
    Ok(v) => {
      let status = sys::napi_resolve_deferred(raw_env, deferred, v.raw());
      debug_assert!(status == sys::Status::napi_ok, "Resolve promise failed");
    }
    Err(e) => {
      let status =
        sys::napi_reject_deferred(raw_env, deferred, JsError::from(e).into_value(raw_env));
      debug_assert!(status == sys::Status::napi_ok, "Reject promise failed");
    }
  };
}
