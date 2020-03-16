# napi-build
> Build support for napi-rs

Setup `N-API` build in your `build.rs`:

```rust
extern crate napi_build;

fn main() {
    napi_build::setup();
}
```
