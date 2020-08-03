use napi::{CallContext, JsString, Result};

#[js_function(1)]
pub fn concat_string(ctx: CallContext) -> Result<JsString> {
  let in_string = ctx.get::<JsString>(0)?;
  let out_string = format!("{} + Rust 🦀 string!", in_string.as_str()?);
  ctx.env.create_string_from_std(out_string)
}
