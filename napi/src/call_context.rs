use crate::{sys, Any, Env, Error, Result, Status, Value, ValueType};

pub struct CallContext<'env, T: ValueType = Any> {
  pub env: &'env Env,
  pub this: Value<T>,
  args: &'env [sys::napi_value],
  arg_len: usize,
}

impl<'env, T: ValueType> CallContext<'env, T> {
  #[inline]
  pub fn new(
    env: &'env Env,
    this: sys::napi_value,
    args: &'env [sys::napi_value],
    arg_len: usize,
  ) -> Result<Self> {
    Ok(Self {
      env,
      this: Value::<T>::from_raw(env.0, this)?,
      args,
      arg_len,
    })
  }

  #[inline]
  pub fn get<ArgType: ValueType>(&self, index: usize) -> Result<Value<ArgType>> {
    if index + 1 > self.arg_len {
      Err(Error {
        status: Status::GenericFailure,
        reason: Some("Arguments index out of range".to_owned()),
      })
    } else {
      Value::<ArgType>::from_raw(self.env.0, self.args[index])
    }
  }
}
