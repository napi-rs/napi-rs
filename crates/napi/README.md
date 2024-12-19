# napi-rs

> This project was initialized from [xray](https://github.com/atom/xray)

A framework for building compiled `Node.js` add-ons in `Rust` via Node-API. Website: https://napi.rs

<p>
  <a href="https://discord.gg/SpWzYHsKHs">
  <img src="https://img.shields.io/discord/874290842444111882.svg?logo=discord&style=flat-square"
      alt="chat" />
  </a>
  <a href="https://docs.rs/crate/napi"><img src="https://docs.rs/napi/badge.svg"></img></a>
  <a href="https://crates.io/crates/napi"><img src="https://img.shields.io/crates/v/napi.svg"></img></a>
  <a href="https://www.npmjs.com/package/@napi-rs/cli"><img src="https://img.shields.io/npm/v/@napi-rs/cli.svg"></img></a>
</p>

## Platform Support

[![Test & Release](https://github.com/napi-rs/napi-rs/actions/workflows/test-release.yaml/badge.svg)](https://github.com/napi-rs/napi-rs/actions/workflows/test-release.yaml)
[![FreeBSD](https://api.cirrus-ci.com/github/napi-rs/napi-rs.svg)](https://cirrus-ci.com/github/napi-rs/napi-rs?branch=main)
[![Address Sanitizer](https://github.com/napi-rs/napi-rs/actions/workflows/asan.yml/badge.svg)](https://github.com/napi-rs/napi-rs/actions/workflows/asan.yml)
[![Memory Leak Detect](https://github.com/napi-rs/napi-rs/actions/workflows/memory-test.yml/badge.svg)](https://github.com/napi-rs/napi-rs/actions/workflows/memory-test.yml)

## MSRV

**Rust** `1.80.0`

|                       | node12 | node14 | node16 | node18 | node20 |
| --------------------- | ------ | ------ | ------ | ------ | ------ |
| Windows x64           | ✓      | ✓      | ✓      | ✓      | ✓      |
| Windows x86           | ✓      | ✓      | ✓      | ✓      | ✓      |
| Windows arm64         | ✓      | ✓      | ✓      | ✓      | ✓      |
| macOS x64             | ✓      | ✓      | ✓      | ✓      | ✓      |
| macOS aarch64         | ✓      | ✓      | ✓      | ✓      | ✓      |
| Linux x64 gnu         | ✓      | ✓      | ✓      | ✓      | ✓      |
| Linux x64 musl        | ✓      | ✓      | ✓      | ✓      | ✓      |
| Linux aarch64 gnu     | ✓      | ✓      | ✓      | ✓      | ✓      |
| Linux aarch64 musl    | ✓      | ✓      | ✓      | ✓      | ✓      |
| Linux arm gnueabihf   | ✓      | ✓      | ✓      | ✓      | ✓      |
| Linux arm muslebihf   | ✓      | ✓      | ✓      | ✓      | ✓      |
| Linux powerpc64le gnu | ✓      | ✓      | ✓      | ✓      | ✓      |
| Linux s390x gnu       | ✓      | ✓      | ✓      | ✓      | ✓      |
| Linux riscv64 gnu     | N/A     | N/A     | ✓      | ✓      | ✓      |
| Linux aarch64 android | ✓      | ✓      | ✓      | ✓      | ✓      |
| Linux armv7 android   | ✓      | ✓      | ✓      | ✓      | ✓      |
| FreeBSD x64           | ✓      | ✓      | ✓      | ✓      | ✓      |

This library depends on Node-API and requires `Node@10.0.0` or later.

We already have some packages written by `napi-rs`: [node-rs](https://github.com/napi-rs/node-rs)

One nice feature is that this crate allows you to build add-ons purely with the `Rust/JavaScript` toolchain and without involving `node-gyp`.

## Taste

> You can start from [package-template](https://github.com/napi-rs/package-template) to play with `napi-rs`

### Define JavaScript functions

```rust
/// import the preludes
use napi::bindgen_prelude::*;
use napi_derive::napi;

/// module registration is done by the runtime, no need to explicitly do it now.
#[napi]
fn fibonacci(n: u32) -> u32 {
  match n {
    1 | 2 => 1,
    _ => fibonacci(n - 1) + fibonacci(n - 2),
  }
}

/// use `Fn`, `FnMut` or `FnOnce` traits to defined JavaScript callbacks
/// the return type of callbacks can only be `Result`.
#[napi]
fn get_cwd<T: Fn(String) -> Result<()>>(callback: T) {
  callback(env::current_dir().unwrap().to_string_lossy().to_string()).unwrap();
}

/// or, define the callback signature in where clause
#[napi]
fn test_callback<T>(callback: T)
where T: Fn(String) -> Result<()>
{}

/// async fn, require `async` feature enabled.
/// [dependencies]
/// napi = {version="2", features=["async"]}
#[napi]
async fn read_file_async(path: String) -> Result<Buffer> {
  tokio::fs::read(path)
    .map(|r| match r {
      Ok(content) => Ok(content.into()),
      Err(e) => Err(Error::new(
        Status::GenericFailure,
        format!("failed to read file, {}", e),
      )),
    })
    .await
}
```

more examples at [examples](./examples/napi)

## Building

This repository is a `Cargo` crate. Any napi-based add-on should contain `Cargo.toml` to make it a Cargo crate.

In your `Cargo.toml` you need to set the `crate-type` to `"cdylib"` so that cargo builds a C-style shared library that can be dynamically loaded by the Node executable. You'll also need to add this crate as a dependency.

```toml
[package]
name = "awesome"

[lib]
crate-type = ["cdylib"]

[dependencies]
napi = "3"
napi-derive = "3"

[build-dependencies]
napi-build = "1"
```

And create `build.rs` in your own project:

```rust
// build.rs
extern crate napi_build;

fn main() {
  napi_build::setup();
}
```

So far, the `napi` build script has only been tested on `macOS` `Linux` `Windows x64 MSVC` and `FreeBSD`.

Install the `@napi-rs/cli` to help you build your `Rust` codes and copy `Dynamic lib` file to `.node` file in case you can `require` it in your program.

```js
{
  "package": "awesome-package",
  "devDependencies": {
    "@napi-rs/cli": "^1.0.0"
  },
  "napi": {
    "name": "jarvis" // <----------- Config the name of native addon, or the napi command will use the name of `Cargo.toml` for the binary file name.
  },
  "scripts": {
    "build": "napi build --release",
    "build:debug": "napi build"
  }
}
```

Then you can require your native binding:

```js
require('./jarvis.node')
```

The `module_name` would be your `package` name in your `Cargo.toml`.

`xxx => ./xxx.node`

`xxx-yyy => ./xxx_yyy.node`

You can also copy `Dynamic lib` file to an appointed location:

```bash
napi build [--release] ./dll
napi build [--release] ./artifacts
```

There are [documents](./cli) which contains more details about the `@napi-rs/cli` usage.

## Testing

Because libraries that depend on this crate must be loaded into a Node executable in order to resolve symbols, all tests are written in JavaScript in the `test_module` subdirectory.

To run tests:

```sh
yarn build:test
yarn test
```

## Related projects

- [neon](https://www.neon-bindings.com)
- [node-bindgen](https://github.com/infinyon/node-bindgen)

## Features table

| Rust Type                | Node Type           | [NAPI Version](https://nodejs.org/api/n-api.html#n_api_node_api_version_matrix) | Minimal Node version | Enable by `napi` feature |
| ------------------------ | ------------------- | ------------------------------------------------------------------------------- | -------------------- | ------------------------ |
| u32                      | Number              | 1                                                                               | v8.0.0               |
| i32/i64                  | Number              | 1                                                                               | v8.0.0               |
| f64                      | Number              | 1                                                                               | v8.0.0               |
| bool                     | Boolean             | 1                                                                               | v8.0.0               |
| String/&'a str           | String              | 1                                                                               | v8.0.0               |
| Latin1String             | String              | 1                                                                               | v8.0.0               | latin1                   |
| UTF16String              | String              | 1                                                                               | v8.0.0               |
| Object                   | Object              | 1                                                                               | v8.0.0               |
| serde_json::Map          | Object              | 1                                                                               | v8.0.0               | serde-json               |
| serde_json::Value        | any                 | 1                                                                               | v8.0.0               | serde-json               |
| Array                    | Array<any>          | 1                                                                               | v8.0.0               |
| Vec<T>                   | Array<T>            | 1                                                                               | v8.0.0               |
| Buffer                   | Buffer              | 1                                                                               | v8.0.0               |
| External<T>              | External<T>         | 1                                                                               | v8.0.0               |                          |
| Null                     | null                | 1                                                                               | v8.0.0               |
| Undefined/()             | undefined           | 1                                                                               | v8.0.0               |
| Result<()>               | Error               | 1                                                                               | v8.0.0               |
| T: Fn(...) -> Result<T>  | Function            | 1                                                                               | v8.0.0               |
| Async/Future             | Promise<T>          | 4                                                                               | v10.6.0              | async                    |
| AsyncTask                | Promise<T>          | 1                                                                               | v8.5.0               |
| JsGlobal                 | global              | 1                                                                               | v8.0.0               |
| JsSymbol                 | Symbol              | 1                                                                               | v8.0.0               |
| Int8Array/Uint8Array ... | TypedArray          | 1                                                                               | v8.0.0               |
| JsFunction               | threadsafe function | 4                                                                               | v10.6.0              | napi4                    |
| BigInt                   | BigInt              | 6                                                                               | v10.7.0              | napi6                    |
