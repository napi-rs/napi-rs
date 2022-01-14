use std::ffi::CStr;
use std::future::Future;
use std::marker::PhantomData;
use std::os::raw::c_void;
use std::ptr;

use crate::{check_status, sys, JsError, Result};

pub struct FuturePromise<Data, Resolver: FnOnce(sys::napi_env, Data) -> Result<sys::napi_value>> {
  deferred: sys::napi_deferred,
  env: sys::napi_env,
  tsfn: sys::napi_threadsafe_function,
  async_resource_name: sys::napi_value,
  resolver: Resolver,
  _data: PhantomData<Data>,
}

#[allow(clippy::non_send_fields_in_send_ty)]
unsafe impl<T, F: FnOnce(sys::napi_env, T) -> Result<sys::napi_value>> Send
  for FuturePromise<T, F>
{
}

impl<Data, Resolver: FnOnce(sys::napi_env, Data) -> Result<sys::napi_value>>
  FuturePromise<Data, Resolver>
{
  pub fn new(env: sys::napi_env, deferred: sys::napi_deferred, resolver: Resolver) -> Result<Self> {
    let mut async_resource_name = ptr::null_mut();
    let s = unsafe { CStr::from_bytes_with_nul_unchecked(b"napi_resolve_promise_from_future\0") };
    check_status!(unsafe {
      sys::napi_create_string_utf8(env, s.as_ptr(), 32, &mut async_resource_name)
    })?;

    Ok(FuturePromise {
      deferred,
      resolver,
      env,
      tsfn: ptr::null_mut(),
      async_resource_name,
      _data: PhantomData,
    })
  }

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
        self_ref as *mut FuturePromise<Data, Resolver> as *mut c_void,
        Some(call_js_cb::<Data, Resolver>),
        &mut tsfn_value,
      )
    })?;
    self_ref.tsfn = tsfn_value;
    Ok(TSFNValue(tsfn_value))
  }
}

pub(crate) struct TSFNValue(sys::napi_threadsafe_function);

unsafe impl Send for TSFNValue {}

pub(crate) async fn resolve_from_future<Data: Send, Fut: Future<Output = Result<Data>>>(
  tsfn_value: TSFNValue,
  fut: Fut,
) {
  let val = fut.await;
  check_status!(unsafe {
    sys::napi_call_threadsafe_function(
      tsfn_value.0,
      Box::into_raw(Box::from(val)) as *mut c_void,
      sys::ThreadsafeFunctionCallMode::nonblocking,
    )
  })
  .expect("Failed to call thread safe function");
  check_status!(unsafe {
    sys::napi_release_threadsafe_function(tsfn_value.0, sys::ThreadsafeFunctionReleaseMode::release)
  })
  .expect("Failed to release thread safe function");
}

unsafe extern "C" fn call_js_cb<
  Data,
  Resolver: FnOnce(sys::napi_env, Data) -> Result<sys::napi_value>,
>(
  env: sys::napi_env,
  _js_callback: sys::napi_value,
  context: *mut c_void,
  data: *mut c_void,
) {
  let future_promise = unsafe { Box::from_raw(context as *mut FuturePromise<Data, Resolver>) };
  let value = unsafe { Box::from_raw(data as *mut Result<Data>) };
  let resolver = future_promise.resolver;
  let deferred = future_promise.deferred;
  let js_value_to_resolve = value.and_then(move |v| (resolver)(env, v));
  match js_value_to_resolve {
    Ok(v) => {
      let status = unsafe { sys::napi_resolve_deferred(env, deferred, v) };
      debug_assert!(status == sys::Status::napi_ok, "Resolve promise failed");
    }
    Err(e) => {
      let status = unsafe {
        sys::napi_reject_deferred(
          env,
          deferred,
          if e.maybe_raw.is_null() {
            JsError::from(e).into_value(env)
          } else {
            let mut err = ptr::null_mut();
            let get_err_status = sys::napi_get_reference_value(env, e.maybe_raw, &mut err);
            debug_assert!(
              get_err_status == sys::Status::napi_ok,
              "Get Error from Reference failed"
            );
            let delete_reference_status = sys::napi_delete_reference(env, e.maybe_raw);
            debug_assert!(
              delete_reference_status == sys::Status::napi_ok,
              "Delete Error Reference failed"
            );
            err
          },
        )
      };
      debug_assert!(status == sys::Status::napi_ok, "Reject promise failed");
    }
  };
}
