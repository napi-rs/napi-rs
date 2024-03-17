use crate::{
  bindgen_runtime::{ToNapiValue, TypeName},
  Env, Error, Result,
};

pub trait Task: Send + Sized {
  type Output: Send + Sized + 'static;
  type JsValue: ToNapiValue + TypeName;

  /// Compute logic in libuv thread
  fn compute(&mut self) -> Result<Self::Output>;

  /// Into this method if `compute` return `Ok`
  fn resolve(&mut self, env: Env, output: Self::Output) -> Result<Self::JsValue>;

  #[allow(unused_variables)]
  /// Into this method if `compute` return `Err`
  fn reject(&mut self, env: Env, err: Error) -> Result<Self::JsValue> {
    Err(err)
  }

  #[allow(unused_variables)]
  /// after resolve or reject
  fn finally(&mut self, env: Env) -> Result<()> {
    Ok(())
  }
}
