use napi::{CallContext, JsObject, JsSymbol, Result};

#[js_function]
pub fn create_named_symbol(ctx: CallContext) -> Result<JsSymbol> {
  ctx.env.create_symbol(Some("native"))
}

#[js_function]
pub fn create_unnamed_symbol(ctx: CallContext) -> Result<JsSymbol> {
  ctx.env.create_symbol(None)
}

pub fn register_js(exports: &mut JsObject) -> Result<()> {
  exports.create_named_method("createNamedSymbol", create_named_symbol)?;
  exports.create_named_method("createUnnamedSymbol", create_unnamed_symbol)?;
  Ok(())
}
