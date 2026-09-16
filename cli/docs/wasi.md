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

## Identifying the loaded artifact

Every generated loader exports `__napiBindingTarget`, a string naming the
artifact that actually loaded:

| value             | artifact                   |
| ----------------- | -------------------------- |
| `'native'`        | a `.node` addon            |
| `'wasm32-wasi'`   | the threaded WASI flavor   |
| `'wasm32-wasip1'` | the threadless WASI flavor |

The WASI values are the same flavor identities `NAPI_RS_WASI_FLAVOR` accepts,
so a pinned flavor round-trips:

```js
process.env.NAPI_RS_WASI_FLAVOR = 'wasm32-wasip1'
const binding = require('<package>')
binding.__napiBindingTarget // 'wasm32-wasip1'
```

Remember that `wasm32-wasi` is the _threaded_ flavor; see the target aliases at
the top of this page.

The root Node.js entry sets the value from the fallback candidate it resolved,
not from anything the WASI loader reports, so it is correct even for a loader
that fails to initialize its own exports. The one exception is
`NAPI_RS_NATIVE_LIBRARY_PATH`: that override can point at a generated WASI
loader, so the root entry adopts the `__napiBindingTarget` the required module
reports and falls back to `'native'` when it reports none.

Each flavor's own loaders (the CommonJS loader, the browser loader and the
deferred `./workerd` loader) carry their own fixed flavor identity, and they
carry it on the binding object they hand out — not only as a module export. So
the browser loader's default export, `instantiate()`'s result and
`createInstance().exports` all answer `__napiBindingTarget`, which is what the
generated declarations promise:

```js
import { instantiate } from '<package>/workerd'
const binding = await instantiate(wasmModule)
binding.__napiBindingTarget // 'wasm32-wasip1'
```

An addon that seals or freezes its exports in a `#[napi(module_exports)]` hook
makes the loader skip the stamp on the binding object rather than fail the load,
and what survives that skip follows the entry point. The browser and the
deferred `./workerd` entries go on reporting the flavor from their module-level
`__napiBindingTarget` export; only the copy on the binding object they hand out
is missing. The CommonJS entries hand back the binding object itself as
`module.exports`, so there `__napiBindingTarget` reads `undefined` —
deliberately, because failing an otherwise successful load over a metadata
string is the worse trade.

The CommonJS loaders assign the stamp helper's return value
(`module.exports.__napiBindingTarget = __napiStampBindingTarget(...)`) rather
than calling it as a statement, so `cjs-module-lexer` — Node's CommonJS-to-ESM
named export detection — keeps seeing the name and
`import { __napiBindingTarget } from '<package>'` goes on working. On a frozen
binding the import still links; the value is `undefined`, matching the skipped
stamp.

Each loader stamps exactly once, and always in the same place: after the async
runtime hosts are installed — addon registration functions get the exports
object first, so the guard reads its final state — and inside the initialization
guard, so a conflict fails the load through the rollback rather than past it.
The CommonJS loaders additionally assign onto their own `module.exports` rather
than onto the addon's object, which leaves an addon accessor with a refusing
setter untouched; the root entry stamps before it aliases the binding, for the
same reason.

The name is reserved by the builds that emit a loader. `napi build` rejects an
export of that name it can see in the type-def metadata, but only when this
build writes a loader to carry it — a root loader (`--platform` without
`--no-js`), or a WASI flavor loader set. A plain `.node` build writes neither,
declares nothing, and is free to export the name itself. A name attached
dynamically from a `#[napi(module_exports)]` hook is invisible at build time, so
the loader rejects it at load with `ERR_NAPI_BINDING_TARGET_CONFLICT` instead of
silently overwriting it. In a WASI loader that rejection happens inside the
initialization boundary, so the conflict rolls the environment back — no
emnapi context and no `'exit'` listener survive the failed `require()`.

Use it to branch on capabilities a native addon has and a WASI build does not
(worker threads, blocking calls, host timers) without probing:

```js
if (binding.__napiBindingTarget !== 'native') {
  // running on WebAssembly
}
```

When napi-rs type generation is enabled the export is declared in the generated
declaration files, so the check narrows in TypeScript. Which type a declaration
gives it follows the entry it types:

- The **root entry**'s declaration is a literal union of `'native'` and every
  WASI flavor napi-rs can build, not only the flavors the package itself
  builds. `NAPI_RS_NATIVE_LIBRARY_PATH` can point the root entry at any
  generated WASI loader, so even a package that ships only a native addon can
  report a WASI flavor, and a narrower union would reject comparisons the
  override can actually reach.
- A **flavor's own** declaration — the CommonJS and browser `.d.cts` and the
  deferred `./workerd` `.d.ts` alike — is that one flavor's exact literal. Those
  loaders bake their flavor in at generation time and read no override, so a
  consumer importing a fixed artifact narrows to a single value, which is what
  the generated declarations promise above.

