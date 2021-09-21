use std::ptr;

use crate::check_status;
use crate::{sys, Either, Env, Error, JsUndefined, NapiValue, Result, Status};

/// Function call context
pub struct CallContext<'env> {
  pub env: &'env mut Env,
  raw_this: sys::napi_value,
  callback_info: sys::napi_callback_info,
  args: &'env [sys::napi_value],
  /// arguments.length
  pub length: usize,
}

impl<'env> CallContext<'env> {
  /// The number of N-api obtained values. In practice this is the numeric
  /// parameter provided to the `#[js_function(arg_len)]` macro.
  ///
  /// As a comparison, the (arguments) `.length` represents the actual number
  /// of arguments given at a specific function call.
  ///
  /// If `.length < .arg_len`, then the elements in the `length .. arg_len`
  /// range are just `JsUndefined`s.
  ///
  /// If `.length > .arg_len`, then truncation has happened and some args have
  /// been lost.
  #[inline]
  fn arg_len(&self) -> usize {
    self.args.len()
  }

  #[inline]
  pub fn new(
    env: &'env mut Env,
    callback_info: sys::napi_callback_info,
    raw_this: sys::napi_value,
    args: &'env [sys::napi_value],
    length: usize,
  ) -> Self {
    Self {
      env,
      raw_this,
      callback_info,
      args,
      length,
    }
  }

  #[inline]
  pub fn get<ArgType: NapiValue>(&self, index: usize) -> Result<ArgType> {
    if index >= self.arg_len() {
      Err(Error {
        status: Status::GenericFailure,
        reason: "Arguments index out of range".to_owned(),
      })
    } else {
      Ok(unsafe { ArgType::from_raw_unchecked(self.env.0, self.args[index]) })
    }
  }

  #[inline]
  pub fn try_get<ArgType: NapiValue>(&self, index: usize) -> Result<Either<ArgType, JsUndefined>> {
    if index >= self.arg_len() {
      Err(Error {
        status: Status::GenericFailure,
        reason: "Arguments index out of range".to_owned(),
      })
    } else if index < self.length {
      unsafe { ArgType::from_raw(self.env.0, self.args[index]) }.map(Either::A)
    } else {
      self.env.get_undefined().map(Either::B)
    }
  }

  #[inline]
  pub fn get_all(&self) -> Vec<crate::JsUnknown> {
    /* (0 .. self.arg_len()).map(|i| self.get(i).unwrap()).collect() */
    self
      .args
      .iter()
      .map(|&raw| unsafe { crate::JsUnknown::from_raw_unchecked(self.env.0, raw) })
      .collect()
  }

  #[inline]
  pub fn get_new_target<V>(&self) -> Result<V>
  where
    V: NapiValue,
  {
    let mut value = ptr::null_mut();
    check_status!(unsafe { sys::napi_get_new_target(self.env.0, self.callback_info, &mut value) })?;
    unsafe { V::from_raw(self.env.0, value) }
  }

  #[inline]
  pub fn this<T: NapiValue>(&self) -> Result<T> {
    unsafe { T::from_raw(self.env.0, self.raw_this) }
  }

  #[inline]
  pub fn this_unchecked<T: NapiValue>(&self) -> T {
    unsafe { T::from_raw_unchecked(self.env.0, self.raw_this) }
  }
}
