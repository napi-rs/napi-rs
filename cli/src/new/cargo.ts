export const createCargoContent = (name: string) => `[package]
edition = "2021"
name = "${name.replace('@', '').replace('/', '_').toLowerCase()}"
version = "0.0.0"

[lib]
crate-type = ["cdylib"]

[dependencies]
# Default enable napi4 feature, see https://nodejs.org/api/n-api.html#node-api-version-matrix
napi = { version = "NAPI_VERSION", default-features = false, features = ["napi4"] }
napi-derive = "NAPI_DERIVE_VERSION"

[build-dependencies]
napi-build = "NAPI_BUILD_VERSION"

[profile.release]
lto = true
`
