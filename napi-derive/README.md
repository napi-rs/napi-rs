# napi-derive

## js_function

```rust
#[macro_use]
extern crate napi;
#[macro_use]
extern crate napi_derive;

use napi::{CallContext, Error, JsNumber, JsUnknown, Module, Result, Status};
use std::convert::TryInto;

register_module!(napi_derive_example, init);

fn init(module: &mut Module) -> Result<()> {
  module.create_named_method("testThrow", test_throw)?;

  module.create_named_method("fibonacci", fibonacci)?;
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
```
