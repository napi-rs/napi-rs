use napi::{CallContext, JsString, Module, Result};

#[js_function(1)]
fn concat_string(ctx: CallContext) -> Result<JsString> {
  let in_string = ctx.get::<JsString>(0)?;
  let out_string = format!("{} + Rust 🦀 string!", in_string.as_str()?);
  ctx.env.create_string_from_std(out_string)
}

#[js_function(1)]
fn concat_latin1_string(ctx: CallContext) -> Result<JsString> {
  let in_string = ctx.get::<JsString>(0)?;
  let out_string = format!("{} + Rust 🦀 string!", in_string.as_latin1_string()?);
  ctx.env.create_string_from_std(out_string)
}

#[js_function]
fn create_latin1(ctx: CallContext) -> Result<JsString> {
  let bytes = vec![169, 191];
  ctx.env.create_string_latin1(bytes.as_slice())
}

pub fn register_js(module: &mut Module) -> Result<()> {
  module.create_named_method("concatString", concat_string)?;
  module.create_named_method("concatLatin1String", concat_latin1_string)?;
  module.create_named_method("createLatin1", create_latin1)?;
  Ok(())
}
