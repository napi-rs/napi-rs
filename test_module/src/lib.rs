#[macro_use]
extern crate napi_rs as napi;
#[macro_use]
extern crate napi_rs_derive;

use napi::{
  Any, Boolean, CallContext, Env, Error, JsString, Number, Object, Result, Status, Task, Value,
};
use std::convert::TryInto;

register_module!(test_module, init);

fn init(env: &Env, exports: &mut Value<Object>) -> Result<()> {
  exports.set_named_property("testThrow", env.create_function("testThrow", test_throw)?)?;
  exports.set_named_property(
    "testThrowWithReason",
    env.create_function("testThrowWithReason", test_throw_with_reason)?,
  )?;
  exports.set_named_property(
    "testSpawnThread",
    env.create_function("testSpawnThread", test_spawn_thread)?,
  )?;
  exports.set_named_property(
    "testObjectIsDate",
    env.create_function("testObjectIsDate", test_object_is_date)?,
  )?;

  exports.set_named_property(
    "createExternal",
    env.create_function("createExternal", create_external)?,
  )?;

  exports.set_named_property(
    "getExternalCount",
    env.create_function("getExternalCount", get_external_count)?,
  )?;
  Ok(())
}

struct ComputeFib {
  n: u32,
}

impl ComputeFib {
  pub fn new(n: u32) -> ComputeFib {
    ComputeFib { n }
  }
}

impl Task for ComputeFib {
  type Output = u32;
  type JsValue = Number;

  fn compute(&self) -> Result<Self::Output> {
    Ok(fibonacci_native(self.n))
  }

  fn resolve(&self, env: &mut Env, output: Self::Output) -> Result<Value<Self::JsValue>> {
    env.create_uint32(output)
  }
}

#[inline]
fn fibonacci_native(n: u32) -> u32 {
  match n {
    1 | 2 => 1,
    _ => fibonacci_native(n - 1) + fibonacci_native(n - 2),
  }
}

#[js_function(1)]
fn test_spawn_thread(ctx: CallContext) -> Result<Value<Object>> {
  let n = ctx.get::<Number>(0)?;
  let task = ComputeFib::new(n.try_into()?);
  ctx.env.spawn(task)
}

#[js_function]
fn test_throw(_ctx: CallContext) -> Result<Value<Any>> {
  Err(Error::from_status(Status::GenericFailure))
}

#[js_function(1)]
fn test_throw_with_reason(ctx: CallContext) -> Result<Value<Any>> {
  let reason = ctx.get::<JsString>(0)?;
  Err(Error {
    status: Status::GenericFailure,
    reason: Some(reason.as_str()?.to_owned()),
  })
}

#[js_function(1)]
fn test_object_is_date(ctx: CallContext) -> Result<Value<Boolean>> {
  let obj: Value<Object> = ctx.get::<Object>(0)?;
  Ok(Env::get_boolean(ctx.env, obj.is_date()?)?)
}

struct NativeObject {
  count: i32,
}

#[js_function(1)]
fn create_external(ctx: CallContext) -> Result<Value<Object>> {
  let count = ctx.get::<Number>(0)?.try_into()?;
  let native = NativeObject { count };
  ctx.env.create_external(native)
}

#[js_function(1)]
fn get_external_count(ctx: CallContext) -> Result<Value<Number>> {
  let attached_obj = ctx.get::<Object>(0)?;
  let native_object = ctx.env.get_value_external::<NativeObject>(&attached_obj)?;
  ctx.env.create_int32(native_object.count)
}
