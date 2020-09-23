use std::ptr;

use crate::error::check_status;
use crate::{sys, Env, Error, NapiValue, Result, Status};

pub struct CallContext<'env> {
  pub env: &'env Env,
  raw_this: sys::napi_value,
  callback_info: sys::napi_callback_info,
  args: &'env [sys::napi_value],
  arg_len: usize,
  _actual_arg_length: usize,
}

impl<'env> CallContext<'env> {
  pub fn new(
    env: &'env Env,
    callback_info: sys::napi_callback_info,
    raw_this: sys::napi_value,
    args: &'env [sys::napi_value],
    arg_len: usize,
    _actual_arg_length: usize,
  ) -> Self {
    Self {
      env,
      callback_info,
      raw_this,
      args,
      arg_len,
      _actual_arg_length,
    }
  }

  #[inline(always)]
  pub fn this<T: NapiValue<'env>>(&self) -> Result<T> {
    T::from_raw(self.env, self.raw_this)
  }

  #[inline(always)]
  pub fn this_unchecked<T: NapiValue<'env>>(&self) -> T {
    T::from_raw_unchecked(self.env, self.raw_this)
  }

  pub fn get<ArgType: NapiValue<'env>>(&self, index: usize) -> Result<ArgType> {
    if index + 1 > self.arg_len {
      Err(Error {
        status: Status::GenericFailure,
        reason: "Arguments index out of range".to_owned(),
      })
    } else {
      Ok(ArgType::from_raw_unchecked(self.env, self.args[index]))
    }
  }

  pub fn get_new_target<V>(&self) -> Result<V>
  where
    V: NapiValue<'env>,
  {
    let mut value = ptr::null_mut();
    check_status(unsafe { sys::napi_get_new_target(self.env.0, self.callback_info, &mut value) })?;
    V::from_raw(self.env, value)
  }
}
