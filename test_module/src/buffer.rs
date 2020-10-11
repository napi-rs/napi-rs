use std::str;

use napi::{CallContext, Error, JsBuffer, JsNumber, JsString, Module, Result, Status};

#[js_function(1)]
pub fn get_buffer_length(ctx: CallContext) -> Result<JsNumber> {
  let buffer = ctx.get::<JsBuffer>(0)?.into_value()?;
  ctx.env.create_uint32((&buffer).len() as u32)
}

#[js_function(1)]
pub fn buffer_to_string(ctx: CallContext) -> Result<JsString> {
  let buffer = ctx.get::<JsBuffer>(0)?.into_value()?;
  ctx.env.create_string(
    str::from_utf8(&buffer).map_err(|e| Error::new(Status::StringExpected, format!("{}", e)))?,
  )
}

#[js_function(1)]
pub fn copy_buffer(ctx: CallContext) -> Result<JsBuffer> {
  let buffer = ctx.get::<JsBuffer>(0)?.into_value()?;
  ctx.env.create_buffer_copy(buffer).map(|b| b.into_raw())
}

pub fn register_js(module: &mut Module) -> Result<()> {
  module.create_named_method("getBufferLength", get_buffer_length)?;
  module.create_named_method("bufferToString", buffer_to_string)?;
  module.create_named_method("copyBuffer", copy_buffer)?;
  Ok(())
}
