# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [3.4.0](https://github.com/napi-rs/napi-rs/compare/napi-v3.3.0...napi-v3.4.0) - 2025-10-24

### Added

- *(napi)* add on_abort for AbortSignal ([#2942](https://github.com/napi-rs/napi-rs/pull/2942))
- *(cli)* add support for loongarch64-unknown-linux-gnu ([#2887](https://github.com/napi-rs/napi-rs/pull/2887))

### Fixed

- *(napi)* stop ref error object in wasm targets ([#2975](https://github.com/napi-rs/napi-rs/pull/2975))
- *(deps)* update rust crate ctor to v0.6.0 ([#2951](https://github.com/napi-rs/napi-rs/pull/2951))
- *(napi)* cleanup memory issues ([#2949](https://github.com/napi-rs/napi-rs/pull/2949))
- *(napi)* node_api_create_external_string_utf16 on wasm ([#2912](https://github.com/napi-rs/napi-rs/pull/2912))

### Other

- *(napi)* bump rust-version ([#2966](https://github.com/napi-rs/napi-rs/pull/2966))

## [3.3.0](https://github.com/napi-rs/napi-rs/compare/napi-v3.2.4...napi-v3.3.0) - 2025-09-08

### Added

- *(napi)* implement from_static on JsStringLatin1 and JsStringUtf16 ([#2908](https://github.com/napi-rs/napi-rs/pull/2908))
- *(napi)* support external JsStringLatin1 and JsStringUtf16 ([#2898](https://github.com/napi-rs/napi-rs/pull/2898))

### Fixed

- *(napi)* JsStringUtf8 memory leak ([#2911](https://github.com/napi-rs/napi-rs/pull/2911))

### Other

- *(cli)* show NAPI options on new command ([#2892](https://github.com/napi-rs/napi-rs/pull/2892))

## [3.2.4](https://github.com/napi-rs/napi-rs/compare/napi-v3.2.3...napi-v3.2.4) - 2025-08-16

### Other

- *(napi)* extends the Set types interoperability ([#2875](https://github.com/napi-rs/napi-rs/pull/2875))

## [3.2.3](https://github.com/napi-rs/napi-rs/compare/napi-v3.2.2...napi-v3.2.3) - 2025-08-13

### Fixed

- *(napi)* link issue on cargo test --features noop ([#2872](https://github.com/napi-rs/napi-rs/pull/2872))
- *(deps)* update rust crate ctor to v0.5.0 ([#2865](https://github.com/napi-rs/napi-rs/pull/2865))

## [3.2.2](https://github.com/napi-rs/napi-rs/compare/napi-v3.2.1...napi-v3.2.2) - 2025-08-08

### Fixed

- *(napi)* no need to cleanup thread_local stuff ([#2851](https://github.com/napi-rs/napi-rs/pull/2851))

## [3.2.1](https://github.com/napi-rs/napi-rs/compare/napi-v3.2.0...napi-v3.2.1) - 2025-08-08

### Fixed

- *(napi)* ensure tokio runtime is initialized for dlopen ([#2850](https://github.com/napi-rs/napi-rs/pull/2850))
- *(napi)* handle the return_if_invalid for Array param ([#2846](https://github.com/napi-rs/napi-rs/pull/2846))

## [3.2.0](https://github.com/napi-rs/napi-rs/compare/napi-v3.1.6...napi-v3.2.0) - 2025-08-07

### Added

- *(napi)* add ScopeGenerator trait ([#2831](https://github.com/napi-rs/napi-rs/pull/2831))
- make generator an iterator ([#2784](https://github.com/napi-rs/napi-rs/pull/2784))
- *(napi)* add `Error.cause` support to `napi::Error` ([#2829](https://github.com/napi-rs/napi-rs/pull/2829))

### Fixed

- *(napi)* user_defined_rt can only be used once ([#2841](https://github.com/napi-rs/napi-rs/pull/2841))

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
