use crate::{sys, Env, Error, JsUnknown, NapiValue, Result, Status};

pub struct CallContext<'env, T: NapiValue = JsUnknown> {
  pub env: &'env Env,
  pub this: T,
  args: &'env [sys::napi_value],
  arg_len: usize,
}

impl<'env, T: NapiValue> CallContext<'env, T> {
  #[inline]
  pub fn new(
    env: &'env Env,
    this: sys::napi_value,
    args: &'env [sys::napi_value],
    arg_len: usize,
  ) -> Result<Self> {
    Ok(Self {
      env,
      this: T::from_raw(env.0, this)?,
      args,
      arg_len,
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
}
