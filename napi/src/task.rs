use crate::js_values::NapiValue;
use crate::{Env, Result};

pub trait Task<'out>: Send {
  type Output: Send + Sized + 'out;
  type JsValue: NapiValue;

  fn compute(&mut self) -> Result<Self::Output>;

  fn resolve(self, env: &mut Env, output: Self::Output) -> Result<Self::JsValue>;
}
