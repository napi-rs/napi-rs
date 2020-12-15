export const createCargoContent = (name: string) => `[package]
edition = "2018"
name = "${name.replace('@', '').replace('/', '_').toLowerCase()}"
version = "0.0.0"

[lib]
crate-type = ["cdylib"]

[dependencies]
napi = "1"
napi-derive = "1"

[build-dependencies]
napi-build = "1"

[profile.release]
lto = true
`
