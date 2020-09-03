use napi::{CallContext, JsString, Module, Result};

#[js_function(1)]
pub fn concat_string(ctx: CallContext) -> Result<JsString> {
  let in_string = ctx.get::<JsString>(0)?;
  let out_string = format!("{} + Rust 🦀 string!", in_string.as_str()?);
  ctx.env.create_string_from_std(out_string)
}

pub fn register_js(module: &mut Module) -> Result<()> {
  module.create_named_method("concatString", concat_string)?;
  Ok(())
}
