use std::ptr;

use super::Value;
use crate::error::check_status;
use crate::{sys, Env, Error, JsObject, JsUnknown, NapiValue, Result, Status};

#[repr(transparent)]
#[derive(Debug)]
pub struct JsFunction(pub(crate) Value);

/// See [Working with JavaScript Functions](https://nodejs.org/api/n-api.html#n_api_working_with_javascript_functions).
///
/// Example:
/// ```
/// use napi::{JsFunction, CallContext, JsNull, Result};
///
/// #[js_function(1)]
/// pub fn call_function(ctx: CallContext) -> Result<JsNull> {
///   let js_func = ctx.get::<JsFunction>(0)?;
///   let js_string = ctx.env.create_string("hello".as_ref())?.into_unknown()?;
///   js_func.call(None, &[js_string])?;
///   Ok(ctx.env.get_null()?)
/// }
/// ```
impl JsFunction {
  /// [napi_call_function](https://nodejs.org/api/n-api.html#n_api_napi_call_function)
  pub fn call(&self, this: Option<&JsObject>, args: &[JsUnknown]) -> Result<JsUnknown> {
    let raw_this = this
      .map(|v| v.raw())
      .or_else(|| {
        Env::from_raw(self.0.env)
          .get_undefined()
          .ok()
          .map(|u| u.raw())
      })
      .ok_or(Error::new(
        Status::Unknown,
        "Get raw this failed".to_owned(),
      ))?;
    let raw_args = args
      .iter()
      .map(|arg| arg.0.value)
      .collect::<Vec<sys::napi_value>>();
    let mut return_value = ptr::null_mut();
    check_status(unsafe {
      sys::napi_call_function(
        self.0.env,
        raw_this,
        self.0.value,
        args.len() as _,
        raw_args.as_ptr(),
        &mut return_value,
      )
    })?;

    JsUnknown::from_raw(self.0.env, return_value)
  }

  /// https://nodejs.org/api/n-api.html#n_api_napi_new_instance
  /// This method is used to instantiate a new `JavaScript` value using a given `JsFunction` that represents the constructor for the object.
  pub fn new<V>(&self, args: &[V]) -> Result<JsObject>
  where
    V: NapiValue,
  {
    let mut js_instance = ptr::null_mut();
    let length = args.len();
    let raw_args = args
      .iter()
      .map(|arg| arg.raw())
      .collect::<Vec<sys::napi_value>>();
    check_status(unsafe {
      sys::napi_new_instance(
        self.0.env,
        self.0.value,
        length as _,
        raw_args.as_ptr(),
        &mut js_instance,
      )
    })?;
    Ok(JsObject::from_raw_unchecked(self.0.env, js_instance))
  }
}
