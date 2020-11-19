use std::ptr;

use crate::error::check_status;
use crate::{sys, Either, Env, Error, JsUndefined, NapiValue, Result, Status};

/// Function call context
pub struct CallContext<'env> {
  pub env: &'env mut Env,
  raw_this: sys::napi_value,
  callback_info: sys::napi_callback_info,
  args: &'env [sys::napi_value],
  arg_len: usize,
  /// arguments.length
  pub length: usize,
}

impl<'env> CallContext<'env> {
  pub fn new(
    env: &'env mut Env,
    callback_info: sys::napi_callback_info,
    raw_this: sys::napi_value,
    args: &'env [sys::napi_value],
    arg_len: usize,
    length: usize,
  ) -> Self {
    Self {
      env,
      callback_info,
      raw_this,
      args,
      arg_len,
      length,
    }
  }

  pub fn get<ArgType: NapiValue>(&self, index: usize) -> Result<ArgType> {
    if index + 1 > self.arg_len {
      Err(Error {
        status: Status::GenericFailure,
        reason: "Arguments index out of range".to_owned(),
      })
    } else {
      Ok(unsafe { ArgType::from_raw_unchecked(self.env.0, self.args[index]) })
    }
  }

  pub fn try_get<ArgType: NapiValue>(&self, index: usize) -> Result<Either<ArgType, JsUndefined>> {
    if index + 1 > self.arg_len {
      Err(Error {
        status: Status::GenericFailure,
        reason: "Arguments index out of range".to_owned(),
      })
    } else {
      if index < self.length {
        unsafe { ArgType::from_raw(self.env.0, self.args[index]) }.map(Either::A)
      } else {
        self.env.get_undefined().map(Either::B)
      }
    }
  }

  pub fn get_new_target<V>(&self) -> Result<V>
  where
    V: NapiValue,
  {
    let mut value = ptr::null_mut();
    check_status(unsafe { sys::napi_get_new_target(self.env.0, self.callback_info, &mut value) })?;
    unsafe { V::from_raw(self.env.0, value) }
  }

  #[inline(always)]
  pub fn this<T: NapiValue>(&self) -> Result<T> {
    unsafe { T::from_raw(self.env.0, self.raw_this) }
  }

  #[inline(always)]
  pub unsafe fn this_unchecked<T: NapiValue>(&self) -> T {
    T::from_raw_unchecked(self.env.0, self.raw_this)
  }
}
