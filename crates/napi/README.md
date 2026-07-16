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

## Sponsors

![](https://napi.rs/sponsors.svg)

## Platform Support

[![Test & Release](https://github.com/napi-rs/napi-rs/actions/workflows/test-release.yaml/badge.svg)](https://github.com/napi-rs/napi-rs/actions/workflows/test-release.yaml)
[![Address Sanitizer](https://github.com/napi-rs/napi-rs/actions/workflows/asan.yml/badge.svg)](https://github.com/napi-rs/napi-rs/actions/workflows/asan.yml)
[![Memory Leak Detect](https://github.com/napi-rs/napi-rs/actions/workflows/memory-test.yml/badge.svg)](https://github.com/napi-rs/napi-rs/actions/workflows/memory-test.yml)

## MSRV

**Rust** `1.88.0`

|                       | node12 | node14 | node16 | node18 | node20 | node22 |
| --------------------- | ------ | ------ | ------ | ------ | ------ | ------ |
| Windows x64           | ✓      | ✓      | ✓      | ✓      | ✓      | ✓      |
| Windows x86           | ✓      | ✓      | ✓      | ✓      | ✓      | ✓      |
| Windows arm64         | ✓      | ✓      | ✓      | ✓      | ✓      | ✓      |
| macOS x64             | ✓      | ✓      | ✓      | ✓      | ✓      | ✓      |
| macOS aarch64         | ✓      | ✓      | ✓      | ✓      | ✓      | ✓      |
| Linux x64 gnu         | ✓      | ✓      | ✓      | ✓      | ✓      | ✓      |
| Linux x64 musl        | ✓      | ✓      | ✓      | ✓      | ✓      | ✓      |
| Linux aarch64 gnu     | ✓      | ✓      | ✓      | ✓      | ✓      | ✓      |
| Linux aarch64 musl    | ✓      | ✓      | ✓      | ✓      | ✓      | ✓      |
| Linux arm gnueabihf   | ✓      | ✓      | ✓      | ✓      | ✓      | ✓      |
| Linux arm muslebihf   | ✓      | ✓      | ✓      | ✓      | ✓      | ✓      |
| Linux powerpc64le gnu | ✓      | ✓      | ✓      | ✓      | ✓      | ✓      |
| Linux s390x gnu       | ✓      | ✓      | ✓      | ✓      | ✓      | ✓      |
| Linux loong64 gnu     | N/A    | N/A    | N/A    | ✓      | ✓      | ✓      |
| Linux riscv64 gnu     | N/A    | N/A    | ✓      | ✓      | ✓      | ✓      |
| Linux aarch64 android | ✓      | ✓      | ✓      | ✓      | ✓      | ✓      |
| Linux armv7 android   | ✓      | ✓      | ✓      | ✓      | ✓      | ✓      |
| FreeBSD x64           | ✓      | ✓      | ✓      | ✓      | ✓      | ✓      |

This library depends on Node-API and requires `Node@10.0.0` or later.

We already have some packages written by `napi-rs`: [node-rs](https://github.com/napi-rs/node-rs)

One nice feature is that this crate allows you to build add-ons purely with the `Rust/JavaScript` toolchain and without involving `node-gyp`.

## Taste

> You can start from [package-template](https://github.com/napi-rs/package-template) to play with `napi-rs`

### Define JavaScript functions

```rust
use napi::bindgen_prelude::*;
use napi_derive::napi;

/// module registration is done by the runtime, no need to explicitly do it now.
#[napi]
pub fn fibonacci(n: u32) -> u32 {
  match n {
    1 | 2 => 1,
    _ => fibonacci(n - 1) + fibonacci(n - 2),
  }
}

/// use `Fn`, `FnMut` or `FnOnce` traits to defined JavaScript callbacks
/// the return type of callbacks can only be `Result`.
#[napi]
pub fn get_cwd<T: Fn(String) -> Result<()>>(callback: T) {
  callback(
    std::env::current_dir()
      .unwrap()
      .to_string_lossy()
      .to_string(),
  )
  .unwrap();
}

/// or, define the callback signature in where clause
#[napi]
pub fn test_callback<T>(callback: T) -> Result<()>
where
  T: Fn(String) -> Result<()>,
{
  callback(std::env::current_dir()?.to_string_lossy().to_string())
}

/// async fn, require `async` feature enabled.
/// [dependencies]
/// napi = {version="2", features=["async"]}
#[napi]
pub async fn read_file_async(path: String) -> Result<Buffer> {
  Ok(tokio::fs::read(path).await?.into())
}
```

### Custom async runtimes

Enable `async-runtime` to route generated async exports through an addon-provided scheduler without
requiring Tokio:

```toml
[dependencies]
napi = { version = "4", default-features = false, features = ["napi4", "async-runtime"] }
```

Implement the unsafe `AsyncRuntime` contract and register one dormant backend from module
initialization:

```rust
use napi::bindgen_prelude::{register_async_runtime, AsyncRuntime};
use napi_derive::module_init;

#[module_init]
fn init() {
  register_async_runtime(MyRuntime::new_dormant());
}
```

Create threads and active scheduler resources in `AsyncRuntime::start`, not in the constructor, and
fully quiesce them in `AsyncRuntime::shutdown`. The backend is reused across worker and renderer
reloads, and its `Drop` implementation is not guaranteed to run. The trait documentation defines
the task ownership, cancellation, guard, panic, and native-image unload-safety requirements.
Submission hooks return `AsyncRuntimeRejection::new(work, error)` when they decline ownership, and
the fallible `block_on` / `enter` hooks return backend-specific errors directly.

napi automatically starts the backend for the first live Node environment and shuts it down after
the last environment exits. Embedders and tests can use `try_start_async_runtime` and
`try_shutdown_async_runtime` for explicit lifecycle control; an explicit shutdown remains in
effect until an explicit start. See the
[complete custom-runtime example](https://github.com/napi-rs/napi-rs/tree/main/examples/custom-async-runtime)
for a scheduler implementation, blocking work, cancellation, reloads, and feature-unified builds.

For the coordinated v4 release, upgrade `napi` before `napi-derive`. Derive v3 remains compatible
with runtime v4 during migration, but does not gain v4 borrow and construction guarantees.
Specifically, napi-derive 3.5.9 synchronous `#[napi(async_runtime)]` guards use the established
Tokio compatibility entry point when `async-runtime` and `tokio_rt` are both enabled, even if a
custom backend was selected; legacy generated async exports still use that selected backend. Use a
pure `async-runtime` build or upgrade to derive v4 when synchronous custom-runtime entry is
required. Derive v4 intentionally requires runtime v4 and uses the versioned selected-runtime
codegen contract.

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
napi = "4"
napi-derive = "4"

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

Install `@napi-rs/cli` as a local development dependency to build the Rust crate and copy its dynamic library to a loadable `.node` file.

```js
{
  "name": "awesome-package",
  "devDependencies": {
    "@napi-rs/cli": "^3.0.0"
  },
  "napi": {
    "binaryName": "jarvis"
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
| OsString/&'a OsStr       | String              | 1                                                                               | v8.0.0               |
| PathBuf/&'a Path         | String              | 1                                                                               | v8.0.0               |
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
| Async/Future             | Promise<T>          | 4                                                                               | v10.6.0              | async or async-runtime   |
| AsyncTask                | Promise<T>          | 1                                                                               | v8.5.0               |
| JsGlobal                 | global              | 1                                                                               | v8.0.0               |
| JsSymbol                 | Symbol              | 1                                                                               | v8.0.0               |
| Int8Array/Uint8Array ... | TypedArray          | 1                                                                               | v8.0.0               |
| JsFunction               | threadsafe function | 4                                                                               | v10.6.0              | napi4                    |
| BigInt                   | BigInt              | 6                                                                               | v10.7.0              | napi6                    |
