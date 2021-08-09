# napi-build

<a href="https://docs.rs/crate/napi-build"><img src="https://docs.rs/napi-build/badge.svg"></img></a>
<a href="https://crates.io/crates/napi-build"><img src="https://img.shields.io/crates/v/napi-build.svg"></img></a>
<a href="https://discord.gg/SpWzYHsKHs">
<img src="https://img.shields.io/discord/874290842444111882.svg?logo=discord&style=flat-square"
    alt="chat" />
</a>

> Build support for napi-rs

Setup `N-API` build in your `build.rs`:

```rust
extern crate napi_build;

fn main() {
    napi_build::setup();
}
```
