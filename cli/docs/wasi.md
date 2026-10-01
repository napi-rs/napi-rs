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

`CurrentThread` is the default async-runtime flavor on every WebAssembly
target, and the only flavor on threadless `wasm32-wasip1`. On
`wasm32-wasip1-threads` an addon may select `MultiThread` instead — always an
explicit host act, never a default (see the crate's "Running MultiThread on
`wasm32-wasip1-threads`" section).

A `CurrentThread` addon built with the `napi-async-runtime` crate makes no
progress until a JavaScript task host publishes its runnable turns, and its
timers never fire until a timer host relays them. Set `napi.wasm.asyncRuntime`
and the generated loaders install both for you:

```json
{
  "napi": {
    "wasm": {
      "asyncRuntime": true
    }
  }
}
```

This affects WASI output only. Native `.node` bindings default to the
`MultiThread` flavor on real threads and need no JavaScript host.

Keep the flag on even for a `wasm32-wasip1-threads` addon that configures
`MultiThread`. The loaders cannot see the flavor, so they install both hosts
unconditionally — and a `MultiThread` runtime never uses either: its futures
run on the Rayon pool instead of published host turns, and its timers come from
the executor-owned heap plus a timekeeper thread. The installed task host is an
unref'd threadsafe function, so it does not hold the event loop open. That is
what lets one artifact choose its flavor at runtime.

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

## Thread pool preload

The threaded Node loader (`<binary>.wasi.cjs`) creates its emnapi worker pool
empty (`reuseWorker: true`): emnapi's own preload (`reuseWorker.size > 0`)
cannot run on a synchronous CommonJS load. Without help, every pool thread a
`MultiThread` runtime spawns on its first async call would first boot a Worker
and load the wasm into it.

An addon built with `napi-async-runtime` exports
`napi_wasm_runtime_pool_workers() -> u32` on `wasm32-wasip1-threads`: the
configured `MultiThread` `worker_threads`, or 0 under `CurrentThread` (also the
wasm default before any configure). It reads an atomic and takes no lock, and
it comes with the scheduler, so `default-features = false` builds have it too.
The loader keeps that many Workers idle in the pool:

- once, right after a successful load (after `#[module_init]` configured the
  runtime);
- after every successful `configureAsyncRuntime`, when `napi.wasm.asyncRuntime`
  is on. The loader replaces that export with a wrapper (same name, `this`,
  arguments and return value) that calls the original and then reconciles. It
  is matched by name, like the host install above. A configure that throws
  (for example because the runtime already started) propagates and leaves the
  pool alone;
- whenever you call
  `binding[Symbol.for('napi.rs.wasi.reconcileThreadPool')]()`, published
  non-enumerable and read-only next to the dispose symbol. Use it after
  changing the configuration some other way.

A reconcile creates each missing Worker through `onCreateWorker` (so it is
tracked, unref'd and gets the crash flags) and starts its load without waiting
for it; a thread spawn later pops a Worker that is already booting. It
terminates the idle Workers above the count, newest first, the way a spawn
takes them. Workers a spawn already took are not in the pool and are left
alone, so the count only covers idle Workers. A reconcile never throws and
never waits. It does nothing after a thread crash, once disposal started, or
for an addon without the export.

Two things to know:

- A preloaded Worker that fails to load still latches the binding as crashed,
  like any pool Worker: the worker cannot tell a preload from a thread spawn,
  so `dispose()` rejects afterwards. This is by design. The failed Worker is
  taken out of the pool, so a later spawn creates a fresh one.
- `NAPI_RS_ASYNC_WORK_POOL_SIZE` (or `UV_THREADPOOL_SIZE`, default 4) sizes the
  uv async-work threads, which take their Workers from the same reuse pool. A
  preloaded Worker can therefore end up running a uv thread instead of a
  runtime thread; the runtime thread then creates its own.

The browser loaders keep their fixed pre-created pool (see above), and the
threadless and deferred loaders have no pool.

## Detecting the threaded target from Rust

rustc gives you nothing to tell the two WASI targets apart. `rustc --print
cfg` emits an _identical_ set for `wasm32-wasip1` and
`wasm32-wasip1-threads` — same `target_arch`, same `target_os`, same
`target_env = "p1"` — and `target_feature = "atomics"` is set for neither,
because the wasm `atomics` feature is still unstable and the stable channel
keeps unstable target features out of the cfg set
([rust-lang/rust#77839](https://github.com/rust-lang/rust/issues/77839)).
Passing `-C target-feature=+atomics` does not change that: rustc warns that
the feature is unstable and the cfg still does not appear. Only the exact
cargo `TARGET` answers the question, and only a build script can read it.

An addon crate gets the answer for free. `napi_build::setup()` emits
`cfg(napi_wasi_threads)` when — and only when — the crate is being compiled
for `wasm32-wasip1-threads`, so the addon can write:

```rust
#[cfg(napi_wasi_threads)]
const WORKERS: usize = 4;
#[cfg(not(napi_wasi_threads))]
const WORKERS: usize = 1;
```

`setup()` also prints the matching `cargo::rustc-check-cfg` line on _every_
target, so `#[cfg(napi_wasi_threads)]` is a known cfg everywhere and never
trips the `unexpected_cfgs` lint on the targets where it is not set.

A build-script cfg is crate-local: it reaches the crate whose `build.rs`
printed it and nothing else. Another crate in the same graph that needs the
distinction therefore needs its own build script — which is why `napi` and
`napi-async-runtime` each carry one:

```rust
// build.rs
fn main() {
  println!("cargo::rustc-check-cfg=cfg(my_wasi_threads)");
  if std::env::var("TARGET").as_deref() == Ok("wasm32-wasip1-threads") {
    println!("cargo::rustc-cfg=my_wasi_threads");
  }
}
```

Use the older single-colon `cargo:` form if the crate's `rust-version` is
below 1.77.

Absence has to be the conservative branch. The cfg is permission to use
shared memory and real threads, never a requirement that something be
configured: a plain `cargo build`, `cargo test`, or rust-analyzer run — no
`napi build`, no CLI, no `RUSTFLAGS` — must still compile a correct crate on
the `not(...)` side. Nothing outside the build script can set it, so a
mistake there is silent.

### Third-party locks

`parking_lot_core`, the lock core under `parking_lot` and `dashmap`, does not
follow this rule, and an addon can pull it in without ever naming it. Its
only threaded-wasm parker is gated on the crate's `nightly` feature _and_
`target_feature = "atomics"` (0.9.12, `src/thread_parker/mod.rs:69`), so on
stable the cascade falls through to the wasm stub, whose `prepare_park` is
`panic!("Parking not supported on this platform")`
(`src/thread_parker/wasm.rs:26`). The build succeeds and the addon dies at the
first _contended_ lock, on a target whose `std` has fully working threads.

Upstream
[Amanieu/parking_lot#529](https://github.com/Amanieu/parking_lot/pull/529)
adds a `std::sync::Mutex` and `Condvar` parker for WASI, but its selection arm
keys on `target_feature = "atomics"` as well, so it cannot be reached on
stable either. Until that is resolved there are two options:

- Keep `parking_lot` and `dashmap` out of the `wasm32-wasip1-threads`
  dependency graph, or
- route the whole graph through a `parking_lot_core` that detects the triple
  in its own `build.rs`, exactly as above. napi-rs maintains that fork and
  publishes it as `lock_api-napi` 0.4.15, `parking_lot_core-napi` 0.9.13 and
  `parking_lot-napi` 0.12.6; each keeps the upstream `[lib] name`, so
  `use parking_lot::Mutex` still compiles. A transitive user such as
  `dashmap` is only reachable through `[patch.crates-io]`, and the only
  form cargo accepts is a git pin on the fork's `wasi-threads-parker`
  branch, which still carries the _upstream_ package names. Pin the exact
  revision rather than the branch, so the lock stays reproducible:

  ```toml
  [patch.crates-io.parking_lot_core]
  git = "https://github.com/napi-rs/parking_lot"
  rev = "ac046ba44e72159e90e36b7323b1058ba1d48ad2"
  ```

  The published `*-napi` crates cannot be named in such an entry. Cargo
  rejects a crates.io package replacing another crates.io package, because
  a patch must point to a different source:

  ```toml
  [patch.crates-io]
  parking_lot_core = { package = "parking_lot_core-napi", version = "0.9.13" }
  ```

  ```text
  error: patch for `parking_lot_core-napi` points to the same source, but
  patches must point to different sources
  ```

  Over a path or git source the entry resolves, and is then dropped. Cargo
  does honour `package =` — it selects that package from the replacement
  source — but the selected package keeps its own name, and a dependency on
  `parking_lot_core` is satisfied only by a package named
  `parking_lot_core`. The fork's `master` carries the renamed manifests
  (`name = "parking_lot_core-napi"`), so pointing the rename at it gives:

  ```toml
  [patch.crates-io.parking_lot_core]
  git = "https://github.com/napi-rs/parking_lot"
  rev = "e243c6c43832c151bce2887fcb209b5b8b72ac61" # master
  package = "parking_lot_core-napi"
  ```

  ```text
  warning: patch `parking_lot_core-napi v0.9.13 (…?rev=e243c6c4…)` was not
  used in the crate graph
  ```

  The lock then records it under `[[patch.unused]]` and `dashmap` keeps
  building against stock `parking_lot_core` 0.9.12 — the panicking parker.

Verified on the patched core: a contended probe under `wasmtime run -S
threads` — `Mutex`, `Condvar`, `RwLock`, `park_until`, `notify_all`, `DashMap`
— reports `ALL OK` with zero parking stubs left in the module, and rolldown's
threaded WASI artifact passed its stability lane 3 of 3.

## Shared memory growth on `wasm32-wasip1-threads`

Every thread of a threaded WASI addon runs on one shared `WebAssembly.Memory`.
V8 updates that memory's size only on the thread that grew it. Every other
thread keeps checking `memory.fill`, `memory.copy` and atomics against its old
size until it handles V8's grow interrupt, and on a host without V8's wasm trap
handler (`--disable-wasm-trap-handler`, or `--wasm-enforce-bounds-checks`) it
checks every load and store that way. Such a thread traps with `memory access
out of bounds` on heap pages another thread just grew. V8 fixed this in
[v8/v8@3424101](https://github.com/v8/v8/commit/34241014663390c72e08c123faef6fedf395be8e);
napi-rs works around it until the hosts it supports ship that fix.

The workaround is on for every addon built for exactly `wasm32-wasip1-threads`
with `napi` and `napi_build::setup()`. There is nothing to call or configure:

```text
malloc / free / calloc / realloc / ...   (Rust's System, wasi-libc, emnapi's `malloc` export)
  -> napi's __wrap_* (napi-build links with --wrap)
       LOCK (spin; sched_yield every 64 spins; never memory.atomic.wait)
         another thread saw a larger memory? memory.grow(0)   refresh this thread
         dlmalloc
           -> __wrap_sbrk: the reserve first, else grow >= 16 MiB,
                           refresh and publish the new size
       UNLOCK

task poll, block_on poll, blocking closure      (napi-async-runtime)
AsyncTask compute, AsyncRuntimeTask poll,       (napi)
napi's default Tokio runtime and spawn_blocking
  -> another thread saw a larger memory? memory.grow(0)   one atomic load + one thread-local load
```

- **The allocator lock.** `napi_build::setup()` links with `--wrap` for the 10
  entries of wasi-libc's dlmalloc and for `sbrk`, so every allocation reaches a
  `__wrap_*` function in `napi`. It takes one lock, refreshes the thread's size
  when another thread has seen a larger memory, and runs the real call. The
  thread that grows the memory publishes the new size before it unlocks, so
  every thread is current before dlmalloc touches a byte for it. The lock also
  covers calloc's zero fill and realloc's copy, and C code that calls `sbrk`
  itself takes it too. It spins like dlmalloc's own lock, so it is safe on a
  browser main thread, where `memory.atomic.wait` traps.
- **The handoff refresh.** Memory can reach a thread without an allocation
  there: a task that allocated on one thread resumes on another, or a closure
  runs on a pool thread. `napi-async-runtime` and napi's own cross-thread
  entries check the size before they run such work.
- **The heap break.** dlmalloc first uses the pages between the module's own
  memory and the memory the loader created (`napi.wasm.initialMemory`): they
  exist on every thread from the start, so they never need a refresh, and
  nothing grows until they are used. Past them it only uses pages it grew
  itself, at least 16 MiB at a time, so pages another allocator grew never
  reach dlmalloc. The heap never reaches 2 GiB: an allocation that would pass
  it fails. Node's `node:wasi` (v24 and later) answers `EINVAL` to
  `clock_time_get` and `fd_seek` when a pointer is at or above 2 GiB.

The threaded `.wasm` exports `malloc` and `free` as before (`@emnapi/core`
calls them); they now go through the lock. It also exports the 11 `__wrap_*`
functions, `napi_wasm_heap_sync_stat`, `napi_wasm_thread_crashed` and
`napi_wasm_thread_crash_flag_address`, because Rust exports every
`#[no_mangle]` function of a cdylib. They are not an API.
The threadless `wasm32-wasip1` artifact has none of this.

The addon's `napi-build` must be the same package as `napi`'s own
build-dependency (a path or git `napi` needs `napi-build` from the same
checkout). With two copies, the addon's `setup()` does not wrap the allocator,
and the link fails with an undefined symbol,
`napi_wasi_heap_sync_needs_napi_build_setup_with_wasi_heap_sync`.

### Test counters

`napi_wasm_heap_sync_stat(index)` returns one counter as a `u32`. It is for
tests and diagnosis; `examples/wasi-heap-sync/stress.mjs` and rolldown's
threaded stress test read it by index, so an index keeps its meaning.

| index     | value                                                                                       |
| --------- | ------------------------------------------------------------------------------------------- |
| 0         | heap growths: `memory.grow(n > 0)` calls by `__wrap_sbrk`                                   |
| 1         | refreshes after taking the lock (including each thread's first)                             |
| 2         | blocks that ended past the thread's refreshed size when dlmalloc returned them; must stay 0 |
| 3         | the heap break, in pages (rounded up); 0 before the first `sbrk`                            |
| 4         | `__heap_end` (where the break starts), in pages; 0 before the first `sbrk`                  |
| 5         | refreshes at handoffs (napi-async-runtime and napi's cross-thread entries)                  |
| any other | `u32::MAX`                                                                                  |

With the loader's default memory a small load reads 0 at index 0: the heap fits
in the reserve and never grows.

### Cost

Measured in rolldown on its copy of this code, before napi-rs took it over:
the same lock and break. napi's copy adds the check that keeps other
allocators' pages out of the break, and keeps the shared size in a cache line
of its own. Release wasm, Node 24.21 on arm64, 10 interleaved rounds, medians
in ms:

| load                              | before the lock | with the lock | cost |
| --------------------------------- | --------------- | ------------- | ---- |
| MultiThread, 16 builds            | 310.5           | 334.5         | 8%   |
| MultiThread, 16 builds, JS plugin | 1518            | 1589.5        | 5%   |
| MultiThread, parse 16x3           | 218.5           | 241           | 10%  |
| CurrentThread, parse 16x3         | 216.5           | 240.5         | 11%  |
| CurrentThread, transform 16x3     | 623.5           | 640           | 3%   |

"Before the lock" already grew the heap at least 16 MiB at a time. That part
of the workaround had made the same loads 1.6-3.2x faster than growing in
dlmalloc's own small steps (transform: no change), and the lock keeps most of
that gain. The handoff check alone measured at noise level. Other workloads,
x64, Linux, Windows and browsers are not measured.

### Opting out

Pass `--cfg napi_wasi_no_heap_sync` in the target rustflags, for example
`RUSTFLAGS="--cfg napi_wasi_no_heap_sync" napi build --target
wasm32-wasip1-threads`. `napi` then leaves out the wrappers and its handoff
checks, and `napi-build` leaves out the `--wrap` link arguments; both read the
same cfg, so they cannot come apart. `napi-async-runtime`'s check stays, but it
never fires: nothing publishes a larger size. `napi_build::setup()` declares
the cfg, so addon code can test `#[cfg(napi_wasi_no_heap_sync)]` too. Without
the workaround the trap above comes back on hosts without the V8 fix.

### What it does not cover

- A `#[global_allocator]` that calls `memory.grow` itself (mimalloc's WASI
  build, talc, lol_alloc, the `dlmalloc` crate) is not locked, and its growth
  is never published. One that ends in libc `malloc`, like std's `System`, is
  locked.
- Memory that reaches a running thread mid-poll (a channel message, an `Arc`)
  and is touched there before that thread's next allocation or handoff, after
  another thread grew the memory. Below the reserve nothing grows. A
  threadsafe-function call, deferred or async work delivered on the JavaScript
  thread is covered: between taking it off its queue and calling back into the
  module, emnapi runs JavaScript frames (`napi_open_handle_scope`,
  `napi_get_reference_value`, `emnapi_is_node_binding_available`,
  `_emnapi_callback_into_module`), and a JavaScript frame handles V8's grow
  interrupt. What remains there is emnapi's own read of the queue node in C, on
  hosts without the trap handler.
- Work on threads the addon starts or runs itself: a runtime passed to
  `create_custom_tokio_runtime`, direct `tokio::task::spawn_blocking` calls,
  and a host's own threads outside `napi-async-runtime`'s scheduler.
- A thread that crashes while it holds the lock leaves the others spinning, as
  a crash inside dlmalloc's own lock always did.

## Shutdown polls never wait

A loader's `dispose()` runs the environment cleanup in two phases with a poll
between them: `napi_prepare_wasm_env_cleanup_begin`, then
`napi_wasm_runtime_work_pending` once per event-loop turn until it answers 0,
then `napi_prepare_wasm_env_cleanup_finish`. The poll never blocks, and that
includes locks: when a lock the answer is read under is held by another
thread, it answers 1 and the loader polls again on its next turn. On
`wasm32-wasip1-threads` a thread that traps unwinds nothing, so a lock it held
stays held; a poll that waited for it would park the JavaScript thread in
`memory.atomic.wait32` for good, before the loader can see the crash. A custom
`AsyncRuntime` backend must keep the same rule in `shutdown_work_pending`. The
process-exit teardown has no turns to give and makes the single blocking call,
`napi_prepare_wasm_env_cleanup`.

The two phases themselves may wait. With `napi-async-runtime` on
`wasm32-wasip1-threads` they wait in 1 ms slices on the JavaScript thread, and
between slices read the addon's crash flag: one 4-byte word in the shared wasm
memory. Once it is set, the next slice traps, and the loader reports the crash
instead of hanging.

The generated worker sets that word itself, with `Atomics.store`, so it needs
no wasm instance:

```
loader thread                            pool worker
─────────────                            ───────────
instantiate; in beforeInit:
  napi_wasm_thread_crash_flag_address()
  view = Int32Array(memory, address, 1)
spawn → Worker({ workerData: {           load → start → run
  crashFlag, crashReport,                  ...
  addonCrashFlag: view } })              dies (trap, error, failed load):
  ...                                      write crashReport
cleanup waits in slices ◄──────────────    Atomics.store(crashFlag, 1)
  view word is 1 → trap                    Atomics.store(addonCrashFlag, 1)
catch → crash rejection                    emnapi's own error report
```

- The Node worker gets the view in `workerData`. The browser worker gets it by
  `postMessage`: the browser pool is created before the wasm is instantiated,
  so the loader posts it to each pool worker after `beforeInit`, and to a
  worker created later right away.
- The loader's crash flag always goes up first, so when the trap reaches the
  loader it already sees the crash.
- A worker whose own setup throws (`@napi-rs/wasm-runtime` cannot be
  resolved, say) raises both flags too, then fails as before.
- A worker that fails while it loads — after the thread spawn that created it
  already returned — raises the flag the same way. `napi_wasm_thread_crashed`,
  which stores into the same word, is only the fallback for a worker that has
  an instance but no view.
- An addon built with an older napi has no address export: the loader passes
  no view, and the waits stay unbounded, as before.

What still cannot raise the flag: a worker that fails before any of its own
code runs, or that is killed from outside — the `Worker` cannot start, runs
out of memory, or is terminated by its resource limits. The loader sees those
only through the worker's `'error'` or `'exit'` event, which needs a turn of
its event loop, so a cleanup wait already in progress keeps waiting. The same
holds before `beforeInit`: a thread spawned while the wasm initializes gets a
worker with no view.
