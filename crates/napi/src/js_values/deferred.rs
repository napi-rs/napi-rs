use std::ffi::CStr;
use std::marker::PhantomData;
use std::os::raw::c_void;
use std::ptr;

use crate::bindgen_runtime::ToNapiValue;
use crate::{check_status, JsError, JsObject, Value};
use crate::{sys, Env, Error, Result};

pub struct JsDeferred<Data: ToNapiValue, Resolver: FnOnce(Env) -> Result<Data>> {
  tsfn: sys::napi_threadsafe_function,
  _data: PhantomData<Data>,
  _resolver: PhantomData<Resolver>,
}

unsafe impl<Data: ToNapiValue, Resolver: FnOnce(Env) -> Result<Data>> Send
  for JsDeferred<Data, Resolver>
{
}

impl<Data: ToNapiValue, Resolver: FnOnce(Env) -> Result<Data>> JsDeferred<Data, Resolver> {
  pub(crate) fn new(env: sys::napi_env) -> Result<(Self, JsObject)> {
    let mut raw_promise = ptr::null_mut();
    let mut raw_deferred = ptr::null_mut();
    check_status! {
      unsafe { sys::napi_create_promise(env, &mut raw_deferred, &mut raw_promise) }
    }?;

    // Create a threadsafe function so we can call back into the JS thread when we are done.
    let mut async_resource_name = ptr::null_mut();
    let s = unsafe { CStr::from_bytes_with_nul_unchecked(b"napi_resolve_deferred\0") };
    check_status!(unsafe {
      sys::napi_create_string_utf8(env, s.as_ptr(), 22, &mut async_resource_name)
    })?;

    let mut tsfn = ptr::null_mut();
    check_status! {unsafe {
      sys::napi_create_threadsafe_function(
        env,
        ptr::null_mut(),
        ptr::null_mut(),
        async_resource_name,
        0,
        1,
        ptr::null_mut(),
        None,
        raw_deferred as *mut c_void,
        Some(napi_resolve_deferred::<Data, Resolver>),
        &mut tsfn,
      )
    }}?;

    let deferred = Self {
      tsfn,
      _data: PhantomData,
      _resolver: PhantomData,
    };

    let promise = JsObject(Value {
      env,
      value: raw_promise,
      value_type: crate::ValueType::Object,
    });

    Ok((deferred, promise))
  }

  /// Consumes the deferred, and resolves the promise. The provided function will be called
  /// from the JavaScript thread, and should return the resolved value.
  pub fn resolve(self, resolver: Resolver) {
    self.call_tsfn(Ok(resolver))
  }

  /// Consumes the deferred, and rejects the promise with the provided error.
  pub fn reject(self, error: Error) {
    self.call_tsfn(Err(error))
  }

  fn call_tsfn(self, result: Result<Resolver>) {
    // Call back into the JS thread via a threadsafe function. This results in napi_resolve_deferred being called.
    let status = unsafe {
      sys::napi_call_threadsafe_function(
        self.tsfn,
        Box::into_raw(Box::from(result)) as *mut c_void,
        sys::ThreadsafeFunctionCallMode::nonblocking,
      )
    };
    debug_assert!(
      status == sys::Status::napi_ok,
      "Call threadsafe function failed"
    );

    let status = unsafe {
      sys::napi_release_threadsafe_function(self.tsfn, sys::ThreadsafeFunctionReleaseMode::release)
    };
    debug_assert!(
      status == sys::Status::napi_ok,
      "Release threadsafe function failed"
    );
  }
}

extern "C" fn napi_resolve_deferred<Data: ToNapiValue, Resolver: FnOnce(Env) -> Result<Data>>(
  env: sys::napi_env,
  _js_callback: sys::napi_value,
  context: *mut c_void,
  data: *mut c_void,
) {
  let deferred = context as sys::napi_deferred;
  let resolver = unsafe { Box::from_raw(data as *mut Result<Resolver>) };
  let result = resolver
    .and_then(|resolver| resolver(unsafe { Env::from_raw(env) }))
    .and_then(|res| unsafe { ToNapiValue::to_napi_value(env, res) });

  match result {
    Ok(res) => {
      let status = unsafe { sys::napi_resolve_deferred(env, deferred, res) };
      debug_assert!(
        status == sys::Status::napi_ok,
        "Resolve promise failed {:?}",
        crate::Status::from(status)
      );
    }
    Err(e) => {
      let status =
        unsafe { sys::napi_reject_deferred(env, deferred, JsError::from(e).into_value(env)) };
      debug_assert!(
        status == sys::Status::napi_ok,
        "Reject promise failed {:?}",
        crate::Status::from(status)
      );
    }
  }
}
