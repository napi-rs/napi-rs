use std::marker::PhantomData;
use std::os::raw::c_void;
use std::ptr;

use crate::bindgen_runtime::ToNapiValue;
use crate::{check_status, JsObject, Value};
use crate::{sys, Env, Error, Result};
#[cfg(feature = "deferred_trace")]
use crate::{NapiRaw, NapiValue};

#[cfg(feature = "deferred_trace")]
/// A javascript error which keeps a stack trace
/// to the original caller in an asynchronous context.
/// This is required as the stack trace is lost when
/// an error is created in a different thread.
///
/// See this issue for more details:
/// https://github.com/nodejs/node-addon-api/issues/595
#[repr(transparent)]
#[derive(Clone)]
struct DeferredTrace(sys::napi_ref);

#[cfg(feature = "deferred_trace")]
impl DeferredTrace {
  fn new(raw_env: sys::napi_env) -> Result<Self> {
    let env = Env::from_raw(raw_env);
    let reason = env.create_string("none").unwrap();

    let mut js_error = ptr::null_mut();
    check_status!(
      unsafe { sys::napi_create_error(raw_env, ptr::null_mut(), reason.raw(), &mut js_error) },
      "Create error in DeferredTrace failed"
    )?;

    let mut result = ptr::null_mut();
    check_status!(
      unsafe { sys::napi_create_reference(raw_env, js_error, 1, &mut result) },
      "Create reference in DeferredTrace failed"
    )?;

    Ok(Self(result))
  }

  fn into_rejected(self, raw_env: sys::napi_env, err: Error) -> Result<sys::napi_value> {
    let env = Env::from_raw(raw_env);
    let mut raw = ptr::null_mut();
    check_status!(
      unsafe { sys::napi_get_reference_value(raw_env, self.0, &mut raw) },
      "Failed to get referenced value in DeferredTrace"
    )?;

    let mut obj = unsafe { JsObject::from_raw_unchecked(raw_env, raw) };
    let err_value = if !err.maybe_raw.is_null() {
      let mut err_raw_value = std::ptr::null_mut();
      check_status!(
        unsafe { sys::napi_get_reference_value(raw_env, err.maybe_raw, &mut err_raw_value) },
        "Get error reference in `to_napi_value` failed"
      )?;
      let err_obj = unsafe { JsObject::from_raw_unchecked(raw_env, err_raw_value) };

      let err_value = if err_obj.has_named_property("message")? {
        // The error was already created inside the JS engine, just return it
        Ok(unsafe { err_obj.raw() })
      } else {
        obj.set_named_property("message", "")?;
        obj.set_named_property("code", "")?;
        Ok(raw)
      };
      check_status!(
        unsafe { sys::napi_delete_reference(raw_env, err.maybe_raw) },
        "Delete error reference in `to_napi_value` failed"
      )?;
      err_value
    } else {
      obj.set_named_property("message", &err.reason)?;
      obj.set_named_property(
        "code",
        env.create_string_from_std(format!("{}", err.status))?,
      )?;
      Ok(raw)
    };
    check_status!(
      unsafe { sys::napi_delete_reference(raw_env, self.0) },
      "Failed to get referenced value in DeferredTrace"
    )?;
    err_value
  }
}

struct DeferredData<Data: ToNapiValue, Resolver: FnOnce(Env) -> Result<Data>> {
  resolver: Result<Resolver>,
  #[cfg(feature = "deferred_trace")]
  trace: DeferredTrace,
}

pub struct JsDeferred<Data: ToNapiValue, Resolver: FnOnce(Env) -> Result<Data>> {
  pub(crate) tsfn: sys::napi_threadsafe_function,
  #[cfg(feature = "deferred_trace")]
  trace: DeferredTrace,
  _data: PhantomData<Data>,
  _resolver: PhantomData<Resolver>,
}

// A trick to send the resolver into the `panic` handler
// Do not use clone in the other place besides the `fn execute_tokio_future`
impl<Data: ToNapiValue, Resolver: FnOnce(Env) -> Result<Data>> Clone
  for JsDeferred<Data, Resolver>
{
  fn clone(&self) -> Self {
    Self {
      tsfn: self.tsfn,
      #[cfg(feature = "deferred_trace")]
      trace: self.trace.clone(),
      _data: PhantomData,
      _resolver: PhantomData,
    }
  }
}

