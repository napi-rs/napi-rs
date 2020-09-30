use crate::js_values::NapiValue;
use crate::{Env, Result};

pub trait Task: Send {
  type Output: Send + Sized + 'static;
  type JsValue: NapiValue;

  fn compute(&mut self) -> Result<Self::Output>;

  fn resolve(self, env: Env, output: Self::Output) -> Result<Self::JsValue>;
}
