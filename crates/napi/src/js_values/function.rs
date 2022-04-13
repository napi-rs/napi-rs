use std::ptr;

use super::Value;
use crate::bindgen_runtime::TypeName;
#[cfg(feature = "napi4")]
use crate::{
  bindgen_runtime::ToNapiValue,
  threadsafe_function::{ThreadSafeCallContext, ThreadsafeFunction},
};
use crate::{check_status, ValueType};
use crate::{sys, Env, Error, JsObject, JsUnknown, NapiRaw, NapiValue, Result, Status};

pub struct JsFunction(pub(crate) Value);

impl TypeName for JsFunction {
  fn type_name() -> &'static str {
    "Function"
  }

  fn value_type() -> crate::ValueType {
    ValueType::Function
  }
}

/// See [Working with JavaScript Functions](https://nodejs.org/api/n-api.html#n_api_working_with_javascript_functions).
///
/// Example:
/// ```
/// use napi::{JsFunction, CallContext, JsNull, Result};
///
/// #[js_function(1)]
/// pub fn call_function(ctx: CallContext) -> Result<JsNull> {
///     let js_func = ctx.get::<JsFunction>(0)?;
///     let js_string = ctx.env.create_string("hello".as_ref())?.into_unknown()?;
///     js_func.call(None, &[js_string])?;
///     Ok(ctx.env.get_null()?)
/// }
/// ```
impl JsFunction {
  /// [napi_call_function](https://nodejs.org/api/n-api.html#n_api_napi_call_function)
  pub fn call<V>(&self, this: Option<&JsObject>, args: &[V]) -> Result<JsUnknown>
  where
    V: NapiRaw,
  {
    let raw_this = this
      .map(|v| unsafe { v.raw() })
      .or_else(|| {
        unsafe { Env::from_raw(self.0.env) }
          .get_undefined()
          .ok()
          .map(|u| unsafe { u.raw() })
      })
      .ok_or_else(|| Error::new(Status::GenericFailure, "Get raw this failed".to_owned()))?;
    let raw_args = args
      .iter()
      .map(|arg| unsafe { arg.raw() })
      .collect::<Vec<sys::napi_value>>();
    let mut return_value = ptr::null_mut();
    check_status!(unsafe {
      sys::napi_call_function(
        self.0.env,
        raw_this,
        self.0.value,
        args.len(),
        raw_args.as_ptr(),
        &mut return_value,
      )
    })?;

    unsafe { JsUnknown::from_raw(self.0.env, return_value) }
  }

  /// [napi_call_function](https://nodejs.org/api/n-api.html#n_api_napi_call_function)
  /// The same with `call`, but without arguments
  pub fn call_without_args(&self, this: Option<&JsObject>) -> Result<JsUnknown> {
    let raw_this = this
      .map(|v| unsafe { v.raw() })
      .or_else(|| {
        unsafe { Env::from_raw(self.0.env) }
          .get_undefined()
          .ok()
          .map(|u| unsafe { u.raw() })
      })
      .ok_or_else(|| Error::new(Status::GenericFailure, "Get raw this failed".to_owned()))?;
    let mut return_value = ptr::null_mut();
    check_status!(unsafe {
      sys::napi_call_function(
        self.0.env,
        raw_this,
        self.0.value,
        0,
        ptr::null_mut(),
        &mut return_value,
      )
    })?;

    unsafe { JsUnknown::from_raw(self.0.env, return_value) }
  }

  /// <https://nodejs.org/api/n-api.html#n_api_napi_new_instance>
  ///
  /// This method is used to instantiate a new `JavaScript` value using a given `JsFunction` that represents the constructor for the object.
  pub fn new_instance<V>(&self, args: &[V]) -> Result<JsObject>
  where
    V: NapiRaw,
  {
    let mut js_instance = ptr::null_mut();
    let length = args.len();
    let raw_args = args
      .iter()
      .map(|arg| unsafe { arg.raw() })
      .collect::<Vec<sys::napi_value>>();
    check_status!(unsafe {
      sys::napi_new_instance(
        self.0.env,
        self.0.value,
        length,
        raw_args.as_ptr(),
        &mut js_instance,
      )
    })?;
    Ok(unsafe { JsObject::from_raw_unchecked(self.0.env, js_instance) })
  }

  #[cfg(feature = "napi4")]
  pub fn create_threadsafe_function<T, V, F, ES>(
    &self,
    max_queue_size: usize,
    callback: F,
  ) -> Result<ThreadsafeFunction<T, ES>>
  where
    T: 'static,
    V: ToNapiValue,
    F: 'static + Send + FnMut(ThreadSafeCallContext<T>) -> Result<Vec<V>>,
    ES: crate::threadsafe_function::ErrorStrategy::T,
  {
    ThreadsafeFunction::create(self.0.env, self.0.value, max_queue_size, callback)
  }
}
