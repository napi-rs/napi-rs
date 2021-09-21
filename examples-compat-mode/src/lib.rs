#[macro_use]
extern crate napi_derive;

use napi::{bindgen_prelude::*, CallContext, Error, JsNumber, JsObject, JsUnknown, Result, Status};
use std::convert::TryInto;

/// new napi macro is still available in compat-mode
#[napi]
fn add(a: u32, b: u32) -> u32 {
  a + b
}

#[module_exports]
fn init(mut exports: JsObject) -> Result<()> {
  exports.create_named_method("testThrow", test_throw)?;

  exports.create_named_method("fibonacci", fibonacci)?;
  Ok(())
}

#[js_function]
fn test_throw(_ctx: CallContext) -> Result<JsUnknown> {
  Err(Error::from_status(Status::GenericFailure))
}

#[js_function(1)]
fn fibonacci(ctx: CallContext) -> Result<JsNumber> {
  let n = ctx.get::<JsNumber>(0)?.try_into()?;
  ctx.env.create_int64(fibonacci_native(n))
}

#[inline]
fn fibonacci_native(n: i64) -> i64 {
  match n {
    1 | 2 => 1,
    _ => fibonacci_native(n - 1) + fibonacci_native(n - 2),
  }
}
