use std::ptr;

use crate::error::check_status;
use crate::{sys, Either, Env, Error, JsUndefined, JsUnknown, NapiValue, Result, Status};

pub struct CallContext<'env, T: NapiValue = JsUnknown> {
  pub env: &'env Env,
  pub this: T,
  callback_info: sys::napi_callback_info,
  args: &'env [sys::napi_value],
  arg_len: usize,
  actual_arg_length: usize,
}

impl<'env, T: NapiValue> CallContext<'env, T> {
  #[inline]
  pub fn new(
    env: &'env Env,
    callback_info: sys::napi_callback_info,
    this: sys::napi_value,
    args: &'env [sys::napi_value],
    arg_len: usize,
    actual_arg_length: usize,
  ) -> Result<Self> {
    Ok(Self {
      env,
      callback_info,
      this: T::from_raw(env.0, this)?,
      args,
      arg_len,
      actual_arg_length,
    })
  }

  #[inline]
  pub fn get<ArgType: NapiValue>(&self, index: usize) -> Result<ArgType> {
    if index + 1 > self.arg_len {
      Err(Error {
        status: Status::GenericFailure,
        reason: "Arguments index out of range".to_owned(),
      })
    } else {
      ArgType::from_raw(self.env.0, self.args[index])
    }
  }

  #[inline]
  pub fn try_get<ArgType: NapiValue>(&self, index: usize) -> Result<Either<ArgType, JsUndefined>> {
    if index + 1 > self.arg_len {
      Err(Error {
        status: Status::GenericFailure,
        reason: "Arguments index out of range".to_owned(),
      })
    } else {
      if index < self.actual_arg_length {
        ArgType::from_raw(self.env.0, self.args[index]).map(Either::A)
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
    V::from_raw(self.env.0, value)
  }
}
