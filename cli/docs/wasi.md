# WASI targets and loaders

Use `wasm32-wasip1-threads` for the threaded runtime and `wasm32-wasip1` for
the threadless runtime. The historical `wasm32-wasi` and
`wasm32-wasi-preview1-threads` spellings are accepted as aliases for
`wasm32-wasip1-threads`; they retain the existing `<package>-wasm32-wasi`
package and artifact identity. Configuring more than one alias for the same
artifact set is an error.

WASI packages use emnapi v2, whose runtime is ESM-only. The generated
CommonJS entry therefore supports Node.js `^20.19.0`, `^22.13.0`, and
`>=23.5.0`, where `require()` can load ESM without an experimental warning.
Browser and workerd entries use ESM directly, but share the same package
engine contract.

## Selecting a WASI flavor in Node.js

The root Node.js entry prefers a native addon. When native loading is
unavailable, it tries local WASI loaders and then installed flavor packages.
Within each group the default order is threaded (`wasm32-wasi`) and then
threadless (`wasm32-wasip1`).

Set `NAPI_RS_WASI_FLAVOR` to a generated flavor identity to select it through
the root package:

```sh
NAPI_RS_WASI_FLAVOR=wasm32-wasip1 node app.js
```

The selector enters the WASI path without requiring
`NAPI_RS_FORCE_WASI`, skips every other WASI flavor, and does not fall back to
a native addon if the selected flavor cannot load. This makes the result
deterministic when both optional flavor packages are installed, including
isolated pnpm and Yarn PnP layouts. Use `wasm32-wasi` to select the threaded
flavor. An unsupported value reports the flavor identities generated for that
package.

Without `NAPI_RS_WASI_FLAVOR`, existing behavior is unchanged.
`NAPI_RS_FORCE_WASI=true` prefers the default WASI fallback chain but retains a
lazy native fallback, while `NAPI_RS_FORCE_WASI=error` requires some generated
WASI flavor to load.

The root package exposes deferred workerd and Wasm entries. In a Workers
project built by Wrangler:

```js
import { createInstance, dispose, instantiate } from '<package>/workerd'
import wasmModule from '<package>/wasm.wasm'

const binding = await instantiate(wasmModule)
```

Prefer these root-package imports. They resolve through the root package's
optional dependency and work with isolated package-manager layouts such as
pnpm and Yarn PnP. The existing
`<package>-wasm32-wasip1/workerd`, `./wasm`, and `./wasm.wasm` flavor-package
exports remain available when that flavor package is installed directly.

Wrangler's built-in Wasm loader selects module handling from the import
specifier's `.wasm` suffix, so Workers projects should use the extensionful
`./wasm.wasm` export shown above. This ordinary default-import form is
Wrangler/bundler behavior, not a portable Node.js Wasm import.

Node.js 24 and later can load the same export as a `WebAssembly.Module` with a
source-phase import:

```js
import source wasmModule from '<package>/wasm.wasm'
import { instantiate } from '<package>/workerd'

const binding = await instantiate(wasmModule)
```

On older Node.js versions, or when source-phase imports are unavailable,
compile the exported bytes explicitly:

```js
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { instantiate } from '<package>/workerd'

const require = createRequire(import.meta.url)
const wasmPath = require.resolve('<package>/wasm.wasm')
const wasmModule = await WebAssembly.compile(await readFile(wasmPath))
const binding = await instantiate(wasmModule)
```

The packages also expose `./wasm` for bundlers that explicitly configure the
resolved file as a compiled `WebAssembly.Module`. Both Wasm aliases include
TypeScript declarations whose default export is `WebAssembly.Module`.

`instantiate()` owns a module-local singleton and deduplicates concurrent calls
for the same `WebAssembly.Module`. Call `dispose()` before replacing that
module. Calls that begin while disposal is in progress wait for it and create a
fresh singleton after cleanup succeeds. The deferred loader automatically
starts singleton disposal when Node.js emits `beforeExit`; a later listener
that calls `instantiate()` observes that state immediately and receives a
fresh singleton after cleanup rather than exports that are being destroyed. If
the first singleton is still initializing, cleanup waits for that initialization
to settle before destroying its context.
`createInstance()` creates an independent instance and returns
`{ exports, dispose }`; call and await the returned `dispose()` when that
instance is no longer needed. It consistently returns a promise, including
when emnapi cleanup completes synchronously. Independent instances are not
automatically disposed at
`beforeExit`, while initializing or after success, so retained exports remain
usable if a listener schedules more work; their cleanup ownership stays
explicit. The `./workerd` package export includes TypeScript declarations;
`exports` is typed from the addon's root package when napi-rs type generation is
enabled. Intentionally untyped packages expose it as
`Record<string, unknown>`, so strict TypeScript consumers can use the lifecycle
API without a broken import of the declaration-less root package. If
initialization fails and immediate context rollback also fails, the loader
retains that cleanup ownership so a later `beforeExit` pass can retry it.
`dispose()` still attempts those retained rollbacks when singleton cleanup
fails, while preserving the singleton error as the primary rejection.

`Context.destroy()` is synchronous in emnapi's public contract. The deferred
loader also contains nonconforming promise-like results defensively. Keep and
await the first `dispose()` promise. Direct instance-disposal recursion and
module lifecycle calls that re-enter from a pending module-owned destroy reject
with `ERR_NAPI_WASI_LIFECYCLE_REENTRY` instead of joining a promise cycle.
This guard lasts until a nonconforming async destroy settles; successful
independent-instance cleanup does not block singleton lifecycle calls.
Conforming synchronous emnapi cleanup coalesces concurrent `dispose()` calls.
Replacement `instantiate()` calls wait for the complete public cleanup,
including every retained failed-initialization rollback present before cleanup
finishes.

The eager CommonJS WASI loader keeps its emnapi context alive for the process
lifetime. Node.js can emit `beforeExit` repeatedly when a listener schedules
more work, and cached eager exports must remain usable after every such cycle.
For threaded targets, initialization owns every worker returned by
`onCreateWorker`. If initialization fails, the loader rolls the context back
while those workers remain alive so the Rust runtime can quiesce, then starts
each remaining worker's termination exactly once after cleanup settles.
At the actual `exit` event, the loader makes one synchronous best-effort
`Context.destroy()` call so emnapi's synchronous cleanup queue can run.
Consumers that need deterministic cleanup before process exit should use the
deferred loader and call its `dispose()` function, or the `dispose` returned by
`createInstance()`.

When type generation is disabled, the generated browser root exposes the
binding as its default export. `napi new` also removes the template's
`index.d.ts` and declaration metadata instead of publishing stale template
types.

The deferred loader accepts only a precompiled `WebAssembly.Module`. It does
not fetch or compile bytes at runtime.

Generated WASI packages intentionally omit npm's `cpu` and `os` fields. The
module runs inside the host process, so `wasm32` or host-OS restrictions would
make npm reject a direct install or skip the optional dependency on otherwise
supported hosts.

`napi.wasm.initialMemory` is measured in 64 KiB WebAssembly pages. The regular
Node and browser loaders retain the historical 4,000-page (250 MiB) default.
The deferred `./workerd` loader defaults to 1,024 pages (64 MiB), leaving
headroom under workerd's 128 MiB isolate limit. An explicit
`napi.wasm.initialMemory` value applies to every loader, so keep it within the
target isolate's limit after measuring the addon's actual requirements.
