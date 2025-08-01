# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [3.1.6](https://github.com/napi-rs/napi-rs/compare/napi-v3.1.5...napi-v3.1.6) - 2025-08-01

### Fixed

- *(napi)* async task finally is not called ([#2824](https://github.com/napi-rs/napi-rs/pull/2824))

## [3.1.5](https://github.com/napi-rs/napi-rs/compare/napi-v3.1.4...napi-v3.1.5) - 2025-07-31

### Fixed

- *(napi)* relax the lifetime restriction in PromiseRaw callbacks ([#2819](https://github.com/napi-rs/napi-rs/pull/2819))

## [3.1.4](https://github.com/napi-rs/napi-rs/compare/napi-v3.1.3...napi-v3.1.4) - 2025-07-30

### Fixed

- *(napi)* the generic trait rectiction of Env::spawn should be ScopedTask ([#2817](https://github.com/napi-rs/napi-rs/pull/2817))

## [3.1.3](https://github.com/napi-rs/napi-rs/compare/napi-v3.1.2...napi-v3.1.3) - 2025-07-24

### Other

- *(napi)* optimize HashMap allocation in FromNapiValue implementation for HashMap ([#2796](https://github.com/napi-rs/napi-rs/pull/2796))

## [3.1.2](https://github.com/napi-rs/napi-rs/compare/napi-v3.1.1...napi-v3.1.2) - 2025-07-22

### Other

- *(napi)* use Vec with_capacity in FromNapiValue ([#2793](https://github.com/napi-rs/napi-rs/pull/2793))

## [3.1.1](https://github.com/napi-rs/napi-rs/compare/napi-v3.1.0...napi-v3.1.1) - 2025-07-21

### Other

- Revert "fix(napi): callback should be Fn rather than FnOnce" ([#2791](https://github.com/napi-rs/napi-rs/pull/2791))

## [3.1.0](https://github.com/napi-rs/napi-rs/compare/napi-v3.0.0...napi-v3.1.0) - 2025-07-21

### Added

- *(napi)* provide ScopedTask to resolve JsValue with lifetime ([#2786](https://github.com/napi-rs/napi-rs/pull/2786))

### Other

- *(napi)* add UnwindSafe and RefUnwindSafe back to AbortSignal and AsyncWorkPromise ([#2789](https://github.com/napi-rs/napi-rs/pull/2789))
- pin release-plz action
