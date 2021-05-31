# napi-rs

> This project was initialized from [xray](https://github.com/atom/xray)

A minimal library for building compiled `Node.js` add-ons in `Rust`.

<p>
  <a href="https://docs.rs/crate/napi"><img src="https://docs.rs/napi/badge.svg"></img></a>
  <a href="https://crates.io/crates/napi"><img src="https://img.shields.io/crates/v/napi.svg"></img></a>
  <a href="https://www.npmjs.com/package/@napi-rs/cli"><img src="https://img.shields.io/npm/v/@napi-rs/cli.svg"></img></a>
</p>

# Platform Support

![Lint](https://github.com/napi-rs/napi-rs/workflows/Lint/badge.svg)
![Linux N-API@3](https://github.com/napi-rs/napi-rs/workflows/Linux%20N-API@3/badge.svg)
![Linux musl](https://github.com/napi-rs/napi-rs/workflows/Linux%20musl/badge.svg)
![macOS/Windows/Linux x64](https://github.com/napi-rs/napi-rs/workflows/macOS/Windows/Linux%20x64/badge.svg)
![Linux-aarch64](https://github.com/napi-rs/napi-rs/workflows/Linux-aarch64/badge.svg)
![Linux-armv7](https://github.com/napi-rs/napi-rs/workflows/Linux-armv7/badge.svg)
![macOS-Android](https://github.com/napi-rs/napi-rs/workflows/macOS-Android/badge.svg)
![Windows i686](https://github.com/napi-rs/napi-rs/workflows/Windows%20i686/badge.svg)
[![Windows arm64](https://github.com/napi-rs/napi-rs/actions/workflows/windows-arm.yml/badge.svg)](https://github.com/napi-rs/napi-rs/actions/workflows/windows-arm.yml)
[![FreeBSD](https://api.cirrus-ci.com/github/napi-rs/napi-rs.svg)](https://cirrus-ci.com/github/napi-rs/napi-rs?branch=main)

|                       | node12 | node14 | node16 |
| --------------------- | ------ | ------ | ------ |
| Windows x64           | ✓      | ✓      | ✓      |
| Windows x86           | ✓      | ✓      | ✓      |
| Windows arm64         | ✓      | ✓      | ✓      |
| macOS x64             | ✓      | ✓      | ✓      |
| macOS aarch64         | ✓      | ✓      | ✓      |
| Linux x64 gnu         | ✓      | ✓      | ✓      |
| Linux x64 musl        | ✓      | ✓      | ✓      |
| Linux aarch64 gnu     | ✓      | ✓      | ✓      |
| Linux aarch64 musl    | ✓      | ✓      | ✓      |
| Linux arm gnueabihf   | ✓      | ✓      | ✓      |
| Linux aarch64 android | ✓      | ✓      | ✓      |
| FreeBSD x64           | ✓      | ✓      | ✓      |

This library depends on Node-API and requires `Node@10.0.0` or later.

We already have some packages written by `napi-rs`: [node-rs](https://github.com/napi-rs/node-rs)

One nice feature is that this crate allows you to build add-ons purely with the `Rust/JavaScript` toolchain and without involving `node-gyp`.

## Taste

> You can start from [package-template](https://github.com/napi-rs/package-template) to play with `napi-rs`

### Define JavaScript functions

```rust
#[js_function(1)] // ------> arguments length
fn fibonacci(ctx: CallContext) -> Result<JsNumber> {
  let n = ctx.get::<JsNumber>(0)?.try_into()?;
  ctx.env.create_int64(fibonacci_native(n))
}

#[inline(always)]
fn fibonacci_native(n: i64) -> i64 {
  match n {
    1 | 2 => 1,
    _ => fibonacci_native(n - 1) + fibonacci_native(n - 2),
  }
}
```

### Register module

```rust
#[macro_use]
extern crate napi_derive;

use napi::{JsObject, Result};

/// `exports` is `module.exports` object in NodeJS
#[module_exports]
fn init(mut exports: JsObject) -> Result<()> {
  exports.create_named_method("fibonacci", fibonacci)?;
  Ok(())
}
```

And you can also create `JavaScript` value while registering module:

```rust
#[macro_use]
extern crate napi_derive;

use napi::{JsObject, Result, Env};

#[module_exports]
fn init(mut exports: JsObject, env: Env) -> Result<()> {
  exports.create_named_method("fibonacci", fibonacci)?;
  exports.set_named_property("DEFAULT_VALUE", env.create_int64(100)?)?;
  Ok(())
}
```

## Building

This repository is a `Cargo` crate. Any napi-based add-on should contain `Cargo.toml` to make it a Cargo crate.

In your `Cargo.toml` you need to set the `crate-type` to `"cdylib"` so that cargo builds a C-style shared library that can be dynamically loaded by the Node executable. You'll also need to add this crate as a dependency.

```toml
[package]
name = "awesome"

[lib]
crate-type = ["cdylib"]

[dependencies]
napi = "1"
napi-derive = "1"

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

See the included [test_module](./test_module) for an example add-on.

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

## Features table

### Create JavaScript values

| NAPI                                                                                                         | NAPI Version | Minimal Node version | Status |
| ------------------------------------------------------------------------------------------------------------ | ------------ | -------------------- | ------ |
| [napi_create_array](https://nodejs.org/api/n-api.html#n_api_napi_create_array)                               | 1            | v8.0.0               | ✅     |
| [napi_create_array_with_length](https://nodejs.org/api/n-api.html#n_api_napi_create_array_with_length)       | 1            | v8.0.0               | ✅     |
| [napi_create_arraybuffer](https://nodejs.org/api/n-api.html#n_api_napi_create_arraybuffer)                   | 1            | v8.0.0               | ✅     |
| [napi_create_buffer](https://nodejs.org/api/n-api.html#n_api_napi_create_buffer)                             | 1            | v8.0.0               | ✅     |
| [napi_create_buffer_copy](https://nodejs.org/api/n-api.html#n_api_napi_create_buffer_copy)                   | 1            | v8.0.0               | ✅     |
| [napi_create_date](https://nodejs.org/api/n-api.html#n_api_napi_create_date)                                 | 5            | v11.11.0             | ✅     |
| [napi_create_external](https://nodejs.org/api/n-api.html#n_api_napi_create_external)                         | 1            | v8.0.0               | ✅     |
| [napi_create_external_arraybuffer](https://nodejs.org/api/n-api.html#n_api_napi_create_external_arraybuffer) | 1            | v8.0.0               | ✅     |
| [napi_create_external_buffer](https://nodejs.org/api/n-api.html#n_api_napi_create_external_buffer)           | 1            | v8.0.0               | ✅     |
| [napi_create_object](https://nodejs.org/api/n-api.html#n_api_napi_create_object)                             | 1            | v8.0.0               | ✅     |
| [napi_create_symbol](https://nodejs.org/api/n-api.html#n_api_napi_create_symbol)                             | 1            | v8.0.0               | ✅     |
| [napi_create_typedarray](https://nodejs.org/api/n-api.html#n_api_napi_create_typedarray)                     | 1            | v8.0.0               | ✅     |
| [napi_create_dataview](https://nodejs.org/api/n-api.html#n_api_napi_create_dataview)                         | 1            | v8.3.0               | ✅     |
| [napi_create_int32](https://nodejs.org/api/n-api.html#n_api_napi_create_int32)                               | 1            | v8.4.0               | ✅     |
| [napi_create_uint32](https://nodejs.org/api/n-api.html#n_api_napi_create_uint32)                             | 1            | v8.4.0               | ✅     |
| [napi_create_int64](https://nodejs.org/api/n-api.html#n_api_napi_create_int64)                               | 1            | v8.4.0               | ✅     |
| [napi_create_double](https://nodejs.org/api/n-api.html#n_api_napi_create_double)                             | 1            | v8.4.0               | ✅     |
| [napi_create_bigint_int64](https://nodejs.org/api/n-api.html#n_api_napi_create_bigint_int64)                 | 6            | v10.7.0              | ✅     |
| [napi_create_bigint_uint64](https://nodejs.org/api/n-api.html#n_api_napi_create_bigint_uint64)               | 6            | v10.7.0              | ✅     |
| [napi_create_bigint_words](https://nodejs.org/api/n-api.html#n_api_napi_create_bigint_words)                 | 6            | v10.7.0              | ✅     |
| [napi_create_string_latin1](https://nodejs.org/api/n-api.html#n_api_napi_create_string_latin1)               | 1            | v8.0.0               | ✅     |
| [napi_create_string_utf16](https://nodejs.org/api/n-api.html#n_api_napi_create_string_utf16)                 | 1            | v8.0.0               | ✅     |
| [napi_create_string_utf8](https://nodejs.org/api/n-api.html#n_api_napi_create_string_utf8)                   | 1            | v8.0.0               | ✅     |
| [napi_type_tag](https://nodejs.org/api/n-api.html#n_api_napi_type_tag)                                       | 8            | v14.8.0, v12.19.0    | ⚠️     |

> I have no plan to implement `nape_type_tag` and related API in `napi-rs`, because we have implemented a `rust` replacement in [TaggedObject](https://github.com/napi-rs/napi-rs/blob/main/napi/src/js_values/tagged_object.rs) which is more convenient and more compatible.

### [Functions to convert from Node-API to C types](https://nodejs.org/api/n-api.html#n_api_functions_to_convert_from_node_api_to_c_types)

| NAPI                                                                                                 | NAPI Version | Minimal Node Version | Status |
| ---------------------------------------------------------------------------------------------------- | ------------ | -------------------- | ------ |
| [napi_get_array_length](https://nodejs.org/api/n-api.html#n_api_napi_get_array_length)               | 1            | v8.0.0               | ✅     |
| [napi_get_arraybuffer_info](https://nodejs.org/api/n-api.html#n_api_napi_get_arraybuffer_info)       | 1            | v8.0.0               | ✅     |
| [napi_get_buffer_info](https://nodejs.org/api/n-api.html#n_api_napi_get_buffer_info)                 | 1            | v8.0.0               | ✅     |
| [napi_get_prototype](https://nodejs.org/api/n-api.html#n_api_napi_get_prototype)                     | 1            | v8.0.0               | ✅     |
| [napi_get_typedarray_info](https://nodejs.org/api/n-api.html#n_api_napi_get_typedarray_info)         | 1            | v8.0.0               | ✅     |
| [napi_get_dataview_info](https://nodejs.org/api/n-api.html#n_api_napi_get_dataview_info)             | 1            | v8.3.0               | ✅     |
| [napi_get_date_value](https://nodejs.org/api/n-api.html#n_api_napi_get_date_value)                   | 5            | v11.11.0             | ✅     |
| [napi_get_value_bool](https://nodejs.org/api/n-api.html#n_api_napi_get_value_bool)                   | 1            | v8.0.0               | ✅     |
| [napi_get_value_double](https://nodejs.org/api/n-api.html#n_api_napi_get_value_double)               | 1            | v8.0.0               | ✅     |
| [napi_get_value_bigint_int64](https://nodejs.org/api/n-api.html#n_api_napi_get_value_bigint_int64)   | 6            | v10.7.0              | ✅     |
| [napi_get_value_bigint_uint64](https://nodejs.org/api/n-api.html#n_api_napi_get_value_bigint_uint64) | 6            | v10.7.0              | ✅     |
| [napi_get_value_bigint_words](https://nodejs.org/api/n-api.html#n_api_napi_get_value_bigint_words)   | 6            | v10.7.0              | ✅     |
| [napi_get_value_external](https://nodejs.org/api/n-api.html#n_api_napi_get_value_external)           | 1            | v8.0.0               | ✅     |
| [napi_get_value_int32](https://nodejs.org/api/n-api.html#n_api_napi_get_value_int32)                 | 1            | v8.0.0               | ✅     |
| [napi_get_value_int64](https://nodejs.org/api/n-api.html#n_api_napi_get_value_int64)                 | 1            | v8.0.0               | ✅     |
| [napi_get_value_string_latin1](https://nodejs.org/api/n-api.html#n_api_napi_get_value_string_latin1) | 1            | v8.0.0               | ✅     |
| [napi_get_value_string_utf8](https://nodejs.org/api/n-api.html#n_api_napi_get_value_string_utf8)     | 1            | v8.0.0               | ✅     |
| [napi_get_value_string_utf16](https://nodejs.org/api/n-api.html#n_api_napi_get_value_string_utf16)   | 1            | v8.0.0               | ✅     |
| [napi_get_value_uint32](https://nodejs.org/api/n-api.html#n_api_napi_get_value_uint32)               | 1            | v8.0.0               | ✅     |
| [napi_get_boolean](https://nodejs.org/api/n-api.html#n_api_napi_get_boolean)                         | 1            | v8.0.0               | ✅     |
| [napi_get_global](https://nodejs.org/api/n-api.html#n_api_napi_get_global)                           | 1            | v8.0.0               | ✅     |
| [napi_get_null](https://nodejs.org/api/n-api.html#n_api_napi_get_null)                               | 1            | v8.0.0               | ✅     |
| [napi_get_undefined](https://nodejs.org/api/n-api.html#n_api_napi_get_undefined)                     | 1            | v8.0.0               | ✅     |

### [Working with JavaScript Values and Abstract Operations](https://nodejs.org/api/n-api.html#n_api_working_with_javascript_values_and_abstract_operations)

| NAPI                                                                                                 | NAPI Version | Minimal Node Version | Status |
| ---------------------------------------------------------------------------------------------------- | ------------ | -------------------- | ------ |
| [napi_coerce_to_bool](https://nodejs.org/api/n-api.html#n_api_napi_coerce_to_bool)                   | 1            | v8.0.0               | ✅     |
| [napi_coerce_to_number](https://nodejs.org/api/n-api.html#n_api_napi_coerce_to_number)               | 1            | v8.0.0               | ✅     |
| [napi_coerce_to_object](https://nodejs.org/api/n-api.html#n_api_napi_coerce_to_object)               | 1            | v8.0.0               | ✅     |
| [napi_coerce_to_string](https://nodejs.org/api/n-api.html#n_api_napi_coerce_to_string)               | 1            | v8.0.0               | ✅     |
| [napi_typeof](https://nodejs.org/api/n-api.html#n_api_napi_typeof)                                   | 1            | v8.0.0               | ✅     |
| [napi_instanceof](https://nodejs.org/api/n-api.html#n_api_napi_instanceof)                           | 1            | v8.0.0               | ✅     |
| [napi_is_array](https://nodejs.org/api/n-api.html#n_api_napi_is_array)                               | 1            | v8.0.0               | ✅     |
| [napi_is_arraybuffer](https://nodejs.org/api/n-api.html#n_api_napi_is_arraybuffer)                   | 1            | v8.0.0               | ✅     |
| [napi_is_buffer](https://nodejs.org/api/n-api.html#n_api_napi_is_buffer)                             | 1            | v8.0.0               | ✅     |
| [napi_is_date](https://nodejs.org/api/n-api.html#n_api_napi_is_date)                                 | 1            | v8.0.0               | ✅     |
| [napi_is_error](https://nodejs.org/api/n-api.html#n_api_napi_is_error_1)                             | 1            | v8.0.0               | ✅     |
| [napi_is_typedarray](https://nodejs.org/api/n-api.html#n_api_napi_is_typedarray)                     | 1            | v8.0.0               | ✅     |
| [napi_is_dataview](https://nodejs.org/api/n-api.html#n_api_napi_is_dataview)                         | 1            | v8.3.0               | ✅     |
| [napi_strict_equals](https://nodejs.org/api/n-api.html#n_api_napi_strict_equals)                     | 1            | v8.0.0               | ✅     |
| [napi_detach_arraybuffer](https://nodejs.org/api/n-api.html#n_api_napi_detach_arraybuffer)           | 7            | v13.3.0              | ✅     |
| [napi_is_detached_arraybuffer](https://nodejs.org/api/n-api.html#n_api_napi_is_detached_arraybuffer) | 7            | v13.3.0              | ✅     |
| [napi_object_freeze](https://nodejs.org/api/n-api.html#n_api_napi_object_freeze)                     | 8            | v14.14.0, v12.20.0   | ✅     |
| [napi_object_seal](https://nodejs.org/api/n-api.html#n_api_napi_object_seal)                         | 8            | v14.14.0, v12.20.0   | ✅     |
