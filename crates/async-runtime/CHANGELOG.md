# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.4](https://github.com/napi-rs/napi-rs/compare/napi-async-runtime-v0.2.3...napi-async-runtime-v0.2.4) - 2026-09-24

### Other

- updated the following local packages: napi-derive

## [0.2.3](https://github.com/napi-rs/napi-rs/compare/napi-async-runtime-v0.2.2...napi-async-runtime-v0.2.3) - 2026-09-22

### Added

- *(async-runtime)* offer the MultiThread flavor on wasm32-wasip1-threads ([#3541](https://github.com/napi-rs/napi-rs/pull/3541))

## [0.2.2](https://github.com/napi-rs/napi-rs/compare/napi-async-runtime-v0.2.1...napi-async-runtime-v0.2.2) - 2026-09-20

### Fixed

- *(napi)* guard AsyncTask completion against env teardown ([#3536](https://github.com/napi-rs/napi-rs/pull/3536))

## [0.2.1](https://github.com/napi-rs/napi-rs/compare/napi-async-runtime-v0.2.0...napi-async-runtime-v0.2.1) - 2026-09-10

### Fixed

- CurrentThread waker-stack deadlocks and threadless-wasm Buffer detachment ([#3489](https://github.com/napi-rs/napi-rs/pull/3489))
