# napi-rs

> This project was initialized from [xray](https://github.com/atom/xray)

# Platform Support

![](https://github.com/Brooooooklyn/napi-rs/workflows/macOS/badge.svg)
![](https://github.com/Brooooooklyn/napi-rs/workflows/Linux/badge.svg)
![](https://github.com/Brooooooklyn/napi-rs/workflows/Windows/badge.svg)

## Operating Systems

| Linux | macOS | Windows x64 MSVC |
| ----- | ----- | ---------------- |
| ✓     | ✓     | ✓                |

## NodeJS

| Node10    | Node 12   | Node13    |
| --------- | --------- | --------- |
| ✓         | ✓         | ✓         |

A minimal library for building compiled Node add-ons in Rust.

This library depends on N-API and requires Node 8.9 or later. It is still pretty raw and has not been tested in a production setting.

One nice feature is that this crate allows you to build add-ons purely with the Rust toolchain and without involving `node-gyp`.

## Building

This repository is a Cargo crate. Any napi-based add-on should contain `Cargo.toml` to make it a Cargo crate.

In your `Cargo.toml` you need to set the `crate-type` to `"cdylib"` so that cargo builds a C-style shared library that can be dynamically loaded by the Node executable. You'll also need to add this crate as a dependency.

```toml
[lib]
crate-type = ["cdylib"]

[dependencies]
napi-rs = "0.1"

[build-dependencies]
napi-build = "0.1"
```

And create `build.rs` in your own project:

```rs
// build.rs
extern crate napi_build;

fn main() {
  napi_build::setup();
}
```

So far, the `napi` build script has only been tested on `macOS` `Linux` and `Windows x64 MSVC`. 

See the included [test_module](./test_module) for an example add-on.

Run `cargo build` to produce the `Dynamic lib` file. And install the `napi-rs` to help you copy `Dynamic lib` file to `.node` file in case you can `require` it in your program.

```json

{
  "package": "your pkg",
  "dependencies": {
    "napi-rs": "^0.1"
  },
  "scripts": {
    "build": "cargo build && napi",
    "build-release": "cargo build --release && napi --release"
  }
}
```

Then you can require your native binding:

```js
require('./target/debug|release/[module_name].node')
```

The `module_name` would be your `package` name in your `Cargo.toml`.

`xxx => ./target/debug|release/xxx.node`

`xxx-yyy => ./target/debug|release/xxx_yyy.node`

You can also copy `Dynamic lib` file to an appointed location:

```bash
napi [--release] .
napi [--release] ./mylib
napi [--release] ./mylib.node
```

## Testing

Because libraries that depend on this crate must be loaded into a Node executable in order to resolve symbols, all tests are written in JavaScript in the `test_module` subdirectory.

To run tests:

```sh
cd test_module
npm run build
npm test
```
