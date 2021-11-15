use std::convert::TryInto;

use napi::{
  CallContext, ContextlessResult, Env, JsBoolean, JsNumber, JsObject, JsUndefined, JsUnknown,
  Result,
};

#[contextless_function]
fn test_create_array(env: Env) -> ContextlessResult<JsObject> {
  env.create_empty_array().map(Some)
}

#[js_function(1)]
fn test_create_array_with_length(ctx: CallContext) -> Result<JsObject> {
  let length: u32 = ctx.get::<JsNumber>(0)?.try_into()?;
  ctx.env.create_array_with_length(length as usize)
}

#[js_function(3)]
fn test_set_element(ctx: CallContext) -> Result<JsUndefined> {
  let mut arr = ctx.get::<JsObject>(0)?;
  let index = ctx.get::<JsNumber>(1)?;
  let ele = ctx.get::<JsUnknown>(2)?;
  arr.set_element(index.try_into()?, ele)?;

  ctx.env.get_undefined()
}

#[js_function(2)]
fn test_has_element(ctx: CallContext) -> Result<JsBoolean> {
  let arr = ctx.get::<JsObject>(0)?;
  let index = ctx.get::<JsNumber>(1)?;

  ctx.env.get_boolean(arr.has_element(index.try_into()?)?)
}

#[js_function(2)]
fn test_delete_element(ctx: CallContext) -> Result<JsBoolean> {
  let mut arr = ctx.get::<JsObject>(0)?;
  let index = ctx.get::<JsNumber>(1)?;

  ctx.env.get_boolean(arr.delete_element(index.try_into()?)?)
}

pub fn register_js(exports: &mut JsObject) -> Result<()> {
  exports.create_named_method("testCreateArray", test_create_array)?;
  exports.create_named_method("testCreateArrayWithLength", test_create_array_with_length)?;
  exports.create_named_method("testSetElement", test_set_element)?;
  exports.create_named_method("testHasElement", test_has_element)?;
  exports.create_named_method("testDeleteElement", test_delete_element)?;

  Ok(())
}
