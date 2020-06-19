use crate::{Env, Result, Value, ValueType};

pub trait Task {
  type Output: Send + Sized + 'static;
  type JsValue: ValueType;

  fn compute(&mut self) -> Result<Self::Output>;

  fn resolve(&self, env: &mut Env, output: Self::Output) -> Result<Value<Self::JsValue>>;
}
