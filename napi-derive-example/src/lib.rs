#[macro_use]
extern crate napi_rs as napi;
#[macro_use]
extern crate napi_rs_derive;

use napi::{Any, CallContext, Env, Error, Number, Object, Result, Status, Value};
use std::convert::TryInto;

register_module!(test_module, init);

fn init<'env>(
  env: &'env Env,
  exports: &'env mut Value<'env, Object>,
) -> Result<Option<Value<'env, Object>>> {
  exports.set_named_property("testThrow", env.create_function("testThrow", test_throw)?)?;

  exports.set_named_property("fibonacci", env.create_function("fibonacci", fibonacci)?)?;
  Ok(None)
}

#[js_function]
fn test_throw(_ctx: CallContext) -> Result<Value<Any>> {
  Err(Error::new(Status::GenericFailure))
}

#[js_function(1)]
fn fibonacci(ctx: CallContext) -> Result<Value<Number>> {
  let n = ctx.get::<Number>(0)?.try_into()?;
  ctx.env.create_int64(fibonacci_native(n))
}

#[inline]
fn fibonacci_native(n: i64) -> i64 {
  match n {
    1 | 2 => 1,
    _ => fibonacci_native(n - 1) + fibonacci_native(n - 2),
  }
}
