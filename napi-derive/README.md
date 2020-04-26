# napi-derive

## js_function

```rust
#[macro_use]
extern crate napi_rs_derive;

use napi_rs::{Result, Value, CallContext, Number};
use std::convert::TryInto;

#[js_function]
fn fibonacci<'env>(ctx: CallContext<'env>) -> Result<Value<'env, Number>> {
  let n = ctx.get::<Number>(0)?.try_into()?;
  ctx.env.create_int64(fibonacci_native(n))
}

#[inline]
fn fibonacci_native(n: i64) -> i64 {
  match n {
    1 | 2 => 1,
    _ => fibonacci_native(n - 1) + fibonacci_native(n - 2)
  }
}
```
