export const createCargoToml = ({
  name,
  license,
  features,
  deriveFeatures,
}: {
  name: string
  license: string
  features: string[]
  deriveFeatures: string[]
}) => `[package]
name = "${name.replace('@', '').replace('/', '_').toLowerCase()}"
version = "1.0.0"
edition = "2021"
license = "${license}"

[lib]
crate-type = ["cdylib"]

[dependencies.napi]
version = "2"
default-features = false
# see https://nodejs.org/api/n-api.html#node-api-version-matrix
features = ${JSON.stringify(features)}

[dependencies.napi-derive]
version = "2"
features = ${JSON.stringify(deriveFeatures)}

[build-dependencies]
napi-build = "2"

[profile.release]
lto = true
`
