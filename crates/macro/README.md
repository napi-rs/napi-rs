# napi-derive

<a href="https://docs.rs/crate/napi-derive"><img src="https://docs.rs/napi-derive/badge.svg"></img></a>
<a href="https://crates.io/crates/napi-derive"><img src="https://img.shields.io/crates/v/napi-derive.svg"></img></a>
<a href="https://discord.gg/SpWzYHsKHs">
<img src="https://img.shields.io/discord/874290842444111882.svg?logo=discord&style=flat-square"
    alt="chat" />
</a>

Checkout more examples in [examples](../../examples) folder

```rust
#[macro_use]
extern crate napi_derive;
use napi::bindgen_prelude::*;

#[napi]
fn fibonacci(n: u32) -> u32 {
  match n {
    1 | 2 => 1,
    _ => fibonacci_native(n - 1) + fibonacci_native(n - 2),
  }
}

#[napi]
fn get_cwd<T: Fn(String) -> Result<()>>(callback: T) {
  callback(env::current_dir().unwrap().to_string_lossy().to_string()).unwrap();
}
```
