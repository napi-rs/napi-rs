use crate::{sys, Any, Env, Error, Result, Status, Value, ValueType};

pub struct CallContext<T: ValueType = Any> {
  pub env: Env,
  pub this: Value<T>,
  args: [sys::napi_value; 8],
  arg_len: usize,
}

impl<T: ValueType> CallContext<T> {
  pub fn new(
    env: Env,
    this: sys::napi_value,
    args: [sys::napi_value; 8],
    arg_len: usize,
  ) -> Result<Self> {
    Ok(Self {
      env,
      this: Value::<T>::from_raw(env.0, this)?,
      args,
      arg_len,
    })
  }

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
