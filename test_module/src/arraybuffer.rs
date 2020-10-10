use std::str;

use napi::{CallContext, JsArrayBuffer, JsNumber, Module, Result};

#[js_function(1)]
pub fn get_arraybuffer_length(ctx: CallContext) -> Result<JsNumber> {
  let buffer = ctx.get::<JsArrayBuffer>(0)?.into_value()?;
  ctx.env.create_uint32((&buffer).len() as u32)
}

pub fn register_js(module: &mut Module) -> Result<()> {
  module.create_named_method("getArraybufferLength", get_arraybuffer_length)?;
  Ok(())
}
