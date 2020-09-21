use std::ptr;

use crate::error::check_status;
use crate::{sys, Env, Error, JsUnknown, NapiValue, Result, Status};

pub struct CallContext<'env, T: NapiValue<'env> = JsUnknown<'env>> {
  pub env: &'env Env,
  pub this: T,
  callback_info: sys::napi_callback_info,
  args: &'env [sys::napi_value],
  arg_len: usize,
  _actual_arg_length: usize,
}

impl<'env, T: NapiValue<'env>> CallContext<'env, T> {
  pub fn new(
    env: &'env Env,
    callback_info: sys::napi_callback_info,
    this: sys::napi_value,
    args: &'env [sys::napi_value],
    arg_len: usize,
    _actual_arg_length: usize,
  ) -> Result<Self> {
    Ok(Self {
      env,
      callback_info,
      this: T::from_raw(env, this)?,
      args,
      arg_len,
      _actual_arg_length,
    })
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
