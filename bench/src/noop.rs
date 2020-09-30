use napi::{ContextlessResult, Env, JsUndefined};

#[contextless_function]
pub fn noop(_env: Env) -> ContextlessResult<JsUndefined> {
  Ok(None)
}
