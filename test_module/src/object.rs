use std::convert::TryInto;

use napi::{
  CallContext, JsBoolean, JsNumber, JsObject, JsString, JsUndefined, JsUnknown, Property, Result,
};

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
  ctx
    .env
    .get_boolean(obj.has_named_property(key.into_utf8()?.as_str()?)?)
}

#[js_function(2)]
fn test_has_own_property(ctx: CallContext) -> Result<JsBoolean> {
  let obj = ctx.get::<JsObject>(0)?;
  let key = ctx.get::<JsString>(1)?;
  ctx
    .env
    .get_boolean(obj.has_own_property(key.into_utf8()?.as_str()?)?)
}

#[js_function(2)]
fn test_has_own_property_js(ctx: CallContext) -> Result<JsBoolean> {
  let obj = ctx.get::<JsObject>(0)?;
  let key = ctx.get::<JsUnknown>(1)?;
  ctx.env.get_boolean(obj.has_own_property_js(key)?)
}

#[js_function(2)]
fn test_has_property(ctx: CallContext) -> Result<JsBoolean> {
  let obj = ctx.get::<JsObject>(0)?;
  let key = ctx.get::<JsString>(1)?;
  ctx
    .env
    .get_boolean(obj.has_property(key.into_utf8()?.as_str()?)?)
}

#[js_function(2)]
fn test_has_property_js(ctx: CallContext) -> Result<JsBoolean> {
  let obj = ctx.get::<JsObject>(0)?;
  let key = ctx.get::<JsUnknown>(1)?;
  ctx.env.get_boolean(obj.has_property_js(key)?)
}

#[js_function(2)]
fn test_delete_property(ctx: CallContext) -> Result<JsBoolean> {
  let mut obj = ctx.get::<JsObject>(0)?;
  let key = ctx.get::<JsUnknown>(1)?;
  ctx.env.get_boolean(obj.delete_property(key)?)
}

#[js_function(2)]
fn test_delete_named_property(ctx: CallContext) -> Result<JsBoolean> {
  let mut obj = ctx.get::<JsObject>(0)?;
  let key = ctx.get::<JsString>(1)?;
  ctx
    .env
    .get_boolean(obj.delete_named_property(key.into_utf8()?.as_str()?)?)
}

#[js_function(2)]
fn test_get_property(ctx: CallContext) -> Result<JsUnknown> {
  let obj = ctx.get::<JsObject>(0)?;
  let key = ctx.get::<JsUnknown>(1)?;
  obj.get_property(&key)
}

#[js_function(1)]
fn test_get_property_names(ctx: CallContext) -> Result<JsObject> {
  let obj = ctx.get::<JsObject>(0)?;
  obj.get_property_names()
}

#[js_function(1)]
fn test_get_prototype(ctx: CallContext) -> Result<JsUnknown> {
  let obj = ctx.get::<JsObject>(0)?;
  obj.get_prototype()
}

#[js_function(3)]
fn test_set_element(ctx: CallContext) -> Result<JsUndefined> {
  let mut obj = ctx.get::<JsObject>(0)?;
  let index = ctx.get::<JsNumber>(1)?;
  let js_value = ctx.get::<JsUnknown>(2)?;
  obj.set_element(index.try_into()?, js_value)?;
  ctx.env.get_undefined()
}

#[js_function(2)]
fn test_has_element(ctx: CallContext) -> Result<JsBoolean> {
  let obj = ctx.get::<JsObject>(0)?;
  let index = ctx.get::<JsNumber>(1)?;
  ctx.env.get_boolean(obj.has_element(index.try_into()?)?)
}

#[js_function(2)]
fn test_get_element(ctx: CallContext) -> Result<JsUnknown> {
  let obj = ctx.get::<JsObject>(0)?;
  let index = ctx.get::<JsNumber>(1)?;
  obj.get_element(index.try_into()?)
}

#[js_function(2)]
fn test_delete_element(ctx: CallContext) -> Result<JsBoolean> {
  let mut obj: JsObject = ctx.get(0)?;
  let index = ctx.get::<JsNumber>(1)?;
  ctx.env.get_boolean(obj.delete_element(index.try_into()?)?)
}

#[js_function(1)]
fn test_define_properties(ctx: CallContext) -> Result<JsUndefined> {
  let mut obj = ctx.get::<JsObject>(0)?;
  let add_method = Property::new("add")?.with_method(add);
  let readonly_property = Property::new("ro")?.with_getter(readonly_getter);
  let properties = vec![add_method, readonly_property];
  obj.define_properties(&properties)?;
  obj.set_named_property("count", ctx.env.create_int32(0)?)?;
  ctx.env.get_undefined()
}

#[js_function(1)]
fn add(ctx: CallContext) -> Result<JsUndefined> {
  let mut this: JsObject = ctx.this_unchecked();
  let count: i32 = this.get_named_property::<JsNumber>("count")?.try_into()?;
  let value_to_add: i32 = ctx.get::<JsNumber>(0)?.try_into()?;
  this.set_named_property("count", ctx.env.create_int32(count + value_to_add)?)?;
  ctx.env.get_undefined()
}

#[js_function]
fn readonly_getter(ctx: CallContext) -> Result<JsString> {
  ctx.env.create_string("readonly")
}

#[js_function(1)]
fn test_is_promise(ctx: CallContext) -> Result<JsBoolean> {
  let obj = ctx.get::<JsObject>(0)?;
  ctx.env.get_boolean(obj.is_promise()?)
}

pub fn register_js(exports: &mut JsObject) -> Result<()> {
  exports.create_named_method("testSetProperty", test_set_property)?;
  exports.create_named_method("testGetProperty", test_get_property)?;

  exports.create_named_method("testSetNamedProperty", test_set_named_property)?;
  exports.create_named_method("testGetNamedProperty", test_get_named_property)?;
  exports.create_named_method("testHasNamedProperty", test_has_named_property)?;

  exports.create_named_method("testHasOwnProperty", test_has_own_property)?;
  exports.create_named_method("testHasOwnPropertyJs", test_has_own_property_js)?;
  exports.create_named_method("testHasProperty", test_has_property)?;
  exports.create_named_method("testHasPropertyJs", test_has_property_js)?;
  exports.create_named_method("testDeleteProperty", test_delete_property)?;
  exports.create_named_method("testDeleteNamedProperty", test_delete_named_property)?;
  exports.create_named_method("testGetPropertyNames", test_get_property_names)?;
  exports.create_named_method("testGetPrototype", test_get_prototype)?;
  exports.create_named_method("testSetElement", test_set_element)?;
  exports.create_named_method("testHasElement", test_has_element)?;
  exports.create_named_method("testGetElement", test_get_element)?;
  exports.create_named_method("testDeleteElement", test_delete_element)?;
  exports.create_named_method("testDefineProperties", test_define_properties)?;

  exports.create_named_method("testIsPromise", test_is_promise)?;
  Ok(())
}
