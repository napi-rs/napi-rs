use std::mem;
use std::ptr;

use super::Value;
use crate::error::check_status;
use crate::{sys, Env, Error, JsObject, JsUnknown, NapiValue, Result, Status};

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
      .map(|v| v.raw_value())
      .or_else(|| {
        Env::from_raw(self.0.env)
          .get_undefined()
          .ok()
          .map(|u| u.raw_value())
      })
      .ok_or(Error::new(
        Status::Unknown,
        "Get raw this failed".to_owned(),
      ))?;
    let mut raw_args = unsafe { mem::MaybeUninit::<[sys::napi_value; 8]>::uninit().assume_init() };
    for (i, arg) in args.into_iter().enumerate() {
      raw_args[i] = arg.0.value;
    }
    let mut return_value = ptr::null_mut();
    let status = unsafe {
      sys::napi_call_function(
        self.0.env,
        raw_this,
        self.0.value,
        args.len() as u64,
        &raw_args[0],
        &mut return_value,
      )
    };
    check_status(status)?;

    JsUnknown::from_raw(self.0.env, return_value)
  }
}
