use napi::{ContextlessResult, Env, JsBuffer, JsObject, Result};

#[contextless_function]
pub fn bench_create_buffer(env: Env) -> ContextlessResult<JsBuffer> {
  let mut output = Vec::with_capacity(1024);
  output.push(1);
  output.push(2);
  env
    .create_buffer_with_data(output)
    .map(|v| Some(v.into_raw()))
}

pub fn register_js(exports: &mut JsObject) -> Result<()> {
  exports.create_named_method("benchCreateBuffer", bench_create_buffer)?;
  Ok(())
}
