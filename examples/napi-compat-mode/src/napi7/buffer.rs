use napi::*;

#[js_function(1)]
pub fn detach_arraybuffer(ctx: CallContext) -> Result<()> {
  let input = ctx.get::<JsArrayBuffer>(0)?;
  input.detach()?;
  Ok(())
}

#[js_function(1)]
pub fn is_detach_arraybuffer(ctx: CallContext) -> Result<JsBoolean> {
  let input = ctx.get::<JsArrayBuffer>(0)?;
  ctx.env.get_boolean(input.is_detached()?)
}
