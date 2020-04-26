use crate::{sys, Any, Env, Error, Result, Status, Value, ValueType};

pub struct CallContext<'env, T: ValueType = Any> {
  pub env: &'env Env,
  pub this: Value<'env, T>,
  args: [sys::napi_value; 8],
  arg_len: usize,
}

impl<'env, T: ValueType> CallContext<'env, T> {
  pub fn new(
    env: &'env Env,
    this: sys::napi_value,
    args: [sys::napi_value; 8],
    arg_len: usize,
  ) -> Result<Self> {
    Ok(Self {
      env,
      this: Value::<'env, T>::from_raw(env, this)?,
      args,
      arg_len,
    })
  }

  pub fn get<ArgType: ValueType>(&'env self, index: usize) -> Result<Value<'env, ArgType>> {
    if index + 1 > self.arg_len {
      Err(Error::new(Status::GenericFailure))
    } else {
      Value::<'env, ArgType>::from_raw(&self.env, self.args[index])
    }
  }
}
