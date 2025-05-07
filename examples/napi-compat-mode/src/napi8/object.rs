use napi::*;

#[js_function(1)]
pub fn seal_object(ctx: CallContext) -> Result<()> {
  let mut obj: JsObject = ctx.get(0)?;
  obj.seal()?;
  Ok(())
}

#[js_function(1)]
pub fn freeze_object(ctx: CallContext) -> Result<()> {
  let mut obj: JsObject = ctx.get(0)?;
  obj.freeze()?;
  Ok(())
}
