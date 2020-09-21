use crate::js_values::NapiValue;
use crate::{Env, Result};

pub trait Task<'out>: Send {
  type Output: Send + Sized;
  type JsValue: NapiValue<'out>;

  fn compute(&mut self) -> Result<Self::Output>;

  fn resolve(self, env: &'out mut Env, output: Self::Output) -> Result<Self::JsValue>;
}
