# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [5.0.2](https://github.com/napi-rs/napi-rs/compare/napi-derive-backend-v5.0.1...napi-derive-backend-v5.0.2) - 2026-02-14

### Fixed

- *(deps)* update rust crate convert_case to 0.11 ([#3114](https://github.com/napi-rs/napi-rs/pull/3114))
- *(napi-derive)* escape * in comments ([#3109](https://github.com/napi-rs/napi-rs/pull/3109))

## [5.0.1](https://github.com/napi-rs/napi-rs/compare/napi-derive-backend-v5.0.0...napi-derive-backend-v5.0.1) - 2026-01-08

### Fixed

- *(napi)* memory leak in async fn ([#3089](https://github.com/napi-rs/napi-rs/pull/3089))

## [5.0.0](https://github.com/napi-rs/napi-rs/compare/napi-derive-backend-v4.0.1...napi-derive-backend-v5.0.0) - 2025-12-30

### Added

- *(napi-derive)* add #[napi(async_iterator)] macro attribute ([#3072](https://github.com/napi-rs/napi-rs/pull/3072))

## [4.0.1](https://github.com/napi-rs/napi-rs/compare/napi-derive-backend-v4.0.0...napi-derive-backend-v4.0.1) - 2025-12-19

### Fixed

- *(napi-derive)* class setter param can't be optional ([#3066](https://github.com/napi-rs/napi-rs/pull/3066))

## [4.0.0](https://github.com/napi-rs/napi-rs/compare/napi-derive-backend-v3.0.2...napi-derive-backend-v4.0.0) - 2025-12-02

### Added

- *(napi-derive)* add tracing feature for debug logging NAPI function calls ([#3041](https://github.com/napi-rs/napi-rs/pull/3041))
- *(napi)* add node_api_create_object_with_properties support for enum creation ([#2990](https://github.com/napi-rs/napi-rs/pull/2990))

### Fixed

- *(napi-derive)* add paren for function types ([#3044](https://github.com/napi-rs/napi-rs/pull/3044))
- *(deps)* update rust crate convert_case to 0.10 ([#3031](https://github.com/napi-rs/napi-rs/pull/3031))

## [3.0.2](https://github.com/napi-rs/napi-rs/compare/napi-derive-backend-v3.0.1...napi-derive-backend-v3.0.2) - 2025-11-10

### Fixed

- *(deps)* update rust crate convert_case to 0.9 ([#3001](https://github.com/napi-rs/napi-rs/pull/3001))

### Other

- *(napi)* fix tsdown config ([#3010](https://github.com/napi-rs/napi-rs/pull/3010))

## [3.0.1](https://github.com/napi-rs/napi-rs/compare/napi-derive-backend-v3.0.0...napi-derive-backend-v3.0.1) - 2025-11-07

### Fixed

- *(napi-derive)* TypedArray typegen ([#3005](https://github.com/napi-rs/napi-rs/pull/3005))

## [3.0.0](https://github.com/napi-rs/napi-rs/compare/napi-derive-backend-v2.2.0...napi-derive-backend-v3.0.0) - 2025-10-24

### Added

- *(napi-derive)* add `discriminant_case` to allow changing case of discriminant ([#2960](https://github.com/napi-rs/napi-rs/pull/2960))

### Fixed

- *(napi)* stop ref error object in wasm targets ([#2975](https://github.com/napi-rs/napi-rs/pull/2975))

### Other

- *(napi)* bump rust-version ([#2966](https://github.com/napi-rs/napi-rs/pull/2966))
- *(napi-derive)* make typegen easier to read ([#2956](https://github.com/napi-rs/napi-rs/pull/2956))

## [2.2.0](https://github.com/napi-rs/napi-rs/compare/napi-derive-backend-v2.1.4...napi-derive-backend-v2.2.0) - 2025-09-08

### Added

- *(napi)* support external JsStringLatin1 and JsStringUtf16 ([#2898](https://github.com/napi-rs/napi-rs/pull/2898))

## [2.1.4](https://github.com/napi-rs/napi-rs/compare/napi-derive-backend-v2.1.3...napi-derive-backend-v2.1.4) - 2025-08-16

### Fixed

- *(napi-derive)* codegen issue for &'env [u8] param ([#2881](https://github.com/napi-rs/napi-rs/pull/2881))

### Other

- *(napi)* extends the Set types interoperability ([#2875](https://github.com/napi-rs/napi-rs/pull/2875))

## [2.1.3](https://github.com/napi-rs/napi-rs/compare/napi-derive-backend-v2.1.2...napi-derive-backend-v2.1.3) - 2025-08-13

### Fixed

- *(napi)* link issue on cargo test --features noop ([#2872](https://github.com/napi-rs/napi-rs/pull/2872))

## [2.1.2](https://github.com/napi-rs/napi-rs/compare/napi-derive-backend-v2.1.1...napi-derive-backend-v2.1.2) - 2025-08-09

### Fixed

- *(napi-derive)* comments idents regression ([#2857](https://github.com/napi-rs/napi-rs/pull/2857))

## [2.1.1](https://github.com/napi-rs/napi-rs/compare/napi-derive-backend-v2.1.0...napi-derive-backend-v2.1.1) - 2025-08-08

### Fixed

- *(napi)* handle the return_if_invalid for Array param ([#2846](https://github.com/napi-rs/napi-rs/pull/2846))

## [2.1.0](https://github.com/napi-rs/napi-rs/compare/napi-derive-backend-v2.0.3...napi-derive-backend-v2.1.0) - 2025-08-07

### Added

- make generator an iterator ([#2784](https://github.com/napi-rs/napi-rs/pull/2784))

## [2.0.3](https://github.com/napi-rs/napi-rs/compare/napi-derive-backend-v2.0.2...napi-derive-backend-v2.0.3) - 2025-07-30

### Fixed

- *(napi-derive)* generate types for threadsafe_function with WEAK=true correctly ([#2813](https://github.com/napi-rs/napi-rs/pull/2813))

## [2.0.2](https://github.com/napi-rs/napi-rs/compare/napi-derive-backend-v2.0.1...napi-derive-backend-v2.0.2) - 2025-07-22

### Fixed

- *(napi-derive)* lifetime codegen issue ([#2794](https://github.com/napi-rs/napi-rs/pull/2794))

## [2.0.1](https://github.com/napi-rs/napi-rs/compare/napi-derive-backend-v2.0.0...napi-derive-backend-v2.0.1) - 2025-07-21

### Other

- pin release-plz action
