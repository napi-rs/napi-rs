use std::convert::TryInto;

use napi::{CallContext, JsFunction, JsNumber, JsObject, JsUndefined, Property, Result};

struct NativeClass {
  value: i32,
}

#[js_function(1)]
fn create_test_class(ctx: CallContext) -> Result<JsFunction> {
  let add_count_method = Property::new("addCount")?.with_method(add_count);
  let add_native_count = Property::new("addNativeCount")?.with_method(add_native_count);
  let renew_wrapped = Property::new("renewWrapped")?.with_method(renew_wrapped);
  ctx.env.define_class(
    "TestClass",
    test_class_constructor,
    &[add_count_method, add_native_count, renew_wrapped],
  )
}

#[js_function(1)]
fn test_class_constructor(ctx: CallContext) -> Result<JsUndefined> {
  let count: i32 = ctx.get::<JsNumber>(0)?.try_into()?;
  let mut this: JsObject = ctx.this_unchecked();
  ctx
    .env
    .wrap(&mut this, NativeClass { value: count + 100 })?;
  this.set_named_property("count", ctx.env.create_int32(count)?)?;
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

#[js_function(1)]
fn add_native_count(ctx: CallContext) -> Result<JsNumber> {
  let add: i32 = ctx.get::<JsNumber>(0)?.try_into()?;
  let this: JsObject = ctx.this_unchecked();
  let native_class: &mut NativeClass = ctx.env.unwrap(&this)?;
  native_class.value += add;
  ctx.env.create_int32(native_class.value)
}

#[js_function]
fn renew_wrapped(ctx: CallContext) -> Result<JsUndefined> {
  let mut this: JsObject = ctx.this_unchecked();
  ctx.env.drop_wrapped::<NativeClass>(&mut this)?;
  ctx.env.wrap(&mut this, NativeClass { value: 42 })?;
  ctx.env.get_undefined()
}

#[js_function(1)]
fn new_test_class(ctx: CallContext) -> Result<JsObject> {
  let add_count_method = Property::new("addCount")?.with_method(add_count);
  let add_native_count = Property::new("addNativeCount")?.with_method(add_native_count);
  let properties = vec![add_count_method, add_native_count];
  let test_class =
    ctx
      .env
      .define_class("TestClass", test_class_constructor, properties.as_slice())?;

  test_class.new_instance(&[ctx.env.create_int32(42)?])
}

pub fn register_js(exports: &mut JsObject) -> Result<()> {
  exports.create_named_method("createTestClass", create_test_class)?;
  exports.create_named_method("newTestClass", new_test_class)?;
  Ok(())
}
