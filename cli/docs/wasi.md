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

Every generated loader shadows `destroy` on the emnapi context it creates, so
`napi_prepare_wasm_env_cleanup` runs before the environment stops accepting
JavaScript calls even when `destroy()` is invoked directly — by an embedder
holding the context, by a test harness, or by emnapi's `beforeExit` auto-destroy
on a host where `suppressDestroy()` is unavailable. The shadow is best-effort: a
context whose `destroy` cannot be read or redefined is used unchanged. It does
not replace `dispose()`, which additionally yields event-loop turns until
`napi_wasm_env_cleanup_pending` reports zero; a direct `destroy()` still cannot
wait for a settlement produced on another thread.

The barrier settles the promises it cancels synchronously, so a promise hook
(`node:v8` `promiseHooks`, or the `async_hooks` hook `AsyncLocalStorage`
installs) can run while it is still in flight. A `destroy()` called from such a
hook is a no-op — the frame that started the barrier destroys as soon as it
returns, and `Context.destroy()` returns `void`, so nothing observable is lost.

`dispose()` is the one frame that does not destroy the moment the barrier
returns: it yields for the settlement drain first. So a `dispose()` called from
such a hook joins the disposal already running instead of starting a second
one — every loader publishes its disposal promise before the barrier runs. A
second frame would otherwise reach the context destroyer while the first is
still parked in its drain, and the no-op above would be recorded there as a
completed destroy, leaving the context retained with its cleanup hooks unrun.

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

Because nothing gates the install, the root package does not declare the WASI
package in `optionalDependencies` when native targets are also configured. npm
evaluates every `optionalDependencies` entry independently, so a declared WASI
package is downloaded by every consumer, including the ones that already
resolved a native package and will never load the `.wasm` binary. The generated
binding loader picks WASI at require time instead, and environments without a
native package are expected to install it on demand.

When WASI is the only configured target it is the primary artifact rather than a
fallback, so it is declared by default. Set `napi.wasm.optionalDependency` to
override the default in either direction:

```json
{
  "napi": {
    "wasm": {
      "optionalDependency": true
    }
  }
}
```

## Shared async runtime hosts

`CurrentThread` is the only async-runtime flavor on WebAssembly, for both
`wasm32-wasip1` and `wasm32-wasip1-threads`. An addon built with the
`napi-async-runtime` crate therefore makes no progress until a JavaScript task
host publishes its runnable turns, and its timers never fire until a timer host
relays them. Set `napi.wasm.asyncRuntime` and the generated loaders install
both for you:

```json
{
  "napi": {
    "wasm": {
      "asyncRuntime": true
    }
  }
}
```

This affects WASI output only. Native `.node` bindings run the `MultiThread`
flavor on real threads and need no JavaScript host.

With the flag on:

- The Node CommonJS and browser loaders call
  `installCurrentThreadHosts(exports)` from `@napi-rs/async-runtime` right after
  instantiation, and unregister both hosts before the emnapi context is
  destroyed — on `dispose()`, on the initialization rollback, and at process
  `exit`.
- The deferred `./workerd` loader registers one task host and one timer host
  **per instance** (`registerWorkerdCurrentThreadTaskHost` /
  `registerWorkerdTimerHost`) and disposes them with that instance, so
  independent instances never share or cancel each other's registrations.
- The generated `<packageName>-wasm32-*` packages declare
  `@napi-rs/async-runtime` as a dependency. Add it to your own
  `devDependencies` so local `napi build` output can load.

`napi pre-publish` requires that dependency in every WASI package whose loaders
import it, so a project that turned the flag on after scaffolding must rerun
`napi create-npm-dirs` — the root `devDependencies` entry hides a stale
manifest locally, but consumers of the published package would fail at load.

Detection is done at runtime against the instantiated module:
`@napi-rs/async-runtime` reads the seven host exports off the binding, checks
the task-host contract version (`4`), validates the reservation identity and
the liveness probe, and rolls back every registration it created if any step
fails. A binding that does not actually expose the contract therefore fails at
load with `ERR_NAPI_ASYNC_RUNTIME_BINDING_MISMATCH` rather than hanging later.

`napi build` cross-checks the flag against the same seven names up front, but it
reads them from the type definitions, so the check needs the `type-def` feature
of `napi-derive`. Without it there is no export list to check against: the build
prints a warning and leaves the verdict to the runtime detection above.

The bootstrap runs after instantiation, so it runs after `#[module_init]` and
any other Rust code that executes during module registration: the host
registration functions are exports of the binding itself and do not exist
before registration completes. Code that runs during registration must not
create timers (`sleep_until` fails loud at creation when no timer host is
registered) and cannot expect task progress until the loader has returned.
Register the runtime backend there; create tasks and timers from exports that
run later.

The flag itself is still needed because the loaders `import` the package with a
bare specifier: bundlers resolve static imports at build time, so an optional
one is not expressible. Leave it unset and every generated loader is byte-for-
byte what earlier CLI versions produced.

Only the loader's own thread is bootstrapped. WASI worker threads
(`wasi-worker.mjs`, `wasi-worker-browser.mjs`) instantiate the module with
`childThread: true` and do not register a host.

`napi build` cross-checks the flag against the addon's real export list: it
fails when the flag is set but the host exports are missing, and warns when the
exports are present but the flag is not set.

`napi.wasm.initialMemory` is measured in 64 KiB WebAssembly pages. The regular
Node and browser loaders retain the historical 4,000-page (250 MiB) default.
The deferred `./workerd` loader defaults to 1,024 pages (64 MiB), leaving
headroom under workerd's 128 MiB isolate limit. An explicit
`napi.wasm.initialMemory` value applies to every loader, so keep it within the
target isolate's limit after measuring the addon's actual requirements.

Threaded browser loaders always pre-create a pool of wasi-threads workers at
module initialization, sized as `asyncWorkPoolSize + hardwareConcurrency`
(logical cores, floored at 2, with a fallback for privacy-fuzzed values),
and therefore always initialize asynchronously. The `asyncWorkPoolSize`
reservation is included because emnapi's async-work pool draws its workers
from the same reuse pool; without it, async work could starve the pool
before addon thread spawns. This is what allows addon Rust code to spawn
threads from inside a blocking call: a browser cannot start a worker until
the blocking thread returns to its event loop, so a thread spawned mid-call
would never boot and the caller would deadlock waiting for it. With a
pre-created pool, spawning is only a message to an already-running worker,
and if the pool is exhausted the fallback allocates a fresh worker that
boots once the spawning parent returns to its event loop.
