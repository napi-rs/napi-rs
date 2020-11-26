use napi::{CallContext, JsObject, JsString, JsSymbol, Result};

#[js_function]
pub fn create_named_symbol(ctx: CallContext) -> Result<JsSymbol> {
  ctx.env.create_symbol(Some("native"))
}

#[js_function]
pub fn create_unnamed_symbol(ctx: CallContext) -> Result<JsSymbol> {
  ctx.env.create_symbol(None)
}

#[js_function(1)]
pub fn create_symbol_from_js_string(ctx: CallContext) -> Result<JsSymbol> {
  let name = ctx.get::<JsString>(0)?;
  ctx.env.create_symbol_from_js_string(name)
}

pub fn register_js(exports: &mut JsObject) -> Result<()> {
  exports.create_named_method("createNamedSymbol", create_named_symbol)?;
  exports.create_named_method("createUnnamedSymbol", create_unnamed_symbol)?;
  exports.create_named_method("createSymbolFromJsString", create_symbol_from_js_string)?;
  Ok(())
}
