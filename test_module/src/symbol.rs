use napi::{CallContext, JsString, JsSymbol, Result};

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
