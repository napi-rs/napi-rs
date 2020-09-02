use napi::{CallContext, JsBoolean, JsObject, JsString, JsUndefined, JsUnknown, Module, Result};

#[js_function(2)]
fn test_set_property(ctx: CallContext) -> Result<JsUndefined> {
  let mut obj = ctx.get::<JsObject>(0)?;
  let key = ctx.get::<JsString>(1)?;
  obj.set_property(key, ctx.env.create_string("Rust object property")?)?;
  ctx.env.get_undefined()
}

#[js_function(2)]
fn test_set_named_property(ctx: CallContext) -> Result<JsUndefined> {
  let mut obj = ctx.get::<JsObject>(0)?;
  let property = ctx.get::<JsUnknown>(1)?;
  obj.set_named_property("RustPropertyKey", property)?;
  ctx.env.get_undefined()
}

#[js_function(1)]
fn test_get_named_property(ctx: CallContext) -> Result<JsUnknown> {
  let obj = ctx.get::<JsObject>(0)?;
  obj.get_named_property("p")
}

#[js_function(2)]
fn test_has_named_property(ctx: CallContext) -> Result<JsBoolean> {
  let obj = ctx.get::<JsObject>(0)?;
  let key = ctx.get::<JsString>(1)?;
  ctx.env.get_boolean(obj.has_named_property(key.as_str()?)?)
}

pub fn register_js(module: &mut Module) -> Result<()> {
  module.create_named_method("testSetProperty", test_set_property)?;
  module.create_named_method("testSetNamedProperty", test_set_named_property)?;
  module.create_named_method("testGetNamedProperty", test_get_named_property)?;
  module.create_named_method("testHasNamedProperty", test_has_named_property)?;
  Ok(())
}
