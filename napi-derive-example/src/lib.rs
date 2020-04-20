#[macro_use]
extern crate napi_rs as napi;
#[macro_use]
extern crate napi_derive;

use napi::{Any, Env, Error, Object, Result, Status, Value, CallContext};

register_module!(test_module, init);

fn init<'env>(
  env: &'env Env,
  exports: &'env mut Value<'env, Object>,
) -> Result<Option<Value<'env, Object>>> {
  exports.set_named_property(
    "testThrow",
    env.create_function("testThrow", test_throw)?,
  )?;
  Ok(None)
}

#[js_function]
fn test_throw<'a>(
  ctx: CallContext,
) -> Result<Value<'a, Any>> {
  Err(Error::new(Status::GenericFailure))
}
