use std::convert::TryInto;

use napi::{
  bindgen_prelude::{Function, Unknown},
  CallContext, JsNumber, JsObject, Property, Result,
};

struct NativeClass {
  value: i32,
}

#[js_function(1)]
fn create_test_class(ctx: CallContext) -> Result<Function<Unknown, Unknown>> {
  let add_count_method = Property::new()
    .with_utf8_name("addCount")?
    .with_method(add_count);
  let add_native_count = Property::new()
    .with_utf8_name("addNativeCount")?
    .with_method(add_native_count);
  let renew_wrapped = Property::new()
    .with_utf8_name("renewWrapped")?
    .with_method(renew_wrapped);
  ctx.env.define_class(
    "TestClass",
    test_class_constructor,
    &[add_count_method, add_native_count, renew_wrapped],
  )
}

#[js_function(1)]
fn test_class_constructor(ctx: CallContext) -> Result<()> {
  let count: i32 = ctx.get::<JsNumber>(0)?.try_into()?;
  let mut this: JsObject = ctx.this_unchecked();
  ctx
    .env
    .wrap(&mut this, NativeClass { value: count + 100 }, None)?;
  this.set_named_property("count", ctx.env.create_int32(count)?)?;
  Ok(())
}

#[js_function(1)]
fn add_count(ctx: CallContext) -> Result<()> {
  let add: i32 = ctx.get::<JsNumber>(0)?.try_into()?;
  let mut this: JsObject = ctx.this_unchecked();
  let count: i32 = this.get_named_property::<JsNumber>("count")?.try_into()?;
  this.set_named_property("count", ctx.env.create_int32(count + add)?)?;
  Ok(())
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
fn renew_wrapped(ctx: CallContext) -> Result<()> {
  let mut this: JsObject = ctx.this_unchecked();
  ctx.env.drop_wrapped::<NativeClass>(&this)?;
  ctx.env.wrap(&mut this, NativeClass { value: 42 }, None)?;
  Ok(())
}

pub fn register_js(exports: &mut JsObject) -> Result<()> {
  exports.create_named_method("createTestClass", create_test_class)?;
  Ok(())
}
