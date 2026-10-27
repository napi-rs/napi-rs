# @napi-rs/wasm-runtime

Runtime helpers and browser polyfills for napi-rs WebAssembly addons.

## emnapi compatibility

Use matching versions of `@emnapi/core` and `@emnapi/runtime`:

- v1: `^1.7.1`. Core includes async work and threadsafe functions and ignores the
  plugins option. Loading this package does not resolve the v2-only
  `@emnapi/core/plugins` export.
- v2: exactly `2.0.0-beta.2`. This package bundles the async-work and TSFN plugins
  from that version. They depend on private core context and ABI fields, which
  can change between prereleases. Older alphas and untested newer prereleases
  are deliberately outside the peer range.

For raw `instantiateNapiModule` / `instantiateNapiModuleSync` calls loading a
single-threaded napi-rs addon, pass
`plugins: [emnapiAsyncWorkPlugin, emnapiTSFNPlugin]` from this package. Generated
napi-rs loaders already supply these plugins.

## Updating the bundled plugins

Update the exact v2 development dependencies and peer versions together with
the workspace resolutions. `build` checks the resolved core version against
the peer contract, and `prepack` rebuilds the bundles so a package cannot
silently reuse output from an earlier build.

`yarn workspace @napi-rs/wasm-runtime test` exercises actual WebAssembly
initialization, async work, TSFN calls from a worker, worker load failures, and
cleanup through both module formats. CI also installs the packed tarball with
real v1 and v2 peers outside the workspace to avoid root resolution overrides.
