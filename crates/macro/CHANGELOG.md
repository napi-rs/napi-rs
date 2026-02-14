# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [3.5.2](https://github.com/napi-rs/napi-rs/compare/napi-derive-v3.5.1...napi-derive-v3.5.2) - 2026-02-14

### Fixed

- *(deps)* update rust crate convert_case to 0.11 ([#3114](https://github.com/napi-rs/napi-rs/pull/3114))

## [3.5.1](https://github.com/napi-rs/napi-rs/compare/napi-derive-v3.5.0...napi-derive-v3.5.1) - 2026-01-08

### Other

- updated the following local packages: napi-derive-backend

## [3.5.0](https://github.com/napi-rs/napi-rs/compare/napi-derive-v3.4.1...napi-derive-v3.5.0) - 2025-12-30

### Added

- *(napi-derive)* add #[napi(async_iterator)] macro attribute ([#3072](https://github.com/napi-rs/napi-rs/pull/3072))

## [3.4.1](https://github.com/napi-rs/napi-rs/compare/napi-derive-v3.4.0...napi-derive-v3.4.1) - 2025-12-19

### Other

- clippy fix for Rust 1.92.0 ([#3058](https://github.com/napi-rs/napi-rs/pull/3058))

## [3.4.0](https://github.com/napi-rs/napi-rs/compare/napi-derive-v3.3.3...napi-derive-v3.4.0) - 2025-12-02

### Added

- *(napi-derive)* add tracing feature for debug logging NAPI function calls ([#3041](https://github.com/napi-rs/napi-rs/pull/3041))

### Fixed

- *(deps)* update rust crate convert_case to 0.10 ([#3031](https://github.com/napi-rs/napi-rs/pull/3031))

## [3.3.3](https://github.com/napi-rs/napi-rs/compare/napi-derive-v3.3.2...napi-derive-v3.3.3) - 2025-11-10

### Fixed

- *(deps)* update rust crate convert_case to 0.9 ([#3001](https://github.com/napi-rs/napi-rs/pull/3001))

### Other

- *(napi)* fix tsdown config ([#3010](https://github.com/napi-rs/napi-rs/pull/3010))

## [3.3.2](https://github.com/napi-rs/napi-rs/compare/napi-derive-v3.3.1...napi-derive-v3.3.2) - 2025-11-07

### Other

- updated the following local packages: napi-derive-backend

## [3.3.1](https://github.com/napi-rs/napi-rs/compare/napi-derive-v3.3.0...napi-derive-v3.3.1) - 2025-11-07

### Other

- *(napi)* Promise and ThreadsafeFunction::call_async don't require tokio ([#2998](https://github.com/napi-rs/napi-rs/pull/2998))

## [3.3.0](https://github.com/napi-rs/napi-rs/compare/napi-derive-v3.2.5...napi-derive-v3.3.0) - 2025-10-24

### Added

- *(napi-derive)* add `discriminant_case` to allow changing case of discriminant ([#2960](https://github.com/napi-rs/napi-rs/pull/2960))

### Fixed

- *(deps)* update rust crate ctor to v0.6.0 ([#2951](https://github.com/napi-rs/napi-rs/pull/2951))

### Other

- *(napi)* bump rust-version ([#2966](https://github.com/napi-rs/napi-rs/pull/2966))

## [3.2.5](https://github.com/napi-rs/napi-rs/compare/napi-derive-v3.2.4...napi-derive-v3.2.5) - 2025-09-08

### Other

- updated the following local packages: napi-derive-backend

## [3.2.4](https://github.com/napi-rs/napi-rs/compare/napi-derive-v3.2.3...napi-derive-v3.2.4) - 2025-08-16

### Other

- updated the following local packages: napi-derive-backend

## [3.2.3](https://github.com/napi-rs/napi-rs/compare/napi-derive-v3.2.2...napi-derive-v3.2.3) - 2025-08-13

### Fixed

- *(napi)* link issue on cargo test --features noop ([#2872](https://github.com/napi-rs/napi-rs/pull/2872))
- *(deps)* update rust crate ctor to v0.5.0 ([#2865](https://github.com/napi-rs/napi-rs/pull/2865))

## [3.2.2](https://github.com/napi-rs/napi-rs/compare/napi-derive-v3.2.1...napi-derive-v3.2.2) - 2025-08-09

### Other

- updated the following local packages: napi-derive-backend

## [3.2.1](https://github.com/napi-rs/napi-rs/compare/napi-derive-v3.2.0...napi-derive-v3.2.1) - 2025-08-08

### Other

- updated the following local packages: napi-derive-backend

## [3.2.0](https://github.com/napi-rs/napi-rs/compare/napi-derive-v3.1.2...napi-derive-v3.2.0) - 2025-08-07

### Added

- *(napi)* add ScopeGenerator trait ([#2831](https://github.com/napi-rs/napi-rs/pull/2831))
- make generator an iterator ([#2784](https://github.com/napi-rs/napi-rs/pull/2784))

## [3.1.2](https://github.com/napi-rs/napi-rs/compare/napi-derive-v3.1.1...napi-derive-v3.1.2) - 2025-07-30

### Other

- updated the following local packages: napi-derive-backend

## [3.1.1](https://github.com/napi-rs/napi-rs/compare/napi-derive-v3.1.0...napi-derive-v3.1.1) - 2025-07-22

### Other

- updated the following local packages: napi-derive-backend

## [3.1.0](https://github.com/napi-rs/napi-rs/compare/napi-derive-v3.0.0...napi-derive-v3.1.0) - 2025-07-21

### Added

- *(napi)* provide ScopedTask to resolve JsValue with lifetime ([#2786](https://github.com/napi-rs/napi-rs/pull/2786))

### Other

- pin release-plz action
