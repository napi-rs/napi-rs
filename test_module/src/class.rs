use std::convert::TryInto;

use napi::{CallContext, JsFunction, JsNumber, JsObject, JsUndefined, Module, Property, Result};

#[js_function(1)]
fn create_test_class(ctx: CallContext) -> Result<JsFunction> {
  let add_count_method = Property::new(&ctx.env, "addCount")?.with_method(add_count);
  let properties = vec![add_count_method];
  ctx
    .env
    .define_class("TestClass", test_class_constructor, properties.as_slice())
}

#[js_function(1)]
fn test_class_constructor(ctx: CallContext) -> Result<JsUndefined> {
  let count = ctx.get::<JsNumber>(0)?;
  let mut this: JsObject = ctx.this_unchecked();
  this.set_named_property("count", ctx.env.create_int32(count.try_into()?)?)?;
  ctx.env.get_undefined()
}

#[js_function(1)]
fn add_count(ctx: CallContext) -> Result<JsUndefined> {
  let add: i32 = ctx.get::<JsNumber>(0)?.try_into()?;
  let mut this: JsObject = ctx.this_unchecked();
  let count: i32 = this.get_named_property::<JsNumber>("count")?.try_into()?;
  this.set_named_property("count", ctx.env.create_int32(count + add)?)?;
  ctx.env.get_undefined()
}

pub fn register_js(module: &mut Module) -> Result<()> {
  module.create_named_method("createTestClass", create_test_class)?;
  Ok(())
}
