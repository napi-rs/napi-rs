use crate::{js_values::NapiValue, Env, Error, Result};

pub trait Task: Send + Sized {
  type Output: Send + Sized + 'static;
  type JsValue: NapiValue;

  /// Compute logic in libuv thread
  fn compute(&mut self) -> Result<Self::Output>;

  /// Into this method if `compute` return `Ok`
  fn resolve(self, env: Env, output: Self::Output) -> Result<Self::JsValue>;

  /// Into this method if `compute` return `Err`
  fn reject(self, _env: Env, err: Error) -> Result<Self::JsValue> {
    Err(err)
  }
}
