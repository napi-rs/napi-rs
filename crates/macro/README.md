# napi-derive

<a href="https://docs.rs/crate/napi-derive"><img src="https://docs.rs/napi-derive/badge.svg"></img></a>
<a href="https://crates.io/crates/napi-derive"><img src="https://img.shields.io/crates/v/napi-derive.svg"></img></a>
<a href="https://discord.gg/SpWzYHsKHs">
<img src="https://img.shields.io/discord/874290842444111882.svg?logo=discord&style=flat-square"
    alt="chat" />
</a>

## js_function

```rust
#[macro_use]
extern crate napi_derive;

use napi::{CallContext, Error, JsNumber, JsUnknown, Module, Result, Status};
use std::convert::TryInto;

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
```
