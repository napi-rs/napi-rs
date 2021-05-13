use napi::{CallContext, JsObject, JsString, JsUndefined, JsUnknown, Result};
use serde_json::from_str;

pub fn register_js(exports: &mut JsObject) -> Result<()> {
  exports.create_named_method("getArrayFromJson", get_array_from_json)?;
  exports.create_named_method("getArrayFromJsArray", get_array_from_js_array)?;
  exports.create_named_method("getArrayWithForLoop", get_array_with_for_loop)?;
  Ok(())
}

#[js_function(1)]
fn get_array_from_json(ctx: CallContext) -> Result<JsUndefined> {
  let input = ctx.get::<JsString>(0)?.into_utf8()?;
  let _: Vec<u32> = from_str(input.as_str()?)?;
  ctx.env.get_undefined()
}

#[js_function(1)]
fn get_array_from_js_array(ctx: CallContext) -> Result<JsUndefined> {
  let input = ctx.get::<JsObject>(0)?;
  let _: Vec<u32> = ctx.env.from_js_value(input)?;
  ctx.env.get_undefined()
}

#[js_function(1)]
fn get_array_with_for_loop(ctx: CallContext) -> Result<JsUndefined> {
  let input = ctx.get::<JsObject>(0)?;
  let array_length = input.get_array_length_unchecked()? as usize;
  let mut result: Vec<JsUnknown> = Vec::with_capacity(array_length);
  for i in 0..array_length {
    result.insert(i, input.get_element::<JsUnknown>(i as u32)?);
  }
  ctx.env.get_undefined()
}
