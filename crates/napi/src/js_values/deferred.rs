use std::ffi::CStr;
use std::marker::PhantomData;
use std::os::raw::c_void;
use std::ptr;

use crate::bindgen_runtime::{ToNapiValue, THREAD_DESTROYED};
use crate::{check_status, JsObject, Value};
use crate::{sys, Env, Error, Result};

#[cfg(feature = "deferred_trace")]
/// A javascript error which keeps a stack trace
/// to the original caller in an asynchronous context.
/// This is required as the stack trace is lost when
/// an error is created in a different thread.
///
/// See this issue for more details:
/// https://github.com/nodejs/node-addon-api/issues/595
struct DeferredTrace {
  value: sys::napi_ref,
  #[cfg(not(feature = "noop"))]
  env: sys::napi_env,
}

#[cfg(feature = "deferred_trace")]
impl DeferredTrace {
  fn new(env: sys::napi_env) -> Self {
    // The message will be replaced by the actual error message when the promise is rejected.
    let none = unsafe { CStr::from_bytes_with_nul_unchecked(b"none\0") };

    let mut error_code = ptr::null_mut();
    let mut reason_string = ptr::null_mut();
    let mut js_error = ptr::null_mut();
    let create_code_status =
      unsafe { sys::napi_create_string_utf8(env, none.as_ptr(), 4, &mut error_code) };
    debug_assert!(create_code_status == sys::Status::napi_ok);
    let create_reason_status =
      unsafe { sys::napi_create_string_utf8(env, none.as_ptr(), 4, &mut reason_string) };
    debug_assert!(create_reason_status == sys::Status::napi_ok);
    let create_error_status =
      unsafe { sys::napi_create_error(env, error_code, reason_string, &mut js_error) };
    debug_assert!(create_error_status == sys::Status::napi_ok);

    let mut result = ptr::null_mut();
    let status = unsafe { sys::napi_create_reference(env, js_error, 1, &mut result) };
    debug_assert!(status == sys::Status::napi_ok);

    Self {
      value: result,
      #[cfg(not(feature = "noop"))]
      env,
    }
  }

  fn into_rejected(self, env: sys::napi_env, err: Error) -> sys::napi_value {
    let mut raw_reason = ptr::null_mut();
    let create_reason_status = unsafe {
      sys::napi_create_string_utf8(
        env,
        err.reason.as_ptr() as *const std::os::raw::c_char,
        err.reason.len(),
        &mut raw_reason,
      )
    };
    debug_assert!(
      create_reason_status == sys::Status::napi_ok,
      "Failed to convert error reason"
    );

    let status = err.status.to_string();
    let mut raw_status = ptr::null_mut();
    let create_status_status = unsafe {
      sys::napi_create_string_utf8(
        env,
        status.as_ptr() as *const std::os::raw::c_char,
        status.len(),
        &mut raw_status,
      )};
    debug_assert!(
      create_status_status == sys::Status::napi_ok,
      "Failed to convert error status"
    );

    let raw = unsafe { DeferredTrace::to_napi_value(env, self) }.unwrap();
    let message = unsafe { CStr::from_bytes_with_nul_unchecked(b"message\0") };

    let set_message_status =
      unsafe { sys::napi_set_named_property(env, raw, message.as_ptr(), raw_reason) };
    debug_assert!(
      set_message_status == sys::Status::napi_ok,
      "Failed to set error message"
    );

    let code = unsafe { CStr::from_bytes_with_nul_unchecked(b"code\0") };
    let set_code_status =
      unsafe { sys::napi_set_named_property(env, raw, code.as_ptr(), raw_status) };
    debug_assert!(
      set_code_status == sys::Status::napi_ok,
      "Failed to set error code"
    );

    raw
  }
}

#[cfg(feature = "deferred_trace")]
impl ToNapiValue for DeferredTrace {
  unsafe fn to_napi_value(env: sys::napi_env, val: Self) -> Result<sys::napi_value> {
    let mut value = ptr::null_mut();
    check_status!(unsafe { sys::napi_get_reference_value(env, val.value, &mut value) })?;

    if value == ptr::null_mut() {
      // This shouldn't happen but a panic is better than a segfault
      Err(Error::new(
        crate::Status::GenericFailure,
        "Failed to get deferred error reference",
      ))
    } else {
      Ok(value)
    }
  }
}

#[cfg(feature = "deferred_trace")]
impl Drop for DeferredTrace {
  fn drop(&mut self) {
    #[cfg(not(feature = "noop"))]
    {
      if !self.env.is_null() && !self.value.is_null() {
        let delete_reference_status = unsafe { sys::napi_delete_reference(self.env, self.value) };
        debug_assert!(
          delete_reference_status == sys::Status::napi_ok,
          "Delete Error Reference failed"
        );
      }
    }
  }
}

struct DeferredData<Data: ToNapiValue, Resolver: FnOnce(Env) -> Result<Data>> {
  resolver: Result<Resolver>,
  #[cfg(feature = "deferred_trace")]
  trace: DeferredTrace,
}

pub struct JsDeferred<Data: ToNapiValue, Resolver: FnOnce(Env) -> Result<Data>> {
  tsfn: sys::napi_threadsafe_function,
  #[cfg(feature = "deferred_trace")]
  trace: DeferredTrace,
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
      #[cfg(feature = "deferred_trace")]
      trace: DeferredTrace::new(env),
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
    let data = DeferredData {
      resolver: result,
      #[cfg(feature = "deferred_trace")]
      trace: self.trace,
    };

    // Call back into the JS thread via a threadsafe function. This results in napi_resolve_deferred being called.
    let status = unsafe {
      sys::napi_call_threadsafe_function(
        self.tsfn,
        Box::into_raw(Box::from(data)) as *mut c_void,
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
  #[cfg(not(target_arch = "wasm32"))]
  {
    if THREAD_DESTROYED.with(|closed| closed.load(std::sync::atomic::Ordering::Relaxed)) {
      return;
    }
  }
  let deferred = context as sys::napi_deferred;
  let deferred_data = unsafe { Box::from_raw(data as *mut DeferredData<Data, Resolver>) };
  let result = deferred_data
    .resolver
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
      #[cfg(feature = "deferred_trace")]
      let error = deferred_data.trace.into_rejected(env, e);
      #[cfg(not(feature = "deferred_trace"))]
      let error = unsafe { crate::JsError::from(e).into_value(env) };

      let status = unsafe { sys::napi_reject_deferred(env, deferred, error) };
      debug_assert!(
        status == sys::Status::napi_ok,
        "Reject promise failed {:?}",
        crate::Status::from(status)
      );
    }
  }
}
