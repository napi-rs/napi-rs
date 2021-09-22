use napi::{CallContext, JsObject, JsString, Result};

#[js_function(1)]
fn concat_string(ctx: CallContext) -> Result<JsString> {
  let in_string = ctx.get::<JsString>(0)?;
  let out_string = format!("{} + Rust 🦀 string!", in_string.into_utf8()?.as_str()?);
  ctx.env.create_string_from_std(out_string)
}

#[js_function(1)]
fn concat_utf16_string(ctx: CallContext) -> Result<JsString> {
  let in_string = ctx.get::<JsString>(0)?;
  let out_string = format!("{} + Rust 🦀 string!", in_string.into_utf16()?.as_str()?);
  ctx.env.create_string_from_std(out_string)
}

#[js_function(1)]
fn concat_latin1_string(ctx: CallContext) -> Result<JsString> {
  let in_string = ctx.get::<JsString>(0)?;
  let out_string = format!(
    "{} + Rust 🦀 string!",
    in_string.into_latin1()?.into_latin1_string()?
  );
  ctx.env.create_string_from_std(out_string)
}

#[js_function]
fn create_latin1(ctx: CallContext) -> Result<JsString> {
  let bytes = vec![169, 191];
  ctx.env.create_string_latin1(bytes.as_slice())
}

pub fn register_js(exports: &mut JsObject) -> Result<()> {
  exports.create_named_method("concatString", concat_string)?;
  exports.create_named_method("concatUTF16String", concat_utf16_string)?;
  exports.create_named_method("concatLatin1String", concat_latin1_string)?;
  exports.create_named_method("createLatin1", create_latin1)?;
  Ok(())
}
