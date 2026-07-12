# TEMPORARY: vendored emnapi v2 WASI archives

This directory works around gaps in the published `emnapi@2.0.0-alpha.2`
package and must be deleted once a fixed emnapi v2 prerelease is published.

A sibling workaround lives in
`.yarn/patches/@emnapi-core-npm-2.0.0-alpha.2-*.patch` (wired through the
root `resolutions`): the published `@emnapi/core` threadsafe-function plugin
captures `Int32Array`/`Uint32Array` views over `wasmMemory.buffer` and reuses
them across deferred turns / calls back into the module. Growing a
**non-shared** wasm memory (the single-threaded WASI builds) detaches the old
buffer, so TSFN dispatch crashes with
`TypeError: Cannot perform Atomics.store on a detached ArrayBuffer`. The
patch re-creates the views at each use (`dispatch` and `enqueue` in
`dist/plugins/threadsafe-function.js`). Upstream must apply the same fix;
drop the patch and the resolutions entries together with this directory.

## What is vendored

Two static archives, built from the C sources shipped **inside the published
npm package itself** (`node_modules/emnapi/src`, source list of the `emnapi`
target in `node_modules/emnapi/emnapi.gyp`) via `vendor/emnapi/build.mjs`:

| Archive                                        | Why                                                                    |
| ---------------------------------------------- | ---------------------------------------------------------------------- |
| `wasm32-wasip1/libemnapi.a`                    | Missing from the published package (non-threaded WASI is unsupported). |
| `wasm32-wasip1-threads/libemnapi-napi-rs-mt.a` | Published build references the env cleanup hooks via the wrong module. |

`vendor/emnapi/install.mjs` copies them into `node_modules/emnapi/lib`. It
runs from the repository `postinstall` hook and from the CI steps that build
WASI targets (CI installs with `--mode=skip-build`, which skips
`postinstall`).

## Import-module conventions (why the published archive is wrong)

- `crates/sys/src/lib.rs` declares every `napi_*` function in plain
  `extern "C"` blocks on wasm, i.e. the **default `env` import module**.
- The single exception: `napi_add_env_cleanup_hook` /
  `napi_remove_env_cleanup_hook` are imported through the **`napi` module**
  (`#[link(wasm_import_module = "napi")]` in `crates/napi/src/lib.rs`, since
  #2399).
- The emnapi C archive must follow the same convention, otherwise the final
  wasm either fails to link (`import module mismatch`, when the archive uses
  the `napi` module for symbols Rust imports via `env` — this is what the
  plain `libemnapi-mt.a` does) or ends up with duplicate
  `env.napi_*_env_cleanup_hook` **and** `napi.napi_*_env_cleanup_hook`
  imports (what the published `libemnapi-napi-rs-mt.a` produces, rejected by
  `examples/napi/wasi-cleanup-hook-link/check-imports.mjs`).

## What upstream emnapi must publish to remove this directory

A prerelease > `2.0.0-alpha.2` whose package ships:

1. `lib/wasm32-wasip1/libemnapi.a` — the `emnapi` gyp target compiled with
   `--target=wasm32-wasip1` (no threads), `napi_*` references through the
   default `env` import module **except** `napi_add_env_cleanup_hook` and
   `napi_remove_env_cleanup_hook`, which must use
   `__attribute__((__import_module__("napi")))`.
2. `lib/wasm32-wasip1-threads/libemnapi-napi-rs-mt.a` — same convention,
   compiled with `--target=wasm32-wasip1-threads -pthread`.

Then:

- delete `vendor/emnapi`,
- drop the `node vendor/emnapi/install.mjs` calls from `package.json`
  (`postinstall`) and `.github/workflows/test-release.yaml`,
- bump the `emnapi`, `@emnapi/core` and `@emnapi/runtime` versions together
  (the CLI enforces that the three versions match, see `setWasiEnv` in
  `cli/src/api/build.ts`).

`vendor/emnapi/install.mjs` and `vendor/emnapi/build.mjs` hard-fail when the
installed emnapi version is not `2.0.0-alpha.2`, so a version bump without
this cleanup breaks loudly instead of silently shipping stale archives.
