# `@napi-rs/triples`

> Rust build triples definitions

## Usage

```js
const triples = require('@napi-rs/triples');

console.log(triples)

[
  ...
  'aarch64-apple-ios': {
    platform: 'ios',
    arch: 'arm64',
    abi: null,
    platformArchABI: 'ios-arm64',
    raw: 'aarch64-apple-ios',
  },
  'aarch64-fuchsia': {
    platform: 'fuchsia',
    arch: 'arm64',
    abi: null,
    platformArchABI: 'fuchsia-arm64',
    raw: 'aarch64-fuchsia',
  },
  'aarch64-linux-android': {
    platform: 'android',
    arch: 'arm64',
    abi: null,
    platformArchABI: 'android-arm64',
    raw: 'aarch64-linux-android',
  },
  'aarch64-pc-windows-msvc': {
    platform: 'win32',
    arch: 'arm64',
    abi: 'msvc',
    platformArchABI: 'win32-arm64-msvc',
    raw: 'aarch64-pc-windows-msvc',
  },
  'aarch64-unknown-linux-gnu': {
    platform: 'linux',
    arch: 'arm64',
    abi: 'gnu',
    platformArchABI: 'linux-arm64-gnu',
    raw: 'aarch64-unknown-linux-gnu',
  },
  'aarch64-unknown-linux-musl': {
    platform: 'linux',
    arch: 'arm64',
    abi: 'musl',
    platformArchABI: 'linux-arm64-musl',
    raw: 'aarch64-unknown-linux-musl',
  },
  'aarch64-unknown-none': {
    platform: 'none',
    arch: 'arm64',
    abi: null,
    platformArchABI: 'none-arm64',
    raw: 'aarch64-unknown-none',
  },
  'aarch64-unknown-none-softfloat': {
    platform: 'none',
    arch: 'arm64',
    abi: 'softfloat',
    platformArchABI: 'none-arm64-softfloat',
    raw: 'aarch64-unknown-none-softfloat',
  }
  ...
]
```
