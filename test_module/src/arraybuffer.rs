use std::ffi::CStr;
use std::str;

use napi::{CallContext, JsArrayBuffer, JsNumber, JsString, Module, Result};

#[js_function(1)]
pub fn get_arraybuffer_length(ctx: CallContext) -> Result<JsNumber> {
  let buffer = ctx.get::<JsArrayBuffer>(0)?.into_value()?;
  ctx.env.create_uint32((&buffer).len() as u32)
}

#[js_function(1)]
pub fn arraybuffer_to_string(ctx: CallContext) -> Result<JsString> {
  let buffer = ctx.get::<JsArrayBuffer>(0)?.into_value()?;
  ctx
    .env
    .create_string(str_from_null_terminated_utf8_safe(&buffer))
}

fn str_from_null_terminated_utf8_safe(s: &[u8]) -> &str {
  if s.iter().any(|&x| x == 0) {
    unsafe { str_from_null_terminated_utf8(s) }
  } else {
    str::from_utf8(s).unwrap()
  }
}

// unsafe: s must contain a null byte
unsafe fn str_from_null_terminated_utf8(s: &[u8]) -> &str {
  CStr::from_ptr(s.as_ptr() as *const _).to_str().unwrap()
}

pub fn register_js(module: &mut Module) -> Result<()> {
  module.create_named_method("getArraybufferLength", get_arraybuffer_length)?;
  module.create_named_method("arraybufferToString", arraybuffer_to_string)?;
  Ok(())
}