Both bullets describe an extensible binding. For a sealed or frozen addon the
root **CommonJS** entry reports `undefined` at runtime — the skipped stamp
above — which its declaration does not admit. The root ESM entry is unaffected,
because there the export is a module-level binding the loader never stamps. A
flavor's own `.d.cts` literal is not exposed either: that loader publishes its
`Symbol.dispose` implementation with `Object.defineProperty` before it stamps,
and `Object.defineProperty` throws on a non-extensible object, so a sealed or
frozen addon fails that load well before the stamp is reached.

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
`{ exports, memory, memoryBytes, disposed, dispose }`; call and await the
returned `dispose()` when that instance is no longer needed. It consistently
returns a promise, including when emnapi cleanup completes synchronously.
`memoryBytes` is that instance's current linear-memory size and reads `0` once
disposal has completed — it is declared address space, not a host's
committed-memory metric, so compare it against platform telemetry rather than
treating it as a quota. Independent instances are not
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
fails, while preserving the singleton error as the primary rejection. The
deferred loader also exports `__napiBindingTarget` (see "Identifying the loaded
artifact"), typed as its exact flavor.

A second argument to `createInstance()` selects that instance's linear memory:

```js
const instance = await createInstance(wasmModule, {
  initialMemoryPages: 1024,
  maximumMemoryPages: 65536,
})
```

or hand it one you allocated yourself:

```js
const memory = new WebAssembly.Memory({ initial: 1024, maximum: 65536 })
const instance = await createInstance(wasmModule, { memory })
```

`memory` and the page options are mutually exclusive. The generated
declaration models that as a union — `WasiInstanceOptions` is
`WasiCallerMemoryOptions | WasiAllocatedMemoryOptions`, each form declaring the
other form's properties as `never` — so TypeScript rejects an option bag mixing
the two before the loader throws. Page counts go straight to
`new WebAssembly.Memory`, so the engine's own bounds and messages apply. A
caller-provided `WebAssembly.Memory` must be unshared — this loader has no
threads, and shared growth does not detach, so external views handed to the
addon would silently outlive the bytes they describe — and it must come from the
**loader's own realm**. The layers underneath it (`WASI.setMemory` in
`@napi-rs/wasm-runtime`, and emnapi) identify a Memory with a realm-local
`instanceof`, so a genuine Memory built in a `node:vm` context or another frame
is rejected up front with a `TypeError` rather than failing somewhere inside
initialization.

Every Memory an instance runs on is **single-use**, the one the loader allocates
for you included: once a validated initialization attempt begins, passing the
same Memory again throws, including after that attempt fails, after the instance
is disposed, and when it is the `memory` a previous handle published. A failed
initialization may already have written into linear memory, so those bytes are
not a clean slate, and two live instances on one Memory would each overwrite the
emnapi and WASI state the other is still running on. A rejected option bag — a
foreign Memory, a shared one, `memory` together with the page options — claims
nothing, so the same Memory is still usable once the call is corrected. The
claim is tracked per evaluated loader module; two independently bundled copies
of the loader in one isolate do not see each other's claims.

`WASM_MEMORY` exports the descriptor compiled into the loader — `initialPages`,
`maximumPages`, `pageBytes`, `initialBytes`, `maximumBytes` — so a caller can
size its own Memory from it. `getDeferredRuntimeStats()` reports
`{ createdInstances, liveInstances, declaredInitialMemoryBytes }` for instances
created by that loader module evaluation, not process-wide; `liveInstances`
drops when an instance's `dispose()` resolves, so a `dispose()` that throws
leaves it counted and retryable.

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

Every termination goes through the emnapi thread manager
(`PThread.terminateWorker`) rather than a bare `worker.terminate()`. The manager
counts a worker exit as expected only for terminations it performed itself and
reports any other one as a worker failure — a throw that lands inside Node.js's
`exit` emit and strands the promise the termination depends on. The manager is
captured while the emnapi module is being created, before the wasm is loaded, so
it is reachable even from the initialization rollback — the one path where
instantiation never returned.

Disposal holds the event loop open with a timer of its own until the
terminations settle, so `await dispose()` resolves even as the last statement of
a script. The pool workers cannot do that themselves: they are unreferenced so
an idle binding never keeps a process alive, and emnapi unreferences them again
whenever one reports that its thread is ready. The timer is released the moment
the terminations settle, and a binding that is never disposed still does not
hold an idle process open.

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
  independent instances never share or cancel each other's registrations. It
  imports them from the `@napi-rs/async-runtime/workerd` subpath rather than the
  package root: the root entry also pulls in the Node-lane relay
  (the realm-global installation registry and its timer-handle bookkeeping),
  which a worker bundle never runs and which a CommonJS entry cannot be
  tree-shaken out of. Both entries are equally isolate-safe — neither touches a
  `node:` builtin or `process` — so the subpath is purely about bundle size.
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

`napi.wasm.threadlessInitialMemory` overrides that value for the threadless
(`wasm32-wasip1`) loaders only — the Node CJS loader, the browser loader, and
the deferred `./workerd` loader. The two flavors want different floors:

- The threaded loader allocates one `shared: true` memory and hands it to every
  wasi-threads worker, so every worker stack and every thread's allocations are
  carved out of it and growing it is a cross-thread event. Browser builds
  pre-create `asyncWorkPoolSize + hardwareConcurrency` workers, so this is
  sized for the whole pool up front.
- The threadless loader has one thread and a plain growable `ArrayBuffer`. Its
  only hard floor is the module's own `env.memory` minimum — the link-time
  `-zstack-size` plus static data, both fixed by `napi-build` — and it grows on
  demand. That is what lets the same addon fit a host with a hard isolate cap.

```json
{
  "napi": {
    "wasm": {
      "initialMemory": 16384,
      "threadlessInitialMemory": 1027,
      "maximumMemory": 65536
    }
  }
}
```

Without the key the threadless loaders keep following `napi.wasm.initialMemory`,
so nothing changes for an existing project.

Both values must be integers in `1..=65536` pages — memory32 tops out at 4 GiB,
which is also the `--max-memory` the WASI link uses — and neither may exceed
`napi.wasm.maximumMemory`. `napi build` fails the WASI target otherwise. An
`initial` _below_ the module's own `env.memory` minimum is **not** caught by the
CLI: it surfaces as a `LinkError` at instantiation, so re-measure whenever the
addon's static data or stack size grows.

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