unsafe impl<Data: ToNapiValue, Resolver: FnOnce(Env) -> Result<Data>> Send
  for JsDeferred<Data, Resolver>
{
}

impl<Data: ToNapiValue, Resolver: FnOnce(Env) -> Result<Data>> JsDeferred<Data, Resolver> {
  pub(crate) fn new(env: sys::napi_env) -> Result<(Self, JsObject)> {
    let (tsfn, promise) = js_deferred_new_raw(env, Some(napi_resolve_deferred::<Data, Resolver>))?;

    let deferred = Self {
      tsfn,
      #[cfg(feature = "deferred_trace")]
      trace: DeferredTrace::new(env)?,
      _data: PhantomData,
      _resolver: PhantomData,
    };

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
        Box::into_raw(Box::from(data)).cast(),
        sys::ThreadsafeFunctionCallMode::blocking,
      )
    };
    debug_assert!(
      status == sys::Status::napi_ok,
      "Call threadsafe function in JsDeferred failed"
    );

    let status = unsafe {
      sys::napi_release_threadsafe_function(self.tsfn, sys::ThreadsafeFunctionReleaseMode::release)
    };
    debug_assert!(
      status == sys::Status::napi_ok,
      "Release threadsafe function in JsDeferred failed"
    );
  }
}

fn js_deferred_new_raw(
  env: sys::napi_env,
  resolve_deferred: sys::napi_threadsafe_function_call_js,
) -> Result<(sys::napi_threadsafe_function, JsObject)> {
  let mut raw_promise = ptr::null_mut();
  let mut raw_deferred = ptr::null_mut();
  check_status! {
    unsafe { sys::napi_create_promise(env, &mut raw_deferred, &mut raw_promise) }
  }?;

  // Create a threadsafe function so we can call back into the JS thread when we are done.
  let mut async_resource_name = ptr::null_mut();
  check_status!(
    unsafe {
      sys::napi_create_string_utf8(
        env,
        c"napi_resolve_deferred".as_ptr().cast(),
        22,
        &mut async_resource_name,
      )
    },
    "Create async resource name in JsDeferred failed"
  )?;

  let mut tsfn = ptr::null_mut();
  check_status!(
    unsafe {
      sys::napi_create_threadsafe_function(
        env,
        ptr::null_mut(),
        ptr::null_mut(),
        async_resource_name,
        0,
        1,
        ptr::null_mut(),
        None,
        raw_deferred.cast(),
        resolve_deferred,
        &mut tsfn,
      )
    },
    "Create threadsafe function in JsDeferred failed"
  )?;

  let promise = JsObject(Value {
    env,
    value: raw_promise,
    value_type: crate::ValueType::Object,
  });

  Ok((tsfn, promise))
}

extern "C" fn napi_resolve_deferred<Data: ToNapiValue, Resolver: FnOnce(Env) -> Result<Data>>(
  env: sys::napi_env,
  _js_callback: sys::napi_value,
  context: *mut c_void,
  data: *mut c_void,
) {
  let deferred = context.cast();
  let deferred_data: Box<DeferredData<Data, Resolver>> = unsafe { Box::from_raw(data.cast()) };
  let result = deferred_data
    .resolver
    .and_then(|resolver| resolver(Env::from_raw(env)))
    .and_then(|res| unsafe { ToNapiValue::to_napi_value(env, res) });

  if let Err(e) = result.and_then(|res| {
    check_status!(
      unsafe { sys::napi_resolve_deferred(env, deferred, res) },
      "Resolve deferred value failed"
    )
  }) {
    #[cfg(feature = "deferred_trace")]
    let error = deferred_data.trace.into_rejected(env, e);
    #[cfg(not(feature = "deferred_trace"))]
    let error = Ok::<sys::napi_value, Error>(unsafe { crate::JsError::from(e).into_value(env) });

    match error {
      Ok(error) => {
        unsafe { sys::napi_reject_deferred(env, deferred, error) };
      }
      Err(err) => {
        if cfg!(debug_assertions) {
          println!("Failed to reject deferred: {:?}", err);
          let mut err = ptr::null_mut();
          let mut err_msg = ptr::null_mut();
          unsafe {
            sys::napi_create_string_utf8(env, c"Rejection failed".as_ptr().cast(), 0, &mut err_msg);
            sys::napi_create_error(env, ptr::null_mut(), err_msg, &mut err);
            sys::napi_reject_deferred(env, deferred, err);
          }
        }
      }
    }
  }
}
