# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.3.1](https://github.com/napi-rs/napi-rs/compare/napi-build-v2.3.0...napi-build-v2.3.1) - 2025-11-10

### Fixed

- *(build)* add back undefined symbols lookup behavior ([#3015](https://github.com/napi-rs/napi-rs/pull/3015))

## [2.3.0](https://github.com/napi-rs/napi-rs/compare/napi-build-v2.2.4...napi-build-v2.3.0) - 2025-11-06

### Added

- *(sys)* use libloading to load napi symbols at runtime on all platform ([#2996](https://github.com/napi-rs/napi-rs/pull/2996))

## [2.2.4](https://github.com/napi-rs/napi-rs/compare/napi-build-v2.2.3...napi-build-v2.2.4) - 2025-10-24

### Fixed

- *(build)* export `emnapi_thread_crashed` ([#2920](https://github.com/napi-rs/napi-rs/pull/2920))

### Other

- *(napi)* bump rust-version ([#2966](https://github.com/napi-rs/napi-rs/pull/2966))

## [2.2.3](https://github.com/napi-rs/napi-rs/compare/napi-build-v2.2.2...napi-build-v2.2.3) - 2025-07-24

### Other

- *(cli)* setjmp link path ([#2808](https://github.com/napi-rs/napi-rs/pull/2808))
