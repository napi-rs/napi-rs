use napi::*;

#[js_function(1)]
pub fn seal_object(ctx: CallContext) -> Result<JsUndefined> {
  let mut obj: JsObject = ctx.get(0)?;
  obj.seal()?;
  ctx.env.get_undefined()
}

#[js_function(1)]
pub fn freeze_object(ctx: CallContext) -> Result<JsUndefined> {
  let mut obj: JsObject = ctx.get(0)?;
  obj.freeze()?;
  ctx.env.get_undefined()
}
