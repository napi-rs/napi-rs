# @napi-rs/wasm-runtime

Runtime helpers and browser polyfills for napi-rs WebAssembly addons.

## emnapi compatibility

Use matching versions of `@emnapi/core` and `@emnapi/runtime`:

- v1: `^1.7.1`. Core includes async work and threadsafe functions and ignores the
  plugins option. Loading this package does not resolve the v2-only
  `@emnapi/core/plugins` export.
- v2: the peer range is exactly `2.0.0-beta.2` or `2.0.0-beta.3`, and this
  package bundles the async-work and TSFN plugins from `2.0.0-beta.3`. They
  depend on private core context fields, which are the same in both betas
  (`2.0.0-beta.3` changed only the TSFN release order). `2.0.0-beta.1` renamed
  the context field `napiModule` to `addonModule`; the bundled plugins accept
  both names, so bindings that pin a 2.0.0 alpha keep loading. A later
  prerelease that changes the context again needs a new release of this
  package.

The v2 peer range stays narrow on purpose. With an open range, npm can hoist a
binding's 2.0.0 alpha core next to this package, and then v1 bindings that
load through the ESM entry, or through tools that skip the CommonJS copy
lookup below, get a v2 core. With the narrow range, npm installs a v1 core for
this package when a binding pins another v2 prerelease. The binding's own
emnapi copy still runs it, as described below.

The CommonJS entry keeps emnapi copies apart when this package's peers resolve
to a different copy than a binding's own `@emnapi/core` and `@emnapi/runtime`
(two bindings pinning different emnapi versions, say):

- `instantiateNapiModule(Sync)` runs the core of the copy whose runtime created
  `options.context`. It finds that runtime in `require.cache` and resolves the
  core from the module that required it (the binding's loader).
- `getDefaultContext`, `createContext`, `MessageHandler`, and instantiation
  without a context use the copy of the calling package when it declares both
  emnapi packages as dependencies: the CommonJS module that is still loading
  and required this package, or, in a worker thread, the worker's entry file.
- When the selected core is v2, the bundled plugins are replaced by that core's
  own `@emnapi/core/plugins`.
- Anything else uses this package's peers. A context of the other emnapi
  generation from no known copy throws a `TypeError` that says so.

The ESM entry is resolved by bundlers and cannot do this. It uses the bundled
plugins with the `addonModule` alias.

For raw `instantiateNapiModule` / `instantiateNapiModuleSync` calls loading a
single-threaded napi-rs addon, pass
`plugins: [emnapiAsyncWorkPlugin, emnapiTSFNPlugin]` from this package. Generated
napi-rs loaders already supply these plugins.

## Updating the bundled plugins

Update the exact v2 development dependencies together with the workspace
resolutions. `build` checks that the resolved core version is the exact
development version and one of the v2 versions in the peer range, and
`prepack` rebuilds the bundles so a package cannot silently reuse output from
an earlier build. Before a release, compare the new plugin context with the
oldest supported alpha (`2.0.0-alpha.3` is the oldest still pinned by published
bindings), and keep the CI matrix covering it. Keep earlier v2 versions in the
peer range while published bindings pin them (rolldown 1.2.16 pins
`2.0.0-beta.2`); removing one makes npm install a v1 core for this package
next to those bindings.

`yarn workspace @napi-rs/wasm-runtime test` exercises actual WebAssembly
initialization, async work, TSFN calls from a worker, worker load failures, and
cleanup through both module formats. CI also installs the packed tarball with
real v1 and v2 peers outside the workspace to avoid root resolution overrides.
