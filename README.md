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

## Features table

### Create JavaScript values

| NAPI                                                         | NAPI Version | Minimal Node version | Status |
| ------------------------------------------------------------ | ------------ | -------------------- | ------ |
| [Enum types](https://nodejs.org/api/n-api.html#n_api_enum_types) | 6            | v13.7.0              | ⛔️      |
| [napi_create_array](https://nodejs.org/api/n-api.html#n_api_napi_create_array) | 1            | v8.0.0               | ✅      |
| [napi_create_array_with_length](https://nodejs.org/api/n-api.html#n_api_napi_create_array_with_length) | 1            | v8.0.0               | ✅      |
| [napi_create_arraybuffer](https://nodejs.org/api/n-api.html#n_api_napi_create_arraybuffer) | 1            | v8.0.0               | ✅      |
| [napi_create_buffer](https://nodejs.org/api/n-api.html#n_api_napi_create_buffer) | 1            | v8.0.0               | ✅      |
| [napi_create_buffer_copy](https://nodejs.org/api/n-api.html#n_api_napi_create_buffer_copy) | 1            | v8.0.0               | ⛔️      |
| [napi_create_date](https://nodejs.org/api/n-api.html#n_api_napi_create_date) | 5            | v11.11.0             | ⛔️      |
| [napi_create_external](https://nodejs.org/api/n-api.html#n_api_napi_create_external) | 1            | v8.0.0               | ⛔️      |
| [napi_create_external_arraybuffer](https://nodejs.org/api/n-api.html#n_api_napi_create_external_arraybuffer) | 1            | v8.0.0               | ✅      |
| [napi_create_external_buffer](https://nodejs.org/api/n-api.html#n_api_napi_create_external_buffer) | 1            | v8.0.0               | ✅      |
| [napi_create_object](https://nodejs.org/api/n-api.html#n_api_napi_create_object) | 1            | v8.0.0               | ✅      |
| [napi_create_symbol](https://nodejs.org/api/n-api.html#n_api_napi_create_symbol) | 1            | v8.0.0               | ⛔️      |
| [napi_create_typedarray](https://nodejs.org/api/n-api.html#n_api_napi_create_typedarray) | 1            | v8.0.0               | ⛔️      |
| [napi_create_dataview](https://nodejs.org/api/n-api.html#n_api_napi_create_dataview) | 1            | v8.3.0               | ⛔️      |
| [napi_create_int32](https://nodejs.org/api/n-api.html#n_api_napi_create_int32) | 1            | v8.4.0               | ⛔️      |
| [napi_create_uint32](https://nodejs.org/api/n-api.html#n_api_napi_create_uint32) | 1            | v8.4.0               | ✅      |
| [napi_create_int64](https://nodejs.org/api/n-api.html#n_api_napi_create_int64) | 1            | v8.4.0               | ✅      |
| [napi_create_double](https://nodejs.org/api/n-api.html#n_api_napi_create_double) | 1            | v8.4.0               | ⛔️      |
| [napi_create_bigint_int64](https://nodejs.org/api/n-api.html#n_api_napi_create_bigint_int64) | 6            | v10.7.0              | ⛔️      |
| [napi_create_bigint_uint64](https://nodejs.org/api/n-api.html#n_api_napi_create_bigint_uint64) | 6            | v10.7.0              | ⛔️      |
| [napi_create_bigint_words](https://nodejs.org/api/n-api.html#n_api_napi_create_bigint_words) | 6            | v10.7.0              | ⛔️      |
| [napi_create_string_latin1](https://nodejs.org/api/n-api.html#n_api_napi_create_string_latin1) | 1            | v8.0.0               | ⛔️      |
| [napi_create_string_utf16](https://nodejs.org/api/n-api.html#n_api_napi_create_string_utf16) | 1            | v8.0.0               | ✅      |
| [napi_create_string_utf8](https://nodejs.org/api/n-api.html#n_api_napi_create_string_utf8) | 1            | v8.0.0               | ✅      |

### [Functions to convert from N-API to C types](https://nodejs.org/api/n-api.html#n_api_functions_to_convert_from_n_api_to_c_types)

| NAPI | NAPI Version | Minimal Node Version | Status |
| ---- | ------------ | -------------------- | ------ |
|[napi_get_array_length](https://nodejs.org/api/n-api.html#n_api_napi_get_array_length)| 1 | v8.0.0 | ✅ |
|[napi_get_arraybuffer_info](https://nodejs.org/api/n-api.html#n_api_napi_get_arraybuffer_info)| 1 | v8.0.0 | ✅ |
|[napi_get_buffer_info](https://nodejs.org/api/n-api.html#n_api_napi_get_buffer_info)| 1 | v8.0.0 | ✅ |
|[napi_get_prototype](https://nodejs.org/api/n-api.html#n_api_napi_get_prototype)| 1 | v8.0.0 | ⛔️ |
|[napi_get_typedarray_info](https://nodejs.org/api/n-api.html#n_api_napi_get_typedarray_info)| 1 | v8.0.0 | ⛔️ |
|[napi_get_dataview_info](https://nodejs.org/api/n-api.html#n_api_napi_get_dataview_info)| 1 | v8.3.0 | ⛔️ |
|[napi_get_date_value](https://nodejs.org/api/n-api.html#n_api_napi_get_date_value)| 5 | v11.11.0 | ⛔️ |
|[napi_get_value_bool](https://nodejs.org/api/n-api.html#n_api_napi_get_value_bool)| 1 | v8.0.0 | ✅ |
|[napi_get_value_double](https://nodejs.org/api/n-api.html#n_api_napi_get_value_double)| 1 | v8.0.0 | ✅ |
|[napi_get_value_bigint_int64](https://nodejs.org/api/n-api.html#n_api_napi_get_value_bigint_int64)| 6 | v10.7.0 | ⛔️ |
|[napi_get_value_bigint_uint64](https://nodejs.org/api/n-api.html#n_api_napi_get_value_bigint_uint64)| 6 | v10.7.0 | ⛔️ |
|[napi_get_value_bigint_words](https://nodejs.org/api/n-api.html#n_api_napi_get_value_bigint_words)| 6 | v10.7.0 | ⛔️ |
|[napi_get_value_external](https://nodejs.org/api/n-api.html#n_api_napi_get_value_external)| 1 | v8.0.0 | ⛔️ |
|[napi_get_value_int32](https://nodejs.org/api/n-api.html#n_api_napi_get_value_int32)| 1 | v8.0.0 | ⛔️ |
|[napi_get_value_int64](https://nodejs.org/api/n-api.html#n_api_napi_get_value_int64)| 1 | v8.0.0 | ✅ |
|[napi_get_value_string_latin1](https://nodejs.org/api/n-api.html#n_api_napi_get_value_string_latin1)| 1 | v8.0.0 | ⛔️ |
|[napi_get_value_string_utf8](https://nodejs.org/api/n-api.html#n_api_napi_get_value_string_utf8)| 1 | v8.0.0 | ✅ |
|[napi_get_value_string_utf16](https://nodejs.org/api/n-api.html#n_api_napi_get_value_string_utf16)| 1 | v8.0.0 | ✅ |
|[napi_get_value_uint32](https://nodejs.org/api/n-api.html#n_api_napi_get_value_uint32)| 1 | v8.0.0 | ⛔️ |
|[napi_get_boolean](https://nodejs.org/api/n-api.html#n_api_napi_get_boolean)| 1 | v8.0.0 | ✅ |
|[napi_get_global](https://nodejs.org/api/n-api.html#n_api_napi_get_global)| 1 | v8.0.0 | ⛔️ |
|[napi_get_null](https://nodejs.org/api/n-api.html#n_api_napi_get_null)| 1 | v8.0.0 | ✅ |
|[napi_get_undefined](https://nodejs.org/api/n-api.html#n_api_napi_get_undefined)| 1 | v8.0.0 | ✅ |

### [Working with JavaScript Values and Abstract Operations](https://nodejs.org/api/n-api.html#n_api_working_with_javascript_values_and_abstract_operations)

| NAPI | NAPI Version | Minimal Node Version | Status |
| ---- | ------------ | -------------------- | ------ |
|[napi_coerce_to_bool](https://nodejs.org/api/n-api.html#n_api_napi_coerce_to_bool)| 1 | v8.0.0 | ✅ |
|[napi_coerce_to_number](https://nodejs.org/api/n-api.html#n_api_napi_coerce_to_number)| 1 | v8.0.0 | ✅ |
|[napi_coerce_to_object](https://nodejs.org/api/n-api.html#n_api_napi_coerce_to_object)| 1 | v8.0.0 | ✅ |
|[napi_coerce_to_string](https://nodejs.org/api/n-api.html#n_api_napi_coerce_to_string)| 1 | v8.0.0 | ✅ |
|[napi_typeof](https://nodejs.org/api/n-api.html#n_api_napi_typeof)| 1 | v8.0.0 | ✅ |
|[napi_instanceof](https://nodejs.org/api/n-api.html#n_api_napi_instanceof)| 1 | v8.0.0 | ⛔️ |
|[napi_is_array](https://nodejs.org/api/n-api.html#n_api_napi_is_array)| 1 | v8.0.0 | ✅ |
|[napi_is_arraybuffer](https://nodejs.org/api/n-api.html#n_api_napi_is_arraybuffer)| 1 | v8.0.0 | ✅ |
|[napi_is_buffer](https://nodejs.org/api/n-api.html#n_api_napi_is_buffer)| 1 | v8.0.0 | ✅ |
|[napi_is_date](https://nodejs.org/api/n-api.html#n_api_napi_is_date)| 1 | v8.0.0 | ⛔️ |
|[napi_is_error](https://nodejs.org/api/n-api.html#n_api_napi_is_error_1)| 1 | v8.0.0 | ⛔️ |
|[napi_is_typedarray](https://nodejs.org/api/n-api.html#n_api_napi_is_typedarray)| 1 | v8.0.0 | ⛔️ |
|[napi_is_dataview](https://nodejs.org/api/n-api.html#n_api_napi_is_dataview)| 1 | v8.3.0 | ⛔️ |
|[napi_strict_equals](https://nodejs.org/api/n-api.html#n_api_napi_strict_equals)| 1 | v8.0.0 | ⛔️ |
|[napi_detach_arraybuffer](https://nodejs.org/api/n-api.html#n_api_napi_detach_arraybuffer)| Experimental | v13.3.0 | ⛔️ |
|[napi_is_detached_arraybuffer](https://nodejs.org/api/n-api.html#n_api_napi_is_detached_arraybuffer)| Experimental | v13.3.0 | ⛔️ |