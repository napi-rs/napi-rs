import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'

import ava, { type ExecutionContext } from 'ava'
import { parseSync } from 'oxc-parser'
import ts from 'typescript'

import { createCjsBinding, createEsmBinding } from '../templates/js-binding.js'
import {
  createWasiBinding,
  createWasiBrowserBinding,
  createWasiDeferredBrowserBinding,
  createWasiDeferredBrowserBindingTypeDef,
} from '../templates/load-wasi-template.js'
import {
  createWasiBrowserWorkerBinding,
  WASI_WORKER_TEMPLATE,
} from '../templates/wasi-worker-template.js'

const test = ava

const __dirname = dirname(fileURLToPath(import.meta.url))

// Snapshot tests for full template output

test('createWasiBrowserBinding default', (t) => {
  t.snapshot(createWasiBrowserBinding('test-wasi'))
})

test('createWasiBrowserBinding threaded builds size worker pools from hardwareConcurrency', (t) => {
  const binding = createWasiBrowserBinding(
    'test-wasi',
    4000,
    65536,
    false,
    false, // asyncInit: false — threaded builds still init asynchronously
    false,
    false,
    true,
  )
  t.true(binding.includes('const __asyncWorkPoolSize = 4'))
  t.true(binding.includes('const __workerPoolSize = Math.max('))
  t.true(binding.includes('globalThis.navigator?.hardwareConcurrency ?? 4'))
  // The reuse pool includes the async-work reservation: the async pool
  // draws from the same reuse pool, so without it exhaustion would starve
  // addon thread spawns. No `strict`: at exhaustion the fallback worker
  // boots once the parent returns to its event loop, which is the correct
  // behavior for spawn-and-return workloads.
  t.true(
    binding.includes(
      'reuseWorker: { size: __asyncWorkPoolSize + __workerPoolSize },',
    ),
  )
  t.false(binding.includes('strict'))
  t.true(binding.includes('asyncWorkPoolSize: __asyncWorkPoolSize,'))
  t.true(binding.includes('await __emnapiInstantiateNapiModule('))
  t.false(binding.includes('__emnapiInstantiateNapiModuleSync(__wasmFile'))
})

test('createWasiBrowserBinding threadless keeps sync init and no pool', (t) => {
  const binding = createWasiBrowserBinding(
    'test-wasi',
    4000,
    65536,
    false,
    false,
    false,
    false,
    false,
  )
  t.false(binding.includes('__workerPoolSize'))
  t.false(binding.includes('hardwareConcurrency'))
  t.false(binding.includes('reuseWorker'))
  t.true(binding.includes('asyncWorkPoolSize: 0,'))
  t.true(binding.includes('__emnapiInstantiateNapiModuleSync(__wasmFile'))
})

test('threadless loaders embed the initial memory they are given', (t) => {
  const unshared = `new WebAssembly.Memory({
  initial: 1027,
  maximum: 65536,
})`

  const nodeLoader = createWasiBinding(
    'test',
    '@scope/test',
    1027,
    65536,
    false,
  )
  t.true(nodeLoader.includes(`const __wasmMemory = ${unshared}`))
  t.false(nodeLoader.includes('shared: true'))

  const browserLoader = createWasiBrowserBinding(
    'test-wasi',
    1027,
    65536,
    false,
    false,
    false,
    false,
    false,
  )
  t.true(browserLoader.includes(`const __wasmMemory = ${unshared}`))
  t.false(browserLoader.includes('shared: true'))

  // The deferred loader publishes its descriptor instead of inlining it, and
  // allocates from it in function scope (workerd bans global scope allocation).
  const deferred = createWasiDeferredBrowserBinding('test', 1027, 65536)
  t.true(
    deferred.includes(`export const WASM_MEMORY = Object.freeze({
  initialPages: 1027,
  maximumPages: 65536,`),
  )
  t.true(
    deferred.includes(`    const __allocated = new WebAssembly.Memory({
      initial:
        __options != null && __options.initialMemoryPages !== undefined
          ? __options.initialMemoryPages
          : WASM_MEMORY.initialPages,`),
  )
  t.false(deferred.includes('shared: true'))

  // the threaded loader still gets its own, shared descriptor
  const threaded = createWasiBinding('test', '@scope/test', 16384, 65536, true)
  t.true(
    threaded.includes(`const __sharedMemory = new WebAssembly.Memory({
  initial: 16384,
  maximum: 65536,
  shared: true,
})`),
  )
})

test('createWasiBrowserBinding with errorEvent', (t) => {
  t.snapshot(
    createWasiBrowserBinding(
      'test-wasi',
      4000,
      65536,
      false,
      false,
      false,
      true,
    ),
  )
})

test('createWasiBrowserBinding with errorEvent and fs', (t) => {
  t.snapshot(
    createWasiBrowserBinding(
      'test-wasi',
      4000,
      65536,
      true,
      false,
      false,
      true,
    ),
  )
})

test('createWasiBrowserBinding with asyncRuntime hosts', (t) => {
  t.snapshot(
    createWasiBrowserBinding(
      'test-wasi',
      4000,
      65536,
      false,
      false,
      false,
      false,
      false,
      'wasm32-wasip1',
      true,
    ),
  )
})

// The deferred loader is the published `./workerd` entry and the only loader
// whose module namespace is part of the package's public API, so its bytes get
// the same snapshot treatment as the browser loaders'.
test('createWasiDeferredBrowserBinding default', (t) => {
  t.snapshot(createWasiDeferredBrowserBinding('test-wasi'))
})

test('createWasiDeferredBrowserBinding with async-runtime hosts and buffer', (t) => {
  t.snapshot(
    createWasiDeferredBrowserBinding(
      'test-wasi',
      1027,
      65536,
      true,
      'wasm32-wasip1',
      true,
    ),
  )
})

test('createWasiDeferredBrowserBindingTypeDef', (t) => {
  t.snapshot(createWasiDeferredBrowserBindingTypeDef('./test-wasi.wasip1.cjs'))
})

test('createWasiBrowserWorkerBinding default', (t) => {
  t.snapshot(createWasiBrowserWorkerBinding(false, false))
})

test('createWasiBrowserWorkerBinding with errorEvent', (t) => {
  t.snapshot(createWasiBrowserWorkerBinding(false, true))
})

test('createWasiBrowserWorkerBinding with errorEvent and fs', (t) => {
  t.snapshot(createWasiBrowserWorkerBinding(true, true))
})

function assertValidJS(t: ExecutionContext, code: string, label: string) {
  const { errors } = parseSync('test.mjs', code, { sourceType: 'module' })
  t.deepEqual(
    errors,
    [],
    `${label}: generated code should have no syntax errors`,
  )
}

const browserBindingCases: Array<{
  name: string
  args: Parameters<typeof createWasiBrowserBinding>
}> = [
  { name: 'default', args: ['test'] },
  { name: 'fs', args: ['test', 4000, 65536, true] },
  { name: 'asyncInit', args: ['test', 4000, 65536, false, true] },
  { name: 'buffer', args: ['test', 4000, 65536, false, false, true] },
  {
    name: 'errorEvent',
    args: ['test', 4000, 65536, false, false, false, true],
  },
  {
    name: 'fs + errorEvent',
    args: ['test', 4000, 65536, true, false, false, true],
  },
  { name: 'fs + buffer', args: ['test', 4000, 65536, true, false, true] },
  {
    name: 'fs + buffer + errorEvent',
    args: ['test', 4000, 65536, true, false, true, true],
  },
  {
    name: 'asyncInit + errorEvent',
    args: ['test', 4000, 65536, false, true, false, true],
  },
  { name: 'all options', args: ['test', 4000, 65536, true, true, true, true] },
  {
    name: 'asyncRuntime',
    args: [
      'test',
      4000,
      65536,
      false,
      false,
      false,
      false,
      true,
      'wasm32-wasi',
      true,
    ],
  },
  {
    name: 'all options + asyncRuntime',
    args: [
      'test',
      4000,
      65536,
      true,
      true,
      true,
      true,
      true,
      'wasm32-wasi',
      true,
    ],
  },
]

for (const { name, args } of browserBindingCases) {
  test(`createWasiBrowserBinding syntax valid: ${name}`, (t) => {
    assertValidJS(t, createWasiBrowserBinding(...args), name)
  })
}

const workerBindingCases: Array<{
  name: string
  args: Parameters<typeof createWasiBrowserWorkerBinding>
}> = [
  { name: 'default', args: [false, false] },
  { name: 'fs', args: [true, false] },
  { name: 'errorEvent', args: [false, true] },
  { name: 'fs + errorEvent', args: [true, true] },
]

for (const { name, args } of workerBindingCases) {
  test(`createWasiBrowserWorkerBinding syntax valid: ${name}`, (t) => {
    assertValidJS(t, createWasiBrowserWorkerBinding(...args), name)
  })
}

// The CJS binding loader ships inside published packages whose `engines`
// can declare support for old Node versions (e.g. `>= 10`). It must therefore
// avoid syntax/APIs newer than what those runtimes support:
//   - `require('node:*')` — the `node:` scheme in CommonJS `require()` is only
//     available on Node >= 14.18 / 16.
//   - optional chaining (`?.`) and nullish coalescing (`??`) — Node >= 14.
//   - the `new Error(message, { cause })` options form — Node < 16.9 ignores
//     the second argument, dropping the load-error chain; assign
//     `error.cause` instead.
const cjsBindingCases: Array<{ name: string; code: string }> = [
  {
    name: 'default',
    code: createCjsBinding('test', '@scope/test', ['sum', 'sub']),
  },
  {
    name: 'with version check',
    code: createCjsBinding('test', '@scope/test', ['sum', 'sub'], '1.0.0'),
  },
]

// Matches a `node:` builtin scheme in either a `require('node:fs')` or an
// `import ... from 'node:module'` specifier.
const NODE_SCHEME_RE = /['"]node:/

for (const { name, code } of cjsBindingCases) {
  test(`createCjsBinding is Node 12 compatible: ${name}`, (t) => {
    assertValidJS(t, code, name)
    t.false(
      NODE_SCHEME_RE.test(code),
      'CJS loader must not use the node: scheme (unsupported on Node < 14.18/16 for require())',
    )
    t.false(code.includes('?.'), 'CJS loader must not use optional chaining')
    t.false(code.includes('??'), 'CJS loader must not use nullish coalescing')
    t.false(
      /\bcause:/.test(code),
      'CJS loader must not pass `{ cause }` to the Error constructor (ignored on Node < 16.9); assign `error.cause` instead',
    )
  })
}

// `napi_prepare_wasm_env_cleanup` only *queues* the promise settlements of the
// tasks it cancels: `napi_call_threadsafe_function` appends to the
// threadsafe-function queue, and @emnapi/core dispatches that queue from a
// macrotask two coalescing turns later. `Context.destroy()` then drains the
// queue with a null env and discards it. Measured against @emnapi/core
// 2.0.0-alpha.3: zero microtask checkpoints ever deliver the settlement, and it
// takes exactly two macrotask turns.
//
// So a loader that emits the barrier and `destroy()` back to back strands
// exactly the promises the barrier exists to settle, and it does so silently.
// `examples/custom-async-runtime` covers the hand-written loader and the two
// emitted flavors it builds (node cjs threadless, deferred/workerd)
// behaviorally; the other flavors are never instantiated by any test, so assert
// the shape here as well.
// `napi.wasm.asyncRuntime` output. The seven-export / contract-v4 / liveness /
// rollback checks all live in `@napi-rs/async-runtime`; the loader only has to
// call it at the right moment and tear it down at the right moment.
const asyncRuntimeLoaderCases: Array<{
  name: string
  code: string
  install: string
}> = [
  {
    name: 'node cjs',
    code: createWasiBinding(
      'test',
      '@scope/test',
      4000,
      65536,
      true,
      'wasm32-wasi',
      'test',
      true,
    ),
    install: "require('@napi-rs/async-runtime')",
  },
  {
    name: 'node cjs threadless',
    code: createWasiBinding(
      'test',
      '@scope/test',
      4000,
      65536,
      false,
      'wasm32-wasip1',
      'test',
      true,
    ),
    install: "require('@napi-rs/async-runtime')",
  },
  {
    name: 'browser esm',
    code: createWasiBrowserBinding(
      'test',
      4000,
      65536,
      false,
      false,
      false,
      false,
      true,
      'wasm32-wasi',
      true,
    ),
    install: "from '@napi-rs/async-runtime'",
  },
]

const asyncRuntimeDeferredCode = createWasiDeferredBrowserBinding(
  'test',
  1024,
  65536,
  false,
  'wasm32-wasip1',
  true,
)

const wasiLoaderCases: Array<{ name: string; code: string }> = [
  { name: 'node cjs', code: createWasiBinding('test', '@scope/test') },
  {
    name: 'node cjs threadless',
    code: createWasiBinding('test', '@scope/test', 4000, 65536, false),
  },
  { name: 'browser esm', code: createWasiBrowserBinding('test') },
  { name: 'deferred/workerd', code: createWasiDeferredBrowserBinding('test') },
  ...asyncRuntimeLoaderCases.map(({ name, code }) => ({
    name: `${name} + asyncRuntime`,
    code,
  })),
  {
    name: 'deferred/workerd + asyncRuntime',
    code: asyncRuntimeDeferredCode,
  },
]

// The flag is off by default, so every existing generated loader keeps its
// current bytes when a project bumps the CLI. The six template snapshots are
// the byte-level proof; this is the cheap named regression net.
for (const { name, code } of [
  { name: 'node cjs', code: createWasiBinding('test', '@scope/test') },
  { name: 'browser esm', code: createWasiBrowserBinding('test') },
  { name: 'deferred/workerd', code: createWasiDeferredBrowserBinding('test') },
]) {
  test(`asyncRuntime is off by default: ${name}`, (t) => {
    t.false(code.includes('@napi-rs/async-runtime'))
    t.false(code.includes('__disposeCurrentThreadHosts'))
    t.false(code.includes('installCurrentThreadHosts'))
  })
}

for (const { name, code, install } of asyncRuntimeLoaderCases) {
  test(`asyncRuntime loader installs and tears down the hosts: ${name}`, (t) => {
    assertValidJS(t, code, name)
    t.true(code.includes(install))
    // The package owns the seven-export / contract-v4 / liveness / rollback
    // checks; the loader must not re-implement any of them.
    t.true(code.includes('__installCurrentThreadHosts('))
    t.false(code.includes('reserveCurrentThreadHostRegistration'))
    t.false(code.includes('getCurrentThreadTaskHostContractVersion'))

    // Install runs after the dispose symbol is published and INSIDE the try,
    // so a mismatch throw reaches the existing rollback.
    const installIndex = code.indexOf(
      '__currentThreadHostsDisposer = __installCurrentThreadHosts(',
    )
    t.true(
      installIndex > code.indexOf('__publishWasiDispose(__napiModule.exports)'),
    )
    t.true(
      installIndex < code.indexOf('\n} catch (error) {\n', installIndex - 1),
    )

    // Teardown runs before the context is destroyed, on every path, because
    // __destroyEmnapiContext is the single funnel dispose()/rollback/'exit'
    // all reach.
    const destroyBody = code.slice(
      code.indexOf('function __destroyEmnapiContext() {'),
      code.indexOf('function __terminateWasiWorkers() {'),
    )
    t.true(destroyBody.includes('__disposeCurrentThreadHosts()'))
    t.true(
      destroyBody.indexOf('__disposeCurrentThreadHosts()') <
        destroyBody.indexOf('__emnapiContext.destroy()'),
    )
    // …and after the drain: __startWasiDisposal prepares + drains before it
    // ever calls __continueWasiDisposal -> __destroyEmnapiContext.
    t.false(destroyBody.includes('__drainWasmEnvCleanup'))
  })
}

// `@emnapi/wasi-threads` records a worker exit as expected only when ITS thread
// manager performed the termination. A bare `worker.terminate()` reaches the
// manager's own 'exit' listener, which reports the exit as a worker failure and
// rethrows inside the emit — aborting the `once('exit')` that backs the
// terminate promise, so `dispose()` never settles.
for (const { name, code } of [
  { name: 'node cjs', code: createWasiBinding('test', '@scope/test') },
  { name: 'browser esm', code: createWasiBrowserBinding('test') },
]) {
  test(`pool workers are terminated through the thread manager: ${name}`, (t) => {
    const start = code.indexOf('function __terminateWasiWorkers() {')
    t.true(start > 0)
    const body = code.slice(
      start,
      code.indexOf('function __finishWasiDisposal() {'),
    )
    const mark = body.indexOf('threadManager.terminateWorker(worker)')
    const terminate = body.indexOf('result = worker.terminate()')
    t.true(terminate > 0)
    t.true(mark > 0, 'the termination has to be marked on the thread manager')
    t.true(mark < terminate, 'and marked before the worker is terminated')
    // Not `terminateAllThreads()`: it recreates the pool it just shut down.
    t.false(body.includes('terminateAllThreads'))
    // `terminateWorker` leaves a reporter behind that logs every message still
    // queued on the port, which Node flushes on exit.
    t.true(body.includes('worker.onmessage = undefined'))
    // The manager is resolved through the helper, not read off `__napiModule`:
    // the rollback runs on the one path where that binding was never assigned.
    t.true(body.includes('const threadManager = __getWasiThreadManager()'))
    t.false(body.includes('__napiModule.PThread'))
  })
}

// The pool workers are unreferenced on purpose, and emnapi unreferences them
// again when one reports `async-thread-ready`, so a pending termination has no
// handle of its own to hold the loop open with.
for (const { name, code } of [
  { name: 'node cjs', code: createWasiBinding('test', '@scope/test') },
  { name: 'browser esm', code: createWasiBrowserBinding('test') },
]) {
  test(`a pending termination holds the event loop open: ${name}`, (t) => {
    const body = code.slice(
      code.indexOf('function __terminateWasiWorkers() {'),
      code.indexOf('function __finishWasiDisposal() {'),
    )
    t.true(
      body.includes(
        '__keepEventLoopAliveUntil(Promise.all(pending)).then(finish)',
      ),
      'the terminate promises have to be awaited under a keep-alive',
    )
    // …and the keep-alive is released the moment the work settles, so it can
    // never outlive the disposal that asked for it.
    const keepAlive = code.slice(
      code.indexOf('function __keepEventLoopAliveUntil(work) {'),
    )
    t.true(keepAlive.indexOf('clearTimer(timer)') > 0)
    t.true(keepAlive.indexOf('release()') < keepAlive.indexOf('return value'))
    // Nothing puts the stubbed `ref` functions back: doing so is what raced
    // emnapi's own unreference.
    t.false(code.includes('__wasiWorkerRefRestorers'))
    t.false(code.includes('__restoreWasiWorkerRef'))
  })
}

test('the node loader keeps its pool workers unreferenced for life', (t) => {
  const code = createWasiBinding('test', '@scope/test')
  t.true(code.includes('worker[kPublicPort].ref = () => {}'))
  t.true(code.includes('worker[kHandle].ref = () => {}'))
  t.true(code.includes('worker.unref()'))
  // An idle binding must not hold the process open, and disposal does not
  // reverse that — `__keepEventLoopAliveUntil` covers the termination instead.
  t.false(code.includes('.ref = publicPortRef'))
  t.false(code.includes('.ref = handleRef'))
})

// `examples/custom-async-runtime` asserts a threadless loader never mentions
// `Worker`, so nothing in the *shared* prelude may name the class — comments
// included. That lane needs a wasm build to fail; this does not.
for (const { name, code } of [
  {
    name: 'node cjs threadless',
    code: createWasiBinding('test', '@scope/test', 4000, 65536, false),
  },
  {
    name: 'browser esm threadless',
    code: createWasiBrowserBinding(
      'test',
      4000,
      65536,
      false,
      false,
      false,
      false,
      false,
    ),
  },
  { name: 'deferred/workerd', code: createWasiDeferredBrowserBinding('test') },
]) {
  test(`threadless loaders never name Worker: ${name}`, (t) => {
    t.notRegex(code, /\bWorker\b/)
    t.notRegex(code, /node:worker_threads/)
  })
}

test('asyncRuntime deferred loader registers per instance', (t) => {
  const code = asyncRuntimeDeferredCode
  assertValidJS(t, code, 'deferred asyncRuntime')
  // Per-instance helpers, NOT installCurrentThreadHosts: each instance owns
  // its own env and needs an exact disposer, not a realm-global dedup.
  t.true(code.includes('__registerWorkerdCurrentThreadTaskHost('))
  t.true(code.includes('__registerWorkerdTimerHost('))
  t.false(code.includes('installCurrentThreadHosts'))
  // Task host first, timer host second; disposal is the reverse.
  t.true(
    code.indexOf('const __disposeTaskHost =') <
      code.indexOf('const __disposeTimerHost ='),
  )
  const disposer = code.slice(code.indexOf('__disposeInstanceHosts = () => {'))
  t.true(
    disposer.indexOf('__disposeTimerHost()') <
      disposer.indexOf('__disposeTaskHost()'),
  )
  // Hooked next to __prepareEnvCleanup, which every destroy path calls.
  const managedDestroy = code.slice(
    code.indexOf('      __prepareEnvCleanup?.()'),
  )
  t.true(
    managedDestroy.indexOf('__disposeHosts?.()') <
      managedDestroy.indexOf('__result = __emnapiContext.destroy()'),
  )
})

// The deferred loader's module namespace is the published `./workerd` entry's
// public API. `WASM_MEMORY` and `getDeferredRuntimeStats` are new names in it,
// and `createInstance`'s option bag is the only way a host sizes an instance
// under a hard isolate cap.
test('deferred loader is syntactically valid in both host modes', (t) => {
  assertValidJS(t, createWasiDeferredBrowserBinding('test'), 'deferred')
  assertValidJS(
    t,
    createWasiDeferredBrowserBinding(
      'test',
      1027,
      65536,
      true,
      'wasm32-wasip1',
      true,
    ),
    'deferred + hosts',
  )
})

test('deferred loader publishes the memory floor it was configured with', (t) => {
  const code = createWasiDeferredBrowserBinding('test', 1027, 40000)
  t.true(code.includes('export const WASM_MEMORY = Object.freeze({'))
  t.true(code.includes('initialPages: 1027'))
  t.true(code.includes('maximumPages: 40000'))
  t.true(code.includes('initialBytes: 1027 * 65536'))
  t.true(code.includes('maximumBytes: 40000 * 65536'))
  t.true(code.includes('export function getDeferredRuntimeStats()'))
  // workerd bans allocation in global scope, so the single `new
  // WebAssembly.Memory` stays inside the per-instance resolver.
  t.is(code.split('new WebAssembly.Memory(').length - 1, 1)
  t.true(
    code.indexOf('function __resolveInstanceMemory(') <
      code.indexOf('new WebAssembly.Memory('),
  )
})

test('deferred loader claims caller memory exactly once and rejects shared memory', (t) => {
  const code = createWasiDeferredBrowserBinding('test')
  t.true(code.includes('const __claimedMemories = new WeakSet()'))
  t.true(code.includes('__claimedMemories.add(__provided)'))
  t.true(
    code.includes('requires an unshared WebAssembly.Memory'),
    'a SharedArrayBuffer-backed memory must be rejected, not silently accepted',
  )
  t.true(
    code.includes(
      'Pass either memory or initialMemoryPages/maximumMemoryPages, not both',
    ),
  )
  // The claim is taken before instantiation can fail, so a failed attempt
  // cannot hand the same half-written bytes to a second instance.
  const resolver = code.slice(
    code.indexOf('function __resolveInstanceMemory('),
    code.indexOf('\n}\n', code.indexOf('function __resolveInstanceMemory(')),
  )
  t.true(resolver.includes('__claimedMemories.add(__provided)'))
  // The loader-allocated Memory is claimed too: the handle publishes it as
  // `instance.memory`, and two live instances on one linear memory each
  // reinitialize the state the other is running on.
  t.true(resolver.includes('__claimedMemories.add(__allocated)'))
})

test('deferred loader rejects a cross-realm memory before claiming it', (t) => {
  const code = createWasiDeferredBrowserBinding('test')
  const resolver = code.slice(
    code.indexOf('function __resolveInstanceMemory('),
    code.indexOf('\n}\n', code.indexOf('function __resolveInstanceMemory(')),
  )
  // The intrinsic getters accept a genuine Memory from any realm, but
  // `WASI.setMemory` and emnapi identify one with a realm-local `instanceof`.
  t.true(resolver.includes('if (!(__provided instanceof WebAssembly.Memory))'))
  t.true(
    resolver.includes(
      'memory must be a WebAssembly.Memory created in the same realm as this loader',
    ),
  )
  // Every rejection must precede the claim, or a corrected retry would be
  // refused as a reuse of a Memory that never ran anything.
  t.true(
    resolver.indexOf('__provided instanceof WebAssembly.Memory') <
      resolver.indexOf('__claimedMemories.add(__provided)'),
  )
  t.true(
    resolver.indexOf(
      'Pass either memory or initialMemoryPages/maximumMemoryPages, not both',
    ) < resolver.indexOf('__claimedMemories.add(__provided)'),
  )
})

test('deferred instance handle reports its memory and retires exactly once', (t) => {
  const code = createWasiDeferredBrowserBinding('test')
  const handleStart = code.indexOf(
    '    return {\n      exports: __napiModule.exports,',
  )
  t.true(
    handleStart !== -1,
    'the instance handle must be returned as a literal',
  )
  const handle = code.slice(
    handleStart,
    code.indexOf('  } catch (error) {', handleStart),
  )
  t.true(handle.includes('get memory() {'))
  t.true(handle.includes('get memoryBytes() {'))
  t.true(handle.includes('get disposed() {'))
  // The handle delegates to the coalescing wrapper, so the retirement
  // bookkeeping lives in the one disposal body that wrapper runs.
  t.true(handle.includes('dispose: __disposeInstance,'))
  const disposalStart = code.indexOf(
    '  const __runInstanceDisposal = async () => {',
  )
  t.true(disposalStart !== -1, 'the disposal body must be a named arrow')
  const disposal = code.slice(
    disposalStart,
    code.indexOf('\n  }\n', disposalStart),
  )
  // The counter moves only after the destroy resolves, so a dispose() that
  // throws stays retryable without double-decrementing.
  t.true(
    disposal.indexOf('await (__beforeExitDestroy') <
      disposal.indexOf('__liveInstances -= 1'),
  )
  t.true(disposal.includes('if (!__disposed) {'))
})

test('deferred loader keeps the singleton on the loader-owned memory', (t) => {
  const code = createWasiDeferredBrowserBinding('test')
  // `instantiate()` takes no option bag, so it must pass the options slot
  // explicitly rather than shifting `__disposeDefaultInstance` into it.
  t.true(
    code.includes(`__createInstance(
        __module,
        undefined,
        __disposeDefaultInstance,`),
  )
  t.true(code.includes('return __createInstance(__wasmInput, __options)'))
})

test('deferred loader pulls its hosts from the isolate-safe subpath', (t) => {
  const code = createWasiDeferredBrowserBinding(
    'test',
    1024,
    65536,
    false,
    'wasm32-wasip1',
    true,
  )
  // The barrel (`index.cjs`) also requires `current-thread-hosts.cjs`, the
  // Node-lane relay a worker bundle never runs and CJS cannot tree-shake.
  t.true(code.includes("} from '@napi-rs/async-runtime/workerd'"))
  t.false(code.includes("from '@napi-rs/async-runtime'\n"))
})

test('deferred loader type definition covers the new surface', (t) => {
  const typeDef = createWasiDeferredBrowserBindingTypeDef('./test.wasip1.cjs')
  // The two memory forms are separate interfaces, each declaring the other
  // form's properties as `never`, so the combination `__resolveInstanceMemory`
  // always throws on cannot be spelled by a typed caller.
  t.true(typeDef.includes('export interface WasiCallerMemoryOptions {'))
  t.true(typeDef.includes('  memory: WebAssembly.Memory'))
  t.true(typeDef.includes('  initialMemoryPages?: never'))
  t.true(typeDef.includes('  maximumMemoryPages?: never'))
  t.true(typeDef.includes('export interface WasiAllocatedMemoryOptions {'))
  t.true(typeDef.includes('  memory?: never'))
  t.true(typeDef.includes('  initialMemoryPages?: number'))
  t.true(typeDef.includes('  maximumMemoryPages?: number'))
  t.true(
    typeDef.includes(`export type WasiInstanceOptions =
  | WasiCallerMemoryOptions
  | WasiAllocatedMemoryOptions`),
  )
  t.false(typeDef.includes('export interface WasiInstanceOptions {'))
  t.true(typeDef.includes('readonly memoryBytes: number'))
  t.true(typeDef.includes('readonly disposed: boolean'))
  t.true(typeDef.includes('export const WASM_MEMORY: Readonly<{'))
  t.true(
    typeDef.includes(
      'export function getDeferredRuntimeStats(): Readonly<WasiRuntimeStats>',
    ),
  )
  t.true(
    typeDef.includes(`export function createInstance(
  wasmInput: WasiModuleInput,
  options?: WasiInstanceOptions,
): Promise<WasiInstance>`),
  )
  // `createWasiDeferredBindingTypeDef` rewrites this exact string when the
  // project builds without type definitions.
  t.true(typeDef.includes("typeof import('./test.wasip1.cjs')"))
})

const DEFERRED_TYPE_CHECK_OPTIONS: ts.CompilerOptions = {
  strict: true,
  noEmit: true,
  // The generated `.d.ts` is the file under test, so it must not be skipped.
  // Only the default lib is.
  skipLibCheck: false,
  skipDefaultLibCheck: true,
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
}

/**
 * A consumer module for the generated deferred `.d.ts`, wrapping the given
 * `createInstance()` calls in the declarations they need.
 */
const deferredConsumerSource = (calls: string) =>
  `import { createInstance } from './loader.js'

declare const wasmModule: WebAssembly.Module
declare const memory: WebAssembly.Memory

${calls}
`

/**
 * TypeScript's verdict on such a consumer, as a list of diagnostic codes. The
 * default lib still comes off disk through the real host; the generated
 * typedef, the binding it imports, and the consumer are served from memory, so
 * the check needs no temporary directory. Mirrors the semantic-check host in
 * `build.spec.ts`.
 */
const deferredConsumerDiagnostics = (calls: string) => {
  const root = `${__dirname.replaceAll('\\', '/')}/__deferred_typecheck__`
  const files = new Map([
    [
      `${root}/loader.d.ts`,
      createWasiDeferredBrowserBindingTypeDef('./test.wasip1.cjs'),
    ],
    [`${root}/test.wasip1.d.cts`, 'export declare const binding: number\n'],
    [`${root}/consumer.ts`, deferredConsumerSource(calls)],
  ])
  const host = ts.createCompilerHost(DEFERRED_TYPE_CHECK_OPTIONS, true)
  const readRealSourceFile = host.getSourceFile.bind(host)
  const realFileExists = host.fileExists.bind(host)
  const realReadFile = host.readFile.bind(host)
  const realDirectoryExists = host.directoryExists?.bind(host)
  host.getSourceFile = (fileName, languageVersion, ...rest) => {
    const virtual = files.get(fileName)
    return virtual === undefined
      ? readRealSourceFile(fileName, languageVersion, ...rest)
      : ts.createSourceFile(fileName, virtual, languageVersion, true)
  }
  host.fileExists = (fileName) =>
    files.has(fileName) || realFileExists(fileName)
  host.readFile = (fileName) => files.get(fileName) ?? realReadFile(fileName)
  if (realDirectoryExists) {
    host.directoryExists = (directoryName) =>
      directoryName === root || realDirectoryExists(directoryName)
  }
  const program = ts.createProgram({
    rootNames: [`${root}/consumer.ts`],
    options: DEFERRED_TYPE_CHECK_OPTIONS,
    host,
  })
  return ts.getPreEmitDiagnostics(program).map((d) => `TS${d.code}`)
}

test('deferred createInstance() options type-check per memory form', (t) => {
  // Every form the loader accepts at runtime. `{}` and an omitted argument
  // must stay legal: the allocated form is all-optional.
  t.deepEqual(
    deferredConsumerDiagnostics(`void createInstance(wasmModule)
void createInstance(wasmModule, undefined)
void createInstance(wasmModule, {})
void createInstance(wasmModule, { memory })
void createInstance(wasmModule, { initialMemoryPages: 1 })
void createInstance(wasmModule, { initialMemoryPages: 1, maximumMemoryPages: 2 })`),
    [],
  )
})

test('deferred createInstance() rejects memory beside a page count', (t) => {
  // `__resolveInstanceMemory` throws a TypeError on either mix, so neither
  // may type-check. `memory` selects the caller form, whose page properties
  // are `?: never` — i.e. `undefined` — so the checker rejects the offending
  // property in place rather than the whole call: TS2322, "Type 'number' is not
  // assignable to type 'undefined'".
  t.deepEqual(
    deferredConsumerDiagnostics(
      'void createInstance(wasmModule, { memory, initialMemoryPages: 1024 })',
    ),
    ['TS2322'],
  )
  t.deepEqual(
    deferredConsumerDiagnostics(
      'void createInstance(wasmModule, { memory, maximumMemoryPages: 2048 })',
    ),
    ['TS2322'],
  )
})

test('Node WASI loader uses an accessible host root on Android', (t) => {
  const code = createWasiBinding('test', '@scope/test')
  assertValidJS(t, code, 'Node WASI loader')
  t.true(code.includes('const __cwd = process.cwd()'))
  t.true(code.includes("process.platform === 'android' ? __cwd : __rootDir"))
  t.true(code.includes('[__rootDir]: __hostRoot'))
  t.true(code.includes('[__hostRoot]: __hostRoot'))
  t.true(
    code.includes(
      'workerData: {\n          hostRoot: __hostRoot,\n          rootDir: __rootDir,\n',
    ),
  )
  t.false(code.includes('[__rootDir]: __rootDir'))
})

test('Node WASI worker uses an accessible host root on Android', (t) => {
  assertValidJS(t, WASI_WORKER_TEMPLATE, 'Node WASI worker')
  t.true(
    WASI_WORKER_TEMPLATE.includes(
      "workerData && typeof workerData.rootDir === 'string' && workerData.rootDir",
    ),
  )
  t.true(
    WASI_WORKER_TEMPLATE.includes(
      "workerData && typeof workerData.hostRoot === 'string' && workerData.hostRoot",
    ),
  )
  t.true(WASI_WORKER_TEMPLATE.includes('[__rootDir]: __hostRoot'))
  t.true(WASI_WORKER_TEMPLATE.includes('[__hostRoot]: __hostRoot'))
  t.false(WASI_WORKER_TEMPLATE.includes('[__rootDir]: __rootDir'))
})

for (const { name, code } of wasiLoaderCases) {
  test(`WASI loader waits for queued settlements before destroy: ${name}`, (t) => {
    t.true(
      code.includes('napi_prepare_wasm_env_cleanup'),
      'loader must run the pre-teardown barrier',
    )
    t.true(
      code.includes('napi_wasm_env_cleanup_pending'),
      'loader must poll napi_wasm_env_cleanup_pending; without it the barrier queues settlements that Context.destroy() then discards',
    )
    t.true(
      code.includes('__drainWasmEnvCleanup'),
      'loader must call the settlement drain on its disposal path',
    )
    t.true(
      code.includes('__scheduleMacrotask'),
      'the drain must yield real macrotask turns; microtask checkpoints never let the emnapi dispatch run',
    )
    // Initialization rollback is the same hazard, one step earlier. Registration
    // runs with a live environment, so a module-init hook can start a task and
    // *then* return an error; the barrier cancels the task and queues its
    // rejection, and a rollback that destroys the context in the same turn
    // discards it — stranding a promise that already escaped into JavaScript.
    t.true(
      initializationRollbackBody(code).includes(
        DRAIN_CALL_BY_ROLLBACK_FLAVOR[
          code.includes(EAGER_ROLLBACK_SIGNATURE) ? 'eager' : 'deferred'
        ],
      ),
      'initialization rollback must drain queued settlements before destroying the context',
    )
  })
}

const EAGER_ROLLBACK_SIGNATURE = 'function __rollbackWasiInitialization() {'
// The threaded node loader keeps the rollback's body under this name and makes
// `__rollbackWasiInitialization` the wrapper that stops it after a crash.
const LATCHED_ROLLBACK_SIGNATURE =
  'function __runWasiInitializationRollbackSteps() {'
const DEFERRED_ROLLBACK_SIGNATURE = "__lifecycleState = 'failed'"
const DRAIN_CALL_BY_ROLLBACK_FLAVOR = {
  eager: '__drainWasmEnvCleanup',
  deferred: '__prepareForDisposal',
} as const

/**
 * The body of a loader's initialization-failure path: `__rollbackWasiInitialization`
 * (its steps, in the threaded node loader) for the eager loaders, `__createInstance`'s catch for the deferred one.
 * Sliced rather than searched whole-file, so a drain that only runs on the
 * ordinary disposal path cannot satisfy the assertion.
 */
function initializationRollbackBody(code: string): string {
  const latchedStart = code.indexOf(LATCHED_ROLLBACK_SIGNATURE)
  const eagerStart =
    latchedStart !== -1 ? latchedStart : code.indexOf(EAGER_ROLLBACK_SIGNATURE)
  if (eagerStart !== -1) {
    return code.slice(eagerStart, code.indexOf('\n}', eagerStart))
  }
  const deferredStart = code.indexOf(DEFERRED_ROLLBACK_SIGNATURE)
  return code.slice(deferredStart, code.indexOf('throw error', deferredStart))
}

/**
 * The body of `__startWasiDisposal`, sliced so that "the drain runs on the
 * disposal path" cannot be satisfied by a call somewhere else in the file.
 */
function disposalStartBody(code: string): string {
  const start = code.indexOf(DISPOSAL_START_SIGNATURE)
  return start === -1 ? '' : code.slice(start, code.indexOf('\n}', start))
}

const DISPOSAL_START_SIGNATURE = 'function __startWasiDisposal() {'

/**
 * `napi_async_work` is the one thing the settlement barrier above does not
 * cover. The eager loaders drain it from the shared prelude; the
 * deferred/workerd loader carries its own per-instance lifecycle and drains it
 * there, so both are asserted — just against different function names.
 */
const eagerWasiLoaderCases = wasiLoaderCases.filter(({ code }) =>
  code.includes(EAGER_ROLLBACK_SIGNATURE),
)
const deferredWasiLoaderCases = wasiLoaderCases.filter(
  ({ code }) => !code.includes(EAGER_ROLLBACK_SIGNATURE),
)

test('every WASI loader case is either eager or deferred', (t) => {
  t.is(
    eagerWasiLoaderCases.length + deferredWasiLoaderCases.length,
    wasiLoaderCases.length,
  )
  t.true(deferredWasiLoaderCases.length >= 2)
})

for (const { name, code } of deferredWasiLoaderCases) {
  test(`deferred WASI loader drains outstanding async work before teardown: ${name}`, (t) => {
    t.true(
      code.includes('napi_wasm_async_work_pending'),
      'the deferred loader instantiates the same async-work plugin, so it strands the same work',
    )
    t.true(
      code.includes('napi_wasm_cancel_pending_async_work'),
      'threadless work is always queued rather than executing, so cancellation is what bounds the wait',
    )
    t.regex(
      code,
      /typeof __pending !== 'function' \|\|\s*typeof __cancelPending !== 'function'/,
      'loader must feature-detect both exports',
    )
    // Per instance, from that instance's own exports: two instances have
    // separate registries and must not wait on each other.
    t.true(
      code.includes('__drainInstanceAsyncWork(__napiInstance)'),
      'the drain must read the disposing instance, not a module-global one',
    )
    // Both teardown paths destroy the environment those completions need.
    const disposal = code.slice(
      code.indexOf('const __runInstanceDisposal'),
      code.indexOf('let __instanceDisposePromise'),
    )
    t.true(
      disposal.includes('__drainInstanceAsyncWork'),
      'per-instance disposal must drain outstanding async work',
    )
    t.true(
      initializationRollbackBody(code).includes('__drainInstanceAsyncWork'),
      'the initialization-failure path must drain it too',
    )
  })
}

test('the eager loader cases are the ones that share the disposal prelude', (t) => {
  // Guards the filter above: a prelude change that stopped emitting the eager
  // rollback would silently empty the loop below instead of failing.
  t.true(eagerWasiLoaderCases.length >= 4)
})

for (const { name, code } of eagerWasiLoaderCases) {
  test(`WASI loader drains outstanding async work before teardown: ${name}`, (t) => {
    t.true(
      code.includes('napi_wasm_async_work_pending'),
      'loader must poll the addon for outstanding async work; nothing about it is observable from JavaScript in a threaded build',
    )
    t.true(
      code.includes('napi_wasm_cancel_pending_async_work'),
      'loader must cancel work that has not started, or disposal waits for the whole queue instead of only what is running',
    )
    // Both exports are optional, exactly like the settlement handshake: an
    // addon built against a napi crate that predates them must keep loading and
    // disposing as it does today.
    t.regex(
      code,
      /typeof pending !== 'function' \|\| typeof cancelPending !== 'function'/,
      'loader must feature-detect both exports',
    )
    // The wait is a real referenced timer, not a macrotask spin: the addon is
    // polled, so a zero-delay turn would burn the loop instead of yielding it.
    t.true(
      code.includes(
        '__scheduleTimer(resolve, __WASI_ASYNC_WORK_POLL_INTERVAL_MS)',
      ),
      'the async-work wait must yield with a real timer',
    )
    t.true(
      disposalStartBody(code).includes('__drainWasiAsyncWork'),
      'disposal must drain outstanding async work',
    )
    // Ordering is the whole point: the completion callbacks run addon code, and
    // the barrier, `Context.destroy()` and the termination each take that away.
    t.false(
      disposalStartBody(code).includes('__prepareWasmEnvCleanup'),
      'the async-work drain must run before the barrier, not beside it',
    )
    t.true(
      initializationRollbackBody(code).includes('__drainWasiAsyncWork'),
      'initialization rollback tears down the same things and needs the same drain',
    )
  })
}

// `napi_prepare_wasm_env_cleanup` waits: it returns only once the addon's async
// runtime has quiesced, and on a threaded artifact the work it waits for can be
// waiting for a JavaScript turn from the very thread the export runs on — which
// never comes, because that thread is inside the export. The addon exposes the
// same teardown as `…_begin` / `napi_wasm_runtime_work_pending` / `…_finish` so
// a loader can put real turns in the middle. Every shape that can yield has to
// use it, and every shape has to keep working against an addon that has no such
// exports.
const TWO_PHASE_BARRIER_BY_FLAVOR = {
  eager: {
    detect:
      /if \(typeof begin !== 'function' \|\|\s*typeof finish !== 'function'\) \{/,
    poll: '}, __WASM_RUNTIME_WORK_POLL_INTERVAL_MS)',
    finish: '.then(finishCleanup, finishCleanup)',
    fallback: '__prepareWasmEnvCleanup()',
    report: '__reportUnreachedWasmEnvSettlements()',
    // The closer a caller that cannot yield uses to end a parked handshake,
    // and the point at which the poll publishes it.
    parked: '__finishParkedWasmEnvCleanup',
    publishParked: '__finishParkedWasmEnvCleanup = finishCleanup',
    clearParked: '__finishParkedWasmEnvCleanup = undefined',
  },
  deferred: {
    detect:
      /if \(typeof __begin !== 'function' \|\|\s*typeof __finish !== 'function'\) \{/,
    poll: '}, __WASM_RUNTIME_WORK_POLL_INTERVAL_MS)',
    finish: `return __pollWasmRuntimeWork(__workPending).then(
      __finishEnvCleanup,
      __finishEnvCleanup,
    )`,
    fallback: '__prepareEnvCleanup()',
    report: '__reportUnreachedSettlements()',
    parked: '__finishParkedEnvCleanup',
    publishParked: '__finishParkedEnvCleanup = __finishEnvCleanup',
    clearParked: '__finishParkedEnvCleanup = undefined',
  },
} as const

for (const { name, code } of wasiLoaderCases) {
  const barrier =
    TWO_PHASE_BARRIER_BY_FLAVOR[
      code.includes(EAGER_ROLLBACK_SIGNATURE) ? 'eager' : 'deferred'
    ]
  test(`WASI loader polls the two-phase wasm env cleanup: ${name}`, (t) => {
    t.true(
      code.includes('napi_prepare_wasm_env_cleanup_begin'),
      'loader must start the teardown without joining',
    )
    t.true(
      code.includes('napi_wasm_runtime_work_pending'),
      'loader must poll the runtime between the two halves; without it there is nothing to wait on',
    )
    t.true(
      code.includes('napi_prepare_wasm_env_cleanup_finish'),
      'loader must still join: finish is the call that owes quiescence',
    )
    // Optional, exactly like every other export in this teardown: an addon
    // built against a napi crate that predates the split keeps the single
    // blocking call.
    t.regex(code, barrier.detect, 'the split must be feature-detected')
    t.true(
      code.includes(barrier.fallback),
      'a loader that finds no split must fall back to the single call',
    )
    // Unbounded, and deliberately so. The only way to end the poll early is to
    // call `…_finish`, which joins on the JavaScript thread — the very thread
    // the work it joins may be waiting for a turn from — so a budget would not
    // end that wait, it would only move it somewhere the thread can no longer
    // be reached. Same reason the async-work drain has no deadline. A host that
    // breaks the "no blocking closure may wait on a JavaScript turn" rule keeps
    // its disposal promise pending instead of wedging the thread.
    t.false(
      code.includes('__WASM_RUNTIME_DRAIN_TURNS'),
      'the poll must not carry a turn budget',
    )
    t.is(
      code.split('for (;;) {').length - 1,
      1,
      'the poll must be an unbounded loop',
    )
    t.true(
      code.includes(barrier.poll),
      'the poll must yield with a real referenced timer, not a macrotask spin',
    )
    // `__scheduleTimer` falls back to the macrotask scheduler when `setTimeout`
    // is missing or throws — but not when it is present, returns a handle and
    // never fires (fake timers; a host whose timers belong to an IO context
    // that is gone). With no budget left to bail the poll out, that host would
    // park it forever. Arm both until timers have actually arrived, then pace
    // on the timer alone rather than spinning the zero-delay queue.
    //
    // Whether they arrive is a property of the poll, never of the module: a
    // host can lose its timers between two disposals, and in the deferred
    // shape every instance shares this module — one healthy instance must not
    // disarm the fallback for the next one.
    t.false(
      code.includes('let __wasmRuntimePollTimerArrived'),
      'the pacing state must not outlive the poll that learned it',
    )
    t.is(
      code.split('function __createWasmRuntimePollPace()').length - 1,
      1,
      'one definition of the pacing state',
    )
    t.is(
      code.split('__createWasmRuntimePollPace()').length - 1,
      2,
      'and exactly one caller: the poll loop, which owns it for its own run',
    )
    const yieldStart = code.indexOf('function __yieldWasmRuntimePollTurn(')
    t.true(yieldStart > 0, 'the poll must yield through one shared turn helper')
    const yieldTurn = code.slice(yieldStart, code.indexOf('\n}\n', yieldStart))
    t.true(
      yieldTurn.includes('__scheduleTimer(') &&
        yieldTurn.includes('__scheduleMacrotask('),
      'an undecided turn must arm both primitives, so an inert setTimeout cannot park the poll',
    )
    t.true(
      yieldTurn.includes('pace.arrivals++'),
      'the timer callback must count that timers work on this host',
    )
    t.true(
      yieldTurn.includes(
        'pace.arrivals < __WASM_RUNTIME_WORK_POLL_TRUSTED_ARRIVALS',
      ),
      'and one arrival must not be enough: it can be a timer armed before the host stopped running them',
    )
    // A poll that has settled onto the timer alone has nothing left to fall
    // back on if the timers stop mid-poll — the turn that armed the dead timer
    // is the turn that parks, and a parked poll schedules nothing that could
    // notice. Every turn keeps a longer timer outstanding for that.
    t.true(
      yieldTurn.includes('__armWasmRuntimePollStallBackup('),
      'every turn must keep a stall backup outstanding, armed while the timers still work',
    )
    const backupStart = code.indexOf(
      'function __armWasmRuntimePollStallBackup(',
    )
    t.true(backupStart > 0, 'the backup must be one shared helper')
    const stallBackup = code.slice(
      backupStart,
      code.indexOf('\n}\n', backupStart),
    )
    t.true(
      stallBackup.includes('pace.arrivals = 0'),
      'a turn the backup has to end proves the timers stopped: the poll goes back to arming both',
    )
    t.true(
      stallBackup.includes('pace.settleTurn'),
      'and the backup must end whichever turn is parked, not the one that armed it',
    )
    // By due time, never by how long the parked turn has been waiting. A host
    // runs its timers in due order, so a backup that runs while a turn due a
    // window earlier is still parked proves that turn's timer was dropped —
    // and a healthy turn, whose timer runs first and clears `settleTurn`, is
    // never touched. Measuring the wait instead has a phase hole: arms spaced
    // further apart than the window leave the turn that parks between them
    // with no backup young enough to rescue it.
    t.regex(
      stallBackup,
      /pace\.turnTimerDueAt > (?:__)?dueAt - __WASM_RUNTIME_WORK_POLL_STALL_MS/,
      'the backup must judge by due time, so there is no phase to fall through',
    )
    t.false(
      stallBackup.includes('Date.now() -'),
      'and it must not measure how long the parked turn has waited',
    )
    t.true(
      yieldTurn.includes('pace.settleTurn = undefined'),
      'a turn that ends must stop being the parked one, or a later backup reads a due time already answered',
    )
    t.regex(
      yieldTurn,
      /if \(__settled\??\) \{\s*return\s*\}|if \(settled\) \{\s*return\s*\}/,
      'whichever primitive loses the race must resolve nothing: one poll per turn',
    )
    // The threaded node loader routes the poll's end through a crash check
    // first: after a worker died, `…_finish` would join the dead thread's work.
    // See `node WASI disposal stops the barrier poll when a worker crashes
    // mid-flight`.
    const crashLatched = code.includes('finishCleanupUnlessCrashed')
    t.true(
      code.includes(
        crashLatched
          ? '.then(finishCleanupUnlessCrashed, finishCleanupUnlessCrashed)'
          : barrier.finish,
      ),
      'finish must run whether the poll ended, timed out or could not run at all',
    )
    // The one caller that cannot yield is the raw `Context.destroy()` the
    // wrapper intercepts, and the queue it leaves behind is discarded by the
    // destroy that follows. Say so, once, without throwing.
    t.true(
      code.includes(barrier.report),
      'the single-call barrier must report settlements nothing can reach any more',
    )
    // The window between the halves spans real event-loop turns, so a caller
    // that cannot yield — the CJS 'exit' teardown, the managed beforeExit one —
    // can land in the middle of one. It cannot wait for the poll; it has to
    // close the handshake itself, because `…_finish` is the call that joins and
    // lowers the barrier. Without this the context is destroyed with the
    // barrier still raised, the runtime never joined and the destroy recorded
    // as done.
    t.is(
      code.split(barrier.publishParked).length - 1,
      1,
      'the poll must publish a closer before it yields',
    )
    t.is(
      code.split(barrier.clearParked).length - 1,
      // Plus the crash abort, which retracts it instead of finishing.
      crashLatched ? 2 : 1,
      'finishing the handshake must retract that closer exactly once',
    )
    const parkedIndex = code.indexOf(`const ${barrier.parked}`)
    t.true(
      parkedIndex > 0 || code.includes(`let ${barrier.parked}`),
      'the closer must live outside the barrier, where a non-yielding caller can reach it',
    )
    // And the single call is where it is reached: every teardown path runs the
    // barrier through it before destroying, so closing a parked handshake there
    // covers all of them at once.
    const isEager = barrier.parked === '__finishParkedWasmEnvCleanup'
    const prepareStart = code.indexOf(
      isEager
        ? `function ${barrier.fallback.replace('()', '')}() {`
        : `const ${barrier.fallback.replace('()', '')} = () => {`,
    )
    t.true(prepareStart > 0, 'the single-call barrier must be one function')
    const prepareBody = code.slice(
      prepareStart,
      code.indexOf(isEager ? '\n}\n' : '\n  }\n', prepareStart),
    )
    const closerIndex = prepareBody.indexOf(barrier.parked)
    t.true(
      closerIndex > 0,
      'the single call must close a parked handshake instead of skipping the barrier',
    )
    t.true(
      closerIndex < prepareBody.indexOf('napi_prepare_wasm_env_cleanup'),
      'and it must close it before looking the single-call export up: a parked handshake is already begun',
    )
  })
}

// The loaders order their own teardown barrier-then-destroy, but the emnapi
// context is a live object: an embedder or test harness holding it, or emnapi's
// own `beforeExit` auto-destroy on a host where `suppressDestroy()` is absent,
// can call `Context.destroy()` directly. `destroy()` disables JavaScript calls
// before it runs cleanup hooks, so a raw call discards the very settlements the
// barrier exists to cancel and deliver. Own the ordering on the object: every
// flavor shadows `destroy` once, at creation, before anything can reach it.
const CONTEXT_DESTROY_WRAP_SIGNATURE =
  'function __wrapEmnapiContextDestroyForSettlement('

// The shared barrier's own in-flight flag, and the probe the wrapper reads it
// through. It cannot live in the wrapper: `dispose()` runs the barrier itself
// and only then calls `destroy()`, so a wrapper-local flag would still be clear
// while the barrier is running and would let a reentrant destroy through.
const preparingBarrierGuards = {
  shared: {
    probe: '__isPreparingWasmEnvCleanup',
    // Both barrier entry points read it: the single call and the two-phase
    // form, which keeps it raised across the turns it yields. The single call
    // splits the check in two, because a handshake parked between the halves is
    // one it closes rather than refuses — see the two-phase test above — so the
    // shape below is the reentrancy half alone.
    entryGuard: `  if (__emnapiWasmEnvCleanupPreparing) {
    return
  }`,
    twoPhaseEntryGuard: `  if (__emnapiWasmEnvCleanupPrepared || __emnapiWasmEnvCleanupPreparing) {
    return
  }`,
    snippets: [
      'let __emnapiWasmEnvCleanupPreparing = false',
      `function __isPreparingWasmEnvCleanup() {
  return __emnapiWasmEnvCleanupPreparing
}`,
      `    __emnapiWasmEnvCleanupPreparing = true
    try {
      prepare()
    } finally {
      __emnapiWasmEnvCleanupPreparing = false
    }`,
    ],
  },
  deferred: {
    probe: '__isPreparingEnvCleanup',
    entryGuard: `    if (__wasmEnvCleanupPreparing) {
      return
    }`,
    twoPhaseEntryGuard: `    if (__wasmEnvCleanupPrepared || __wasmEnvCleanupPreparing) {
      return
    }`,
    snippets: [
      'let __wasmEnvCleanupPreparing = false',
      'const __isPreparingEnvCleanup = () => __wasmEnvCleanupPreparing',
      `      __wasmEnvCleanupPreparing = true
      try {
        __prepareWasmEnvCleanup()
      } finally {
        __wasmEnvCleanupPreparing = false
      }`,
    ],
  },
} as const

// A nested `destroy()` must answer `undefined` without touching the real one:
// no fallthrough, no deferral. `Context.destroy()` is typed `void`, so nothing
// observable is lost, and the frame that started the barrier destroys the
// moment it returns.
const NESTED_DESTROY_NO_OP = `        if (isPreparingEnvCleanup?.()) {
          return
        }
        prepareEnvCleanup?.()`

const wrappedContextCreationCases: Array<{
  name: string
  code: string
  prepare: string
  guard: (typeof preparingBarrierGuards)[keyof typeof preparingBarrierGuards]
}> = [
  {
    name: 'node cjs',
    code: createWasiBinding('test', '@scope/test'),
    prepare: '__prepareWasmEnvCleanup',
    guard: preparingBarrierGuards.shared,
  },
  {
    name: 'node cjs threadless',
    code: createWasiBinding('test', '@scope/test', 4000, 65536, false),
    prepare: '__prepareWasmEnvCleanup',
    guard: preparingBarrierGuards.shared,
  },
  {
    name: 'browser esm',
    code: createWasiBrowserBinding('test'),
    prepare: '__prepareWasmEnvCleanup',
    guard: preparingBarrierGuards.shared,
  },
  {
    name: 'deferred/workerd',
    code: createWasiDeferredBrowserBinding('test'),
    prepare: '__prepareEnvCleanup',
    guard: preparingBarrierGuards.deferred,
  },
]

for (const { name, code, prepare, guard } of wrappedContextCreationCases) {
  test(`WASI loader runs the barrier on a raw context.destroy(): ${name}`, (t) => {
    assertValidJS(t, code, name)
    t.is(
      code.split(CONTEXT_DESTROY_WRAP_SIGNATURE).length - 1,
      1,
      'loader must define the destroy wrapper exactly once',
    )
    // No unwrapped context may escape: there is exactly one createContext call
    // and it is the wrapper's argument.
    t.is(
      code.split('__emnapiCreateContext({ autoDestroy: false })').length - 1,
      1,
      'loader must create exactly one emnapi context',
    )
    t.true(
      code
        .replace(/\s+/g, ' ')
        .includes(
          '__emnapiContext = __wrapEmnapiContextDestroyForSettlement( ' +
            `__emnapiCreateContext({ autoDestroy: false }), ${prepare}, ${guard.probe}, )`,
        ),
      'the createContext result must be wrapped before anything can reach it',
    )
    // Ordering is the whole point: barrier first, real destroy second.
    const wrapperStart = code.indexOf(CONTEXT_DESTROY_WRAP_SIGNATURE)
    const wrapper = code.slice(
      wrapperStart,
      code.indexOf('\n}\n', wrapperStart),
    )
    t.true(
      wrapper.indexOf('prepareEnvCleanup?.()') <
        wrapper.indexOf('Reflect.apply(destroy, this, arguments)'),
      'the barrier must run before the real destroy, while the env can still call into JavaScript',
    )
  })

  // The barrier settles the promises it cancels *synchronously*, under a
  // lifecycle mutex the addon cannot acquire twice. A `promiseHooks.onSettled`
  // handler — or the `async_hooks` hook `AsyncLocalStorage` installs — that
  // calls `destroy()` therefore re-enters the wrapper from inside the barrier,
  // and a second trip into the export aborts the wasm instance outright. The
  // flag lives in the barrier, not in the wrapper, so the same guard covers the
  // `dispose()` path, where the barrier runs before `destroy()` is ever called.
  test(`WASI loader makes a destroy reentered from the barrier a no-op: ${name}`, (t) => {
    for (const snippet of guard.snippets) {
      t.is(
        code.split(snippet).length - 1,
        1,
        `barrier must carry its in-flight guard exactly once: ${snippet}`,
      )
    }
    // Both barrier entry points — the single call and the two-phase form —
    // refuse to re-enter a barrier already in flight. The two-phase form still
    // tests the pair in one condition; the single call tests the reentrancy
    // half on its own, after it has dealt with a parked handshake.
    t.is(
      code.split(guard.entryGuard).length - 1,
      1,
      'the single call must refuse to re-enter a barrier already in flight',
    )
    t.is(
      code.split(guard.twoPhaseEntryGuard).length - 1,
      1,
      'the two-phase barrier must refuse to re-enter a barrier already in flight',
    )
    t.is(
      code.split(NESTED_DESTROY_NO_OP).length - 1,
      1,
      'a destroy reentered while the barrier is in flight must return without running the barrier or the real destroy',
    )
    const wrapperStart = code.indexOf(CONTEXT_DESTROY_WRAP_SIGNATURE)
    const wrapper = code.slice(
      wrapperStart,
      code.indexOf('\n}\n', wrapperStart),
    )
    t.true(
      wrapper.indexOf('isPreparingEnvCleanup?.()') <
        wrapper.indexOf('Reflect.apply(destroy, this, arguments)'),
      'the reentry check must come before the real destroy',
    )
  })
}

// The nested-destroy no-op above is only safe because the frame that started
// the barrier destroys as soon as the barrier returns. The deferred loader's
// instance `dispose()` is the one frame that does not: it runs the barrier and
// then yields for the settlement drain. So a promise hook firing inside that
// barrier can call the same instance's `dispose()` again, reach the context
// destroyer while the outer frame is still parked in its drain, and have the
// wrapper's no-op recorded as a completed destroy — after which the outer frame
// skips the real one and the context is retained with its cleanup hooks unrun.
// dispose() has to coalesce, the way the eager loaders' `__disposeWasiBinding`
// does, and the memo has to be in place *before* the barrier runs.
test('deferred WASI loader coalesces a reentrant instance dispose()', (t) => {
  const code = createWasiDeferredBrowserBinding('test')
  assertValidJS(t, code, 'deferred/workerd')
  t.is(
    code.split('let __instanceDisposePromise').length - 1,
    1,
    'the instance must carry exactly one disposal memo',
  )
  const disposeStart = code.indexOf('const __disposeInstance = () => {')
  t.true(disposeStart > 0, 'dispose() must go through a coalescing wrapper')
  const disposeWrapper = code.slice(
    disposeStart,
    code.indexOf('\n  }\n', disposeStart),
  )
  t.true(
    disposeWrapper.includes(`    if (__instanceDisposePromise) {
      return __instanceDisposePromise
    }`),
    'a reentrant dispose() must join the disposal already running',
  )
  // The memo has to be published before the disposal body — and therefore
  // before the barrier — runs, or a hook that fires inside the barrier still
  // finds it unset and starts a second frame.
  t.true(
    disposeWrapper.indexOf('__instanceDisposePromise = __disposePromise') <
      disposeWrapper.indexOf('__runInstanceDisposal()'),
    'the memo must be published before the disposal body runs',
  )
  // Still retryable: the drain can reject on its own (a host `setImmediate`
  // that throws), and dispose() has to be callable again after that.
  t.true(
    disposeWrapper.includes(`      __instanceDisposePromise = undefined
      __rejectDispose(__error)`),
    'a failed disposal must clear the memo so dispose() stays retryable',
  )
  // No second entry point into the disposal body: the instance exposes the
  // coalescing wrapper itself, not an inline method that re-runs it.
  t.true(
    code.includes('      dispose: __disposeInstance,'),
    'the instance must expose the coalescing wrapper as its dispose()',
  )
  t.false(
    code.includes('      async dispose() {'),
    'the instance must not carry a second inline dispose() method',
  )
  t.is(
    code.split('__prepareForDisposal()').length - 1,
    2,
    'only the disposal body and the initialization rollback may prepare for disposal',
  )
})

// Belt and braces for any caller that still reaches the managed destroyer from
// inside the barrier: a `Context.destroy()` the wrapper skipped must never be
// recorded as a completed destroy, or every later destroy — the outer disposal
// frame's and managed beforeExit cleanup's alike — is skipped with it.
test('deferred WASI loader never records a skipped destroy as completed', (t) => {
  const code = createWasiDeferredBrowserBinding('test')
  const destroyStart = code.indexOf('const __destroy = (')
  t.true(destroyStart > 0, 'deferred loader must define a managed destroyer')
  const destroyer = code.slice(
    destroyStart,
    code.indexOf('\n  const __destroyForModuleLifecycle', destroyStart),
  )
  t.true(
    destroyer.includes(`      if (__isPreparingEnvCleanup?.()) {`),
    'the managed destroyer must detect that the barrier is in flight',
  )
  const guardIndex = destroyer.indexOf('if (__isPreparingEnvCleanup?.()) {')
  const destroyIndex = destroyer.indexOf('__result = __emnapiContext.destroy()')
  t.true(
    guardIndex < destroyIndex,
    'the in-flight check must come before the destroy it would skip',
  )
  t.true(
    destroyer
      .slice(guardIndex, destroyIndex)
      .includes(`throw __createLifecycleReentryError('dispose')`),
    'a destroy the wrapper would skip must fail loudly instead of flagging the context disposed',
  )
  t.true(
    destroyIndex < destroyer.indexOf('__disposed = true'),
    'nothing may be flagged disposed before the real destroy is attempted',
  )
})

test('createCjsBinding uses one statement dialect', (t) => {
  const code = createCjsBinding('test', '@scope/test', ['sum'], '1.0.0', [
    'wasm32-wasi',
  ])
  t.false(
    code.includes('NAPI_RS_NATIVE_LIBRARY_PATH);'),
    'native library require must not use a leftover semicolon',
  )
  t.true(code.includes("const __napiWasiFlavors = ['wasm32-wasi']"))
  t.false(code.includes('"wasm32-wasi"'))
  t.true(code.includes("return require('./test.win32-x64-gnu.node')"))
  const win32Gnu = code.slice(
    code.indexOf("process.arch === 'x64'"),
    code.indexOf("process.arch === 'ia32'"),
  )
  t.true(
    win32Gnu.includes("          return require('./test.win32-x64-gnu.node')"),
    'win32-x64 gnu local require must be indented inside try',
  )
})

test('the root CommonJS loader stamps before it aliases the addon', (t) => {
  // The guard is safe against an addon accessor — `hasOwnProperty` and a read —
  // but an assignment is not: a `#[napi(module_exports)]` hook can expose a
  // getter reporting the value about to be stamped and a setter that throws.
  // So the lexer-visible assignment has to land on the loader's own
  // `module.exports`, while it is still the original object.
  const cjs = createCjsBinding('test', '@scope/test', ['sum'], '1.0.0')
  assertValidJS(t, cjs, 'root cjs stamp before alias')
  const stamp = cjs.indexOf(ROOT_CJS_STAMP_CALL)
  t.true(stamp > -1, 'the root loader must stamp through the guard')
  t.true(
    stamp < cjs.indexOf('\nmodule.exports = nativeBinding'),
    'the stamp must precede the alias, or it assigns onto the addon',
  )
  // the guard still stamps the object the loader hands out
  t.false(cjs.includes('__napiStampBindingTarget(module.exports,'))
})

test('native loaders export the artifact that actually loaded', (t) => {
  const flavors = ['wasm32-wasi', 'wasm32-wasip1']
  const cjs = createCjsBinding('test', '@scope/test', ['sum'], '1.0.0', flavors)
  assertValidJS(t, cjs, 'cjs binding target')
  t.true(cjs.includes("let __napiLoadedBindingTarget = 'native'"))
  t.true(cjs.includes(ROOT_CJS_STAMP_CALL))
  // one assignment per candidate: 2 flavors x (local loader + flavor package)
  for (const flavor of flavors) {
    t.is(
      cjs.split(`__napiLoadedBindingTarget = '${flavor}'`).length - 1,
      2,
      `${flavor} must be recorded on both its local and package candidates`,
    )
  }
  // the target is never read back off the WASI module
  t.false(cjs.includes('wasiBinding.__napiBindingTarget'))

  const esm = createEsmBinding('test', '@scope/test', ['sum'], '1.0.0', flavors)
  assertValidJS(t, esm, 'esm binding target')
  t.true(
    esm.includes(
      'export const __napiBindingTarget = __napiLoadedBindingTarget',
    ),
  )
  // zero-ident packages take the `export default` branch and must keep it
  const esmNoIdents = createEsmBinding(
    'test',
    '@scope/test',
    [],
    '1.0.0',
    flavors,
  )
  assertValidJS(t, esmNoIdents, 'esm binding target without idents')
  t.true(
    esmNoIdents.includes(
      'export const __napiBindingTarget = __napiLoadedBindingTarget',
    ),
  )
})

test('a napi export may not shadow __napiBindingTarget', (t) => {
  t.throws(
    () => createEsmBinding('test', '@scope/test', ['__napiBindingTarget']),
    {
      message: /reserved by the generated binding loader/,
    },
  )
  t.throws(
    () => createCjsBinding('test', '@scope/test', ['__napiBindingTarget']),
    {
      message: /reserved by the generated binding loader/,
    },
  )
})

test('WASI loaders self-identify their flavor', (t) => {
  t.true(
    createWasiBinding('test', '@scope/test').includes(
      "const __napiBindingTarget = 'wasm32-wasi'",
    ),
  )
  t.true(
    createWasiBinding(
      'test',
      '@scope/test',
      4000,
      65536,
      false,
      'wasm32-wasip1',
    ).includes("const __napiBindingTarget = 'wasm32-wasip1'"),
  )
  t.true(
    createWasiBrowserBinding('test').includes(
      "export const __napiBindingTarget = 'wasm32-wasi'",
    ),
  )
  t.true(
    createWasiBrowserBinding(
      'test',
      4000,
      65536,
      false,
      false,
      false,
      false,
      false,
    ).includes("export const __napiBindingTarget = 'wasm32-wasip1'"),
  )
  t.true(
    createWasiDeferredBrowserBinding('test').includes(
      "export const __napiBindingTarget = 'wasm32-wasip1'",
    ),
  )
})

const STAMP_HELPER_DECL =
  'function __napiStampBindingTarget(exportsObject, target) {'
const WASI_STAMP_CALL =
  '__napiStampBindingTarget(__napiModule.exports, __napiBindingTarget)'
// The CJS loaders assign the guard's return value instead of calling it as a
// statement: `cjs-module-lexer` only reports `__napiBindingTarget` as a named
// export when it can see `module.exports.<name> =`, and Node's CJS->ESM named
// export detection is that lexer.
const ROOT_CJS_STAMP_CALL =
  'module.exports.__napiBindingTarget = __napiStampBindingTarget(nativeBinding, __napiLoadedBindingTarget)'
// The node WASI loader stamps the emnapi exports object — the one the CommonJS
// tail then aliases — while assigning through `module.exports` for the lexer.
const WASI_CJS_STAMP_LINE = `module.exports.__napiBindingTarget = ${WASI_STAMP_CALL}`
// the call inside the initialization try, not the function declaration
const WASI_EXIT_LISTENER_CALL = '\n  __registerWasiExitListener()'
// nothing may write the marker onto a user-controlled exports object without
// going through the guard, so an assignment is only legal when the guard call
// is its right-hand side
const UNGUARDED_MODULE_EXPORTS_STAMP =
  /module\.exports\.__napiBindingTarget = (?!__napiStampBindingTarget\()/

test('browser and deferred loaders carry the flavor on the binding they hand out', (t) => {
  // `export default __napiModule.exports` and `instantiate()` hand out the raw
  // emnapi exports object, which a named module export does not travel with.
  const browser = createWasiBrowserBinding('test')
  assertValidJS(t, browser, 'browser binding target on exports')
  t.true(browser.includes(WASI_STAMP_CALL))
  const deferred = createWasiDeferredBrowserBinding('test')
  assertValidJS(t, deferred, 'deferred binding target on exports')
  t.is(
    deferred.split(WASI_STAMP_CALL).length - 1,
    1,
    'every instance created by __createInstance must be marked exactly once',
  )
  // the marker is assigned before the instance escapes to the caller
  t.true(
    deferred.indexOf(WASI_STAMP_CALL) <
      deferred.indexOf('exports: __napiModule.exports'),
  )
})

test('every mutating loader stamps the binding target through the guard', (t) => {
  const cases: Array<{ name: string; code: string; call?: string }> = [
    {
      name: 'root cjs',
      code: createCjsBinding('test', '@scope/test', ['sum'], '1.0.0'),
      call: ROOT_CJS_STAMP_CALL,
    },
    {
      name: 'wasi node cjs',
      code: createWasiBinding('test', '@scope/test'),
      call: WASI_CJS_STAMP_LINE,
    },
    {
      name: 'wasi browser esm',
      code: createWasiBrowserBinding('test'),
      call: WASI_STAMP_CALL,
    },
    {
      name: 'wasi deferred esm',
      code: createWasiDeferredBrowserBinding('test'),
      call: WASI_STAMP_CALL,
    },
  ]
  for (const { name, code, call } of cases) {
    assertValidJS(t, code, `${name} stamp guard`)
    t.is(
      code.split(STAMP_HELPER_DECL).length - 1,
      1,
      `${name} must emit the guard exactly once`,
    )
    if (call) {
      t.is(
        code.split(call).length - 1,
        1,
        `${name} must stamp exactly once, through the guard`,
      )
    }
    // [[Define]], not [[Set]]: an ordinary assignment walks the prototype
    // chain, so an inherited accessor on a user-controlled exports object could
    // swallow the marker or throw and fail an otherwise successful load
    t.true(
      code.includes(
        "Object.defineProperty(exportsObject, '__napiBindingTarget'",
      ),
      `${name} must define the marker as an own data property`,
    )
    t.false(
      code.includes('exportsObject.__napiBindingTarget = target'),
      `${name} must not stamp the marker through an ordinary assignment`,
    )
    // an addon's exports object is user-controlled: nothing may write the
    // marker onto it without going through the guard
    t.false(
      UNGUARDED_MODULE_EXPORTS_STAMP.test(code),
      `${name} must not assign the marker onto module.exports directly`,
    )
    t.false(
      code.includes('__napiModule.exports.__napiBindingTarget ='),
      `${name} must not assign the marker onto the emnapi exports directly`,
    )
  }
})

test('the node WASI loader stamps inside the rollback boundary', (t) => {
  // Anything the guard throws — a conflicting `#[napi(module_exports)]` export,
  // or an addon accessor whose setter refuses the write — has to land in the
  // initialization `try`. From outside it the throw escapes with the emnapi
  // context built and the process 'exit' listener installed, so a failed
  // `require()` leaks an initialized WASI environment nothing can reach.
  const code = createWasiBinding('test', '@scope/test')
  assertValidJS(t, code, 'wasi node cjs rollback boundary')
  const initializationCatch = '\n} catch (error) {'
  t.is(
    code.split(initializationCatch).length - 1,
    1,
    'the top-level initialization catch must be unambiguous',
  )
  // exactly one, so nothing can stamp a second time outside the boundary
  t.is(code.split('module.exports.__napiBindingTarget =').length - 1, 1)
  const stamp = code.indexOf(WASI_CJS_STAMP_LINE)
  t.true(stamp > code.indexOf('__publishWasiDispose(__napiModule.exports)'))
  t.true(stamp < code.indexOf(WASI_EXIT_LISTENER_CALL))
  t.true(stamp < code.indexOf(initializationCatch))
  // and the rollback the catch runs is the one that tears the environment down
  t.true(code.includes('__runWasiInitializationRollback(rollback)'))
})

/**
 * Every loader that stamps an addon-owned exports object, with the marker that
 * ends its initialization guard and the host installation that must precede the
 * stamp. A host install hands that same object to addon-provided registration
 * functions, which can put anything on it — including this marker — so a stamp
 * placed before them reads a state that is not final.
 */
const HOST_INSTALL_ORDER_CASES = [
  {
    name: 'wasi node cjs',
    build: (asyncRuntime: boolean) =>
      createWasiBinding(
        'test',
        '@scope/test',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        asyncRuntime,
      ),
    stamp: WASI_CJS_STAMP_LINE,
    hostInstall: '__installCurrentThreadHosts(',
    endOfGuard: WASI_EXIT_LISTENER_CALL,
  },
  {
    name: 'wasi browser esm',
    build: (asyncRuntime: boolean) =>
      createWasiBrowserBinding(
        'test',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        asyncRuntime,
      ),
    stamp: WASI_STAMP_CALL,
    hostInstall: '__installCurrentThreadHosts(',
    endOfGuard: '\n} catch (error) {',
  },
  {
    name: 'wasi deferred esm',
    build: (asyncRuntime: boolean) =>
      createWasiDeferredBrowserBinding(
        'test',
        undefined,
        undefined,
        undefined,
        undefined,
        asyncRuntime,
      ),
    stamp: WASI_STAMP_CALL,
    hostInstall: '__registerWorkerdCurrentThreadTaskHost(',
    endOfGuard: "__lifecycleState === 'pending'",
  },
] as const

for (const {
  name,
  build,
  stamp,
  hostInstall,
  endOfGuard,
} of HOST_INSTALL_ORDER_CASES) {
  test(`${name} stamps the binding object after its host installation`, (t) => {
    const withHosts = build(true)
    assertValidJS(t, withHosts, `${name} asyncRuntime stamp order`)
    const hostInstallAt = withHosts.indexOf(hostInstall)
    t.true(hostInstallAt > -1, 'the asyncRuntime host install must be emitted')
    const stampAt = withHosts.indexOf(stamp)
    t.true(stampAt > hostInstallAt, 'the stamp must follow the host install')
    t.true(
      stampAt < withHosts.indexOf(endOfGuard),
      'the stamp must stay inside the initialization guard',
    )

    // and without an async runtime the stamp keeps that same place: last thing
    // before the guard closes, so nothing can reshape the object behind it
    const withoutHosts = build(false)
    assertValidJS(t, withoutHosts, `${name} stamp order`)
    t.is(withoutHosts.indexOf(hostInstall), -1)
    t.true(withoutHosts.indexOf(stamp) < withoutHosts.indexOf(endOfGuard))
  })
}

test('the deferred loader marks the binding without requiring an extensible exports object', (t) => {
  const deferred = createWasiDeferredBrowserBinding('test')
  assertValidJS(t, deferred, 'deferred guarded stamp')
  // a `#[napi(module_exports)]` hook may have sealed or frozen this object
  t.true(deferred.includes('if (!Object.isExtensible(exportsObject)) {'))
  // and it may have claimed the name, which is a hard error, not a silent
  // overwrite — with a stable `code` to branch on
  t.true(
    deferred.includes(
      "Object.prototype.hasOwnProperty.call(exportsObject, '__napiBindingTarget')",
    ),
  )
  t.true(deferred.includes("error.code = 'ERR_NAPI_BINDING_TARGET_CONFLICT'"))
})

test('every emitted loader says what its own entry reports after a skipped stamp', (t) => {
  // The runtime is pinned by build.spec.ts (`a frozen addon keeps
  // __napiBindingTarget importable, just undefined`): both CommonJS entries
  // replace `module.exports` with the object the stamp was skipped on, so the
  // value is absent there, while the ESM loaders keep a module-level export.
  // The comment shipped inside every loader has to describe that split rather
  // than promise the module export survives everywhere.
  for (const [name, code] of [
    ['root cjs', createCjsBinding('test', '@scope/test', ['sum'], '1.0.0')],
    ['wasi node cjs', createWasiBinding('test', '@scope/test')],
    ['wasi browser esm', createWasiBrowserBinding('test')],
    ['wasi deferred esm', createWasiDeferredBrowserBinding('test')],
  ] as const) {
    assertValidJS(t, code, `${name} skip contract`)
    t.false(
      code.includes('module export still reports it'),
      `${name} must not claim every entry still reports the target`,
    )
    t.true(
      code.includes('while the CommonJS entries hand back'),
      `${name} must say the CommonJS entries lose the value`,
    )
  }

  // and the root CommonJS loader's own note about its lexer-visible assignment:
  // that assignment lands on the loader's own `module.exports`, so it always
  // succeeds and the alias on the next line is what discards it
  const cjs = createCjsBinding('test', '@scope/test', ['sum'], '1.0.0')
  t.false(
    cjs.includes('is a silent no-op'),
    'the assignment is not a no-op; its target is extensible',
  )
  t.true(
    cjs.includes('The assignment itself always succeeds'),
    'the root CommonJS loader must not call its own assignment a no-op',
  )
  t.true(
    cjs.includes('own, still extensible `module.exports`'),
    'the root CommonJS loader must name its real assignment target',
  )
})

test('NAPI_RS_NATIVE_LIBRARY_PATH keeps the flavor its override reports', (t) => {
  const adoption = `__napiLoadedBindingTarget =
        overrideBinding && typeof overrideBinding.__napiBindingTarget === 'string'
          ? overrideBinding.__napiBindingTarget
          : 'native'`
  for (const [name, code] of [
    ['cjs', createCjsBinding('test', '@scope/test', ['sum'], '1.0.0')],
    ['esm', createEsmBinding('test', '@scope/test', ['sum'], '1.0.0')],
  ] as const) {
    assertValidJS(t, code, `${name} override binding target`)
    t.true(code.includes(adoption), `${name} must adopt the override's target`)
    // the override result must not be returned before it is inspected
    t.false(
      code.includes('return require(process.env.NAPI_RS_NATIVE_LIBRARY_PATH)'),
      `${name} must bind the override before returning it`,
    )
  }
})

test('WASI worker template matches the CJS/ESM quote and semicolon dialect', (t) => {
  t.true(WASI_WORKER_TEMPLATE.includes("import fs from 'node:fs'"))
  t.false(WASI_WORKER_TEMPLATE.includes('from "node:fs"'))
  t.false(WASI_WORKER_TEMPLATE.includes("from 'node:fs';"))
  t.true(WASI_WORKER_TEMPLATE.includes('memory: wasmMemory,'))
})

test('createEsmBinding is Node 12 compatible', (t) => {
  const code = createEsmBinding('test', '@scope/test', ['sum'])
  assertValidJS(t, code, 'esm')
  t.false(
    NODE_SCHEME_RE.test(code),
    'ESM loader must not use the node: scheme (incl. `import ... from "node:module"`)',
  )
  t.false(code.includes('?.'), 'ESM loader must not use optional chaining')
  t.false(code.includes('??'), 'ESM loader must not use nullish coalescing')
})

test('createEsmBinding builds native addon loading on portable ESM primitives', (t) => {
  const code = createEsmBinding('test', '@scope/test', ['sum'])
  assertValidJS(t, code, 'esm')
  t.true(
    code.includes(`import { createRequire } from 'module'`),
    'ESM loader must import createRequire so native .node addons can be loaded without the CommonJS `require` global',
  )
  t.true(
    code.includes('const require = createRequire(import.meta.url)'),
    'ESM loader must derive `require` from the current module, not rely on a CommonJS global',
  )
  // `@napi-rs/cli` is a valid Node package but is not running under Deno. Deno
  // rejects `URL.pathname` treated as a filesystem path, which is exactly how a
  // `__dirname` built from `new URL('.', import.meta.url).pathname` behaves on
  // Windows (percent-encoded, forward-slash separated). The ESM native loader
  // never used `__dirname` anyway, so it must not emit that construct at all.
  t.false(
    /new URL\(['"]\.['"], import\.meta\.url\)\.pathname/.test(code),
    'ESM loader must not treat URL.pathname as a filesystem path',
  )
})

/**
 * A top-level `function <name>(` of generated code, through its closing brace
 * at column zero.
 */
function generatedFunction(code: string, name: string): string {
  const start = code.indexOf(`function ${name}(`)
  if (start === -1) {
    return ''
  }
  return code.slice(start, code.indexOf('\n}\n', start) + 2)
}

/**
 * Runs the node loader's 'exit' listener against stubbed teardown steps, with
 * the crash latch in the given state, and returns the steps it took.
 */
function runWasiExitListener(
  code: string,
  crash: { flag?: boolean; errorEvent?: boolean; fatalError?: boolean },
): string[] {
  const latchStart = code.indexOf('const __wasiThreadCrashFlag = ')
  const latchState = code.slice(
    latchStart,
    code.indexOf('let __wasiThreadCrashed = false\n', latchStart) +
      'let __wasiThreadCrashed = false\n'.length,
  )
  const steps: string[] = []
  const run = new Function(
    'steps',
    'crash',
    `
let __wasiExitListenerRegistered = true
${latchState}
function __getWasiThreadManager() {
  return {
    terminateWorker() {},
    _fatalError: crash.fatalError ? new Error('worker died') : undefined,
  }
}
function __isThenable(value) {
  return value !== null && typeof value === 'object' && typeof value.then === 'function'
}
function __destroyEmnapiContext() {
  steps.push('destroy')
}
function __terminateWasiWorkers() {
  steps.push('terminate')
}
${generatedFunction(code, '__hasWasiThreadCrashed')}
${generatedFunction(code, '__disposeWasiBindingAtExit')}
if (crash.flag) Atomics.store(__wasiThreadCrashFlag, 0, 1)
if (crash.errorEvent) __wasiThreadCrashed = true
__disposeWasiBindingAtExit()
if (__wasiExitListenerRegistered) steps.push('still registered')
`,
  )
  run(steps, crash)
  return steps
}

// A wasm thread that died can leave the shared state half-updated: a lock it
// held stays held, and the async runtime's shutdown waits for its work to go
// idle. The 'exit' teardown re-enters wasm on the JavaScript thread and blocks
// there in a raw atomic wait that no signal can interrupt, so the process hangs
// for good. After a crash the listener must only stop the workers.
test('node WASI loader skips the wasm teardown at exit after a thread crash', (t) => {
  const code = createWasiBinding('test', '@scope/test')
  assertValidJS(t, code, 'node cjs')
  t.true(code.includes('function __hasWasiThreadCrashed() {'))

  // No crash: the teardown is exactly what it was.
  t.deepEqual(runWasiExitListener(code, {}), ['destroy', 'terminate'])

  // Each of the three signals is enough on its own: the flag the worker sets
  // before it reports, the worker's 'error' event, and emnapi's fatal error.
  for (const crash of [
    { flag: true },
    { errorEvent: true },
    { fatalError: true },
  ]) {
    t.deepEqual(
      runWasiExitListener(code, crash),
      ['terminate'],
      JSON.stringify(crash),
    )
  }
})

/**
 * Runs the node loader's public disposer, and then its 'exit' listener, against
 * stubbed wasm steps with the crash latch in the given state. Every stub
 * records its name, so the steps show exactly what re-entered wasm.
 *
 * `__emnapiContext` is a stub shaped like emnapi's Node `Context`: its
 * `refCounter.refHandle` records 'port ref' / 'port unref', and every other
 * member records its name, so a step that touched the context shows up too.
 * `context` picks a context without a counter, one whose counter getter
 * throws, or no context at all.
 */
async function runWasiPublicDisposer(
  code: string,
  crash: {
    flag?: boolean
    errorEvent?: boolean
    fatalError?: boolean
    terminateThrows?: boolean
    context?: 'no counter' | 'throwing counter' | 'none'
  },
  calls = 1,
): Promise<{
  steps: string[]
  results: Array<{ value?: unknown; error?: any }>
  samePromise: boolean
  exitError?: unknown
  count?: number
}> {
  const latchStart = code.indexOf('const __wasiThreadCrashFlag = ')
  const latchState = code.slice(
    latchStart,
    code.indexOf('let __wasiThreadCrashed = false\n', latchStart) +
      'let __wasiThreadCrashed = false\n'.length,
  )
  const steps: string[] = []
  const fatalError = new Error('worker died')
  // Two requests still in flight on the dead thread.
  const refCounter = {
    count: 2,
    refHandle: {
      ref() {
        steps.push('port ref')
      },
      unref() {
        steps.push('port unref')
      },
    },
  }
  let context: object | undefined
  if (crash.context === 'no counter') {
    context = {}
  } else if (crash.context === 'throwing counter') {
    context = {
      get refCounter() {
        throw new Error('private field')
      },
    }
  } else if (crash.context !== 'none') {
    context = { refCounter }
  }
  if (context) {
    // Anything but the counter port touching the context is a wasm re-entry
    // (destroy runs the cleanup hooks) or a JS state change this path must not
    // make; record it.
    context = new Proxy(context, {
      get(target, key, receiver) {
        if (key !== 'refCounter') {
          steps.push(`context.${String(key)}`)
        }
        return Reflect.get(target, key, receiver)
      },
    })
  }
  const run = new Function(
    'steps',
    'crash',
    'fatalError',
    'calls',
    '__emnapiContext',
    `
let __wasiExitListenerRegistered = true
let __wasiDisposed = false
let __wasiDisposePromise
let __wasiThreadCrashDisposePromise
// The loader sets this to __removeWasiExitListener.
let __completeWasiDisposal = function () {
  steps.push('complete')
  __wasiExitListenerRegistered = false
}
${latchState}
function __getWasiThreadManager() {
  return {
    terminateWorker() {},
    _fatalError: crash.fatalError ? fatalError : undefined,
  }
}
function __isThenable(value) {
  return value !== null && typeof value === 'object' && typeof value.then === 'function'
}
function __drainWasiAsyncWork() {
  steps.push('async work')
}
function __prepareWasmEnvCleanupWithTurns() {
  steps.push('prepare')
}
function __drainWasmEnvCleanup() {
  steps.push('drain')
}
function __destroyEmnapiContext() {
  steps.push('destroy')
}
function __terminateWasiWorkers() {
  steps.push('terminate')
  if (crash.terminateThrows) throw new Error('terminate failed')
  return Promise.resolve()
}
${generatedFunction(code, '__createCleanupError')}
${generatedFunction(code, '__attachCleanupErrors')}
${generatedFunction(code, '__hasWasiThreadCrashed')}
${generatedFunction(code, '__readWasiThreadCrashReport')}
${generatedFunction(code, '__recordWasiThreadCrashError')}
${generatedFunction(code, '__getWasiThreadCrashError')}
${generatedFunction(code, '__fillWasiThreadCrashError')}
${generatedFunction(code, '__releaseEmnapiWaitingRequestHandle')}
${generatedFunction(code, '__disposeWasiBindingAfterThreadCrash')}
${generatedFunction(code, '__abortWasiDisposalIfThreadCrashed')}
${generatedFunction(code, '__settleWasiDisposalAfterThreadCrash')}
${generatedFunction(code, '__finishWasiDisposal')}
${generatedFunction(code, '__continueWasiDisposal')}
${generatedFunction(code, '__drainWasmEnvForWasiDisposal')}
${generatedFunction(code, '__cleanUpWasmEnvForWasiDisposal')}
${generatedFunction(code, '__startWasiDisposal')}
${generatedFunction(code, '__disposeWasiBinding')}
${generatedFunction(code, '__disposeWasiBindingAtExit')}
if (crash.flag) Atomics.store(__wasiThreadCrashFlag, 0, 1)
if (crash.errorEvent) __wasiThreadCrashed = true
return (async () => {
  const promises = []
  for (let i = 0; i < calls; i += 1) {
    promises.push(__disposeWasiBinding())
  }
  const results = []
  for (const promise of promises) {
    try {
      results.push({ value: await promise })
    } catch (error) {
      results.push({ error })
    }
  }
  let exitError
  try {
    if (__wasiExitListenerRegistered) __disposeWasiBindingAtExit()
  } catch (error) {
    exitError = error
  }
  return {
    results,
    samePromise: promises.every((promise) => promise === promises[0]),
    exitError,
  }
})()
`,
  )
  const outcome = await run(steps, crash, fatalError, calls, context)
  return { steps, ...outcome, count: refCounter.count }
}

// The published disposer runs the same wasm teardown as the 'exit' listener,
// behind an async-work drain. An app that handled the rethrown worker error
// and then disposed blocked in the same raw atomic wait. After a crash it only
// stops the workers and rejects, since nothing was cleaned up.
test('node WASI public disposer skips the wasm teardown after a thread crash', async (t) => {
  const code = createWasiBinding('test', '@scope/test')
  assertValidJS(t, code, 'node cjs')
  t.true(code.includes('let __wasiThreadCrashDisposePromise\n'))
  t.true(
    generatedFunction(code, '__disposeWasiBinding').includes(
      '  if (!__wasiDisposed && __hasWasiThreadCrashed()) {\n    return __disposeWasiBindingAfterThreadCrash()\n  }\n',
    ),
  )

  // No crash: the disposal chain is exactly what it was, and it removes the
  // 'exit' listener when it completes.
  const clean = await runWasiPublicDisposer(code, {})
  t.deepEqual(clean.steps, [
    'async work',
    'prepare',
    'drain',
    'destroy',
    'terminate',
    'complete',
  ])
  t.deepEqual(clean.results, [{ value: undefined }])

  for (const crash of [
    { flag: true },
    { errorEvent: true },
    { fatalError: true },
  ]) {
    const label = JSON.stringify(crash)
    // Three calls: every one settles the same way, and the workers are
    // terminated once by the disposer and once more by the 'exit' listener,
    // which still takes its short path and does not throw.
    const crashed = await runWasiPublicDisposer(code, crash, 3)
    t.deepEqual(crashed.steps, ['port unref', 'terminate', 'terminate'], label)
    t.true(crashed.samePromise, label)
    t.is(crashed.exitError, undefined, label)
    for (const result of crashed.results) {
      t.true(result.error instanceof Error, label)
      t.is(
        result.error.message,
        'napi-rs: WASI binding cannot be disposed after a worker thread crashed',
        label,
      )
    }
    if (crash.fatalError) {
      t.is(crashed.results[0].error.cause.message, 'worker died')
    }
  }

  // A termination failure is attached, not swallowed, and the disposer still
  // does not fall through to the wasm teardown.
  const failed = await runWasiPublicDisposer(code, {
    flag: true,
    terminateThrows: true,
  })
  t.deepEqual(failed.steps, ['port unref', 'terminate', 'terminate'])
  t.regex(failed.results[0].error.message, /worker thread crashed/)
  t.is(failed.results[0].error.cause.message, 'terminate failed')
  t.is(failed.exitError, undefined)
})

// emnapi's Node Context refs a MessagePort (refCounter.refHandle) while async
// work or threadsafe-function requests are in flight. The dead thread's requests
// never finish, so after the crash disposal rejected nothing else was left
// running and the port alone kept the process from exiting. The crash path
// unrefs it without touching anything else on the context; the no-crash path
// never touches it.
test('node WASI crash disposal releases the waiting-request port', async (t) => {
  const code = createWasiBinding('test', '@scope/test')
  const release = generatedFunction(code, '__releaseEmnapiWaitingRequestHandle')
  t.true(release.length > 0)
  t.true(
    generatedFunction(code, '__disposeWasiBindingAfterThreadCrash').includes(
      '  __releaseEmnapiWaitingRequestHandle()\n  let workerResult\n',
    ),
    'released before the workers are terminated',
  )
  // It must not destroy the context: that runs the cleanup hooks in wasm.
  t.false(release.includes('destroy'))

  // No crash: the port is left to emnapi's own count.
  const clean = await runWasiPublicDisposer(code, {})
  t.false(clean.steps.includes('port unref'))
  t.false(clean.steps.includes('port ref'))
  t.is(clean.count, 2)

  // Crash: unrefed exactly once across three disposer calls and the 'exit'
  // listener, never re-refed, and the count is left above zero so a later
  // request cannot ref the port again. No other context member is read.
  const crashed = await runWasiPublicDisposer(code, { flag: true }, 3)
  t.deepEqual(
    crashed.steps.filter((step) => step.startsWith('port ')),
    ['port unref'],
  )
  t.false(crashed.steps.some((step) => step.startsWith('context.')))
  t.is(crashed.count, 2)

  // A context without the counter (a non-Node host, a future emnapi), one
  // whose field cannot be read, or no context at all: the disposer still
  // rejects with the crash error and terminates the workers.
  for (const context of ['no counter', 'throwing counter', 'none'] as const) {
    const outcome = await runWasiPublicDisposer(code, { flag: true, context })
    t.deepEqual(outcome.steps, ['terminate', 'terminate'], context)
    t.regex(outcome.results[0].error.message, /worker thread crashed/, context)
    t.is(outcome.exitError, undefined, context)
  }
})

/**
 * Runs the node loader's real disposal chain — the async-work drain, its
 * keep-alive interval, the barrier's two-phase poll, the step boundaries and
 * the public disposer — against a stubbed addon on real timers, so a crash can
 * land while a poll is waiting. The stubs record every wasm entry and every
 * keep-alive interval, and the counters report how often each poll read.
 */
function createInflightWasiDisposal(
  code: string,
  addon: {
    asyncWorkPending: number
    runtimeWorkPending: number
    onRuntimeWorkRead?: () => void
  },
) {
  const latchStart = code.indexOf('const __wasiThreadCrashFlag = ')
  const latchState = code.slice(
    latchStart,
    code.indexOf('let __wasiThreadCrashed = false\n', latchStart) +
      'let __wasiThreadCrashed = false\n'.length,
  )
  const steps: string[] = []
  const reads = { asyncWork: 0, runtimeWork: 0 }
  const intervals = new Set<ReturnType<typeof setInterval>>()
  // Stands in for the loader's global: timers are real, keep-alive intervals
  // are recorded.
  const host = {
    setTimeout,
    clearTimeout,
    WebAssembly,
    setInterval(callback: () => void, delay: number) {
      const timer = setInterval(callback, delay)
      intervals.add(timer)
      steps.push('interval set')
      return timer
    },
    clearInterval(timer: ReturnType<typeof setInterval>) {
      clearInterval(timer)
      if (intervals.delete(timer)) {
        steps.push('interval cleared')
      }
    },
  }
  const exports = {
    napi_wasm_async_work_pending() {
      reads.asyncWork += 1
      return addon.asyncWorkPending
    },
    napi_wasm_cancel_pending_async_work() {
      steps.push('cancel')
    },
    napi_prepare_wasm_env_cleanup_begin() {
      steps.push('begin')
      return 1
    },
    napi_prepare_wasm_env_cleanup_finish() {
      steps.push('finish')
    },
    napi_wasm_runtime_work_pending() {
      reads.runtimeWork += 1
      addon.onRuntimeWorkRead?.()
      return addon.runtimeWorkPending
    },
  }
  const context = {
    refCounter: {
      refHandle: {
        ref() {
          steps.push('port ref')
        },
        unref() {
          steps.push('port unref')
        },
      },
    },
  }
  const loader = new Function(
    'globalThis',
    'steps',
    '__napiInstance',
    '__emnapiContext',
    `
let __wasiDisposed = false
let __wasiDisposePromise
let __wasiThreadCrashDisposePromise
let __wasiAsyncWorkDrainPromise
let __emnapiWasmEnvCleanupPrepared = false
let __emnapiWasmEnvCleanupPreparing = false
let __emnapiWasmEnvCleanupYielding = false
let __emnapiWasmEnvCleanupRan = false
let __finishParkedWasmEnvCleanup
let __completeWasiDisposal = function () {
  steps.push('complete')
}
let __retainWasiRollbackForRetry = function () {
  steps.push('retain')
}
const __wasiRollbackRegistry = new Map()
const __wasiRollbackRegistryKey = 'test.cjs'
${latchState}
const __WASI_ASYNC_WORK_POLL_INTERVAL_MS = 1
function __getWasiThreadManager() {
  return { terminateWorker() {} }
}
function __isThenable(value) {
  return value !== null && typeof value === 'object' && typeof value.then === 'function'
}
function __scheduleMacrotask(callback) {
  setImmediate(callback)
}
function __prepareWasmEnvCleanup() {
  steps.push('prepare (single call)')
}
function __createWasmRuntimePollPace() {
  return {}
}
function __yieldWasmRuntimePollTurn() {
  return new Promise((resolve) => globalThis.setTimeout(resolve, 1))
}
function __drainWasmEnvCleanup() {
  steps.push('drain')
}
function __destroyEmnapiContext() {
  steps.push('destroy')
}
function __terminateWasiWorkers() {
  steps.push('terminate')
  return Promise.resolve()
}
${generatedFunction(code, '__createCleanupError')}
${generatedFunction(code, '__attachCleanupErrors')}
${generatedFunction(code, '__hasWasiThreadCrashed')}
${generatedFunction(code, '__readWasiThreadCrashReport')}
${generatedFunction(code, '__recordWasiThreadCrashError')}
${generatedFunction(code, '__getWasiThreadCrashError')}
${generatedFunction(code, '__fillWasiThreadCrashError')}
${generatedFunction(code, '__releaseEmnapiWaitingRequestHandle')}
${generatedFunction(code, '__disposeWasiBindingAfterThreadCrash')}
${generatedFunction(code, '__abortWasiDisposalIfThreadCrashed')}
${generatedFunction(code, '__settleWasiDisposalAfterThreadCrash')}
${generatedFunction(code, '__scheduleTimer')}
${generatedFunction(code, '__keepEventLoopAliveUntil')}
${generatedFunction(code, '__drainWasiAsyncWork')}
${generatedFunction(code, '__prepareWasmEnvCleanupWithTurns')}
${generatedFunction(code, '__finishWasiDisposal')}
${generatedFunction(code, '__continueWasiDisposal')}
${generatedFunction(code, '__drainWasmEnvForWasiDisposal')}
${generatedFunction(code, '__cleanUpWasmEnvForWasiDisposal')}
${generatedFunction(code, '__startWasiDisposal')}
${generatedFunction(code, '__disposeWasiBinding')}
${generatedFunction(code, '__finishWasiInitializationRollback')}
${generatedFunction(code, '__destroyContextForWasiRollback')}
${generatedFunction(code, '__retainFailedWasiRollback')}
${generatedFunction(code, '__runWasiInitializationRollbackSteps')}
${generatedFunction(code, '__rollbackWasiInitialization')}
${generatedFunction(code, '__rollbackWasiInitializationAfterThreadCrash')}
${generatedFunction(code, '__completeWasiInitializationRollback')}
${generatedFunction(code, '__runWasiInitializationRollback')}
return {
  dispose: __disposeWasiBinding,
  drainAsyncWork: __drainWasiAsyncWork,
  rollback: __rollbackWasiInitialization,
  // What the loader's catch does when instantiation fails: start the rollback
  // and throw the initialization error itself.
  failInitialization(error) {
    const record = {
      active: false,
      error,
      promise: undefined,
      rollback: __rollbackWasiInitialization,
    }
    __wasiRollbackRegistry.set(__wasiRollbackRegistryKey, record)
    __runWasiInitializationRollback(record)
    return record
  },
  registered() {
    return __wasiRollbackRegistry.has(__wasiRollbackRegistryKey)
  },
  // The loader's own 'error' listener.
  workerError(error, threadId) {
    __wasiThreadCrashed = true
    __recordWasiThreadCrashError(error, threadId)
  },
  crash() {
    Atomics.store(__wasiThreadCrashFlag, 0, 1)
  },
  parked() {
    return __finishParkedWasmEnvCleanup !== undefined
  },
}
`,
  )(host, steps, { exports }, context)
  return {
    ...(loader as {
      dispose: () => Promise<unknown>
      drainAsyncWork: () => Promise<unknown> | undefined
      rollback: () => unknown
      failInitialization: (error: unknown) => {
        active: boolean
        error: any
        promise: Promise<void> | undefined
      }
      registered: () => boolean
      workerError: (error: unknown, threadId: number) => void
      crash: () => void
      parked: () => boolean
    }),
    steps,
    reads,
    liveIntervals: () => intervals.size,
  }
}

async function waitUntil(condition: () => boolean, label: string) {
  const deadline = Date.now() + 5000
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${label}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
}

async function settleWithin(promise: Promise<unknown>, ms = 2000) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ pending: true }), ms)
  })
  try {
    return await Promise.race([
      promise.then(
        (value) => ({ value }),
        (error) => ({ error }),
      ),
      timeout,
    ])
  } finally {
    clearTimeout(timer)
  }
}

const CRASH_DISPOSAL_MESSAGE =
  'napi-rs: WASI binding cannot be disposed after a worker thread crashed'

// The entry check only sees a crash that came first. A worker that dies while
// dispose() is waiting leaves the async-work drain polling a count the dead
// thread never releases, and its 1 ms timer plus the 50 ms keep-alive interval
// held the process open for good with the promise pending. The drain now stops
// on the next turn and the disposer rejects through the crash disposal.
test('node WASI disposal stops the async-work drain when a worker crashes mid-flight', async (t) => {
  const code = createWasiBinding('test', '@scope/test')
  const binding = createInflightWasiDisposal(code, {
    asyncWorkPending: 1,
    runtimeWorkPending: 0,
  })
  const first = binding.dispose()
  await waitUntil(() => binding.reads.asyncWork >= 5, 'the drain to poll')
  t.is(binding.liveIntervals(), 1, 'the keep-alive interval is armed')
  binding.crash()
  // A caller that arrives before the poll notices joins the same disposal.
  const joined = binding.dispose()
  const outcome: any = await settleWithin(first)
  t.falsy(outcome.pending, 'the original promise settles')
  t.true(outcome.error instanceof Error)
  t.is(outcome.error.message, CRASH_DISPOSAL_MESSAGE)
  t.is(joined, first)
  // Every later call gets the same promise, and it stays rejected.
  const later = binding.dispose()
  t.is(later, first)
  t.is(((await settleWithin(later)) as any).error, outcome.error)

  t.is(binding.liveIntervals(), 0, 'the keep-alive interval is cleared')
  const readsAfter = binding.reads.asyncWork
  await new Promise((resolve) => setTimeout(resolve, 20))
  t.is(binding.reads.asyncWork, readsAfter, 'the drain stopped polling')
  // Nothing re-entered the barrier, the context or the addon after the crash;
  // the port is released and the workers terminated exactly once.
  t.deepEqual(binding.steps, [
    'cancel',
    'interval set',
    'interval cleared',
    'port unref',
    'terminate',
  ])
})

// Same race one step later: the drain passed, the barrier's two-phase form
// began, and its poll waits for runtime work the dead thread still counts.
// `…_finish` would join that work and block this thread for good, so the
// barrier is left parked and never finished.
test('node WASI disposal stops the barrier poll when a worker crashes mid-flight', async (t) => {
  const code = createWasiBinding('test', '@scope/test')
  for (const workDrainsWithCrash of [false, true]) {
    const label = `work drains in the crash turn: ${workDrainsWithCrash}`
    const addon: Parameters<typeof createInflightWasiDisposal>[1] = {
      asyncWorkPending: 0,
      runtimeWorkPending: 1,
    }
    const binding = createInflightWasiDisposal(code, addon)
    const first = binding.dispose()
    await waitUntil(() => binding.reads.runtimeWork >= 5, 'the barrier to poll')
    t.true(binding.parked(), label)
    if (workDrainsWithCrash) {
      // The thread dies while the poll is reading, and the count it reads is
      // zero: the poll returns normally and would go straight on to
      // `…_finish`.
      await new Promise<void>((resolve) => {
        addon.onRuntimeWorkRead = () => {
          addon.onRuntimeWorkRead = undefined
          binding.crash()
          addon.runtimeWorkPending = 0
          resolve()
        }
      })
    } else {
      binding.crash()
    }
    const outcome: any = await settleWithin(first)
    t.falsy(outcome.pending, label)
    t.is(outcome.error?.message, CRASH_DISPOSAL_MESSAGE, label)
    t.is(binding.dispose(), first, label)
    t.false(binding.parked(), label)
    const readsAfter = binding.reads.runtimeWork
    await new Promise((resolve) => setTimeout(resolve, 20))
    t.is(binding.reads.runtimeWork, readsAfter, label)
    t.is(binding.liveIntervals(), 0, label)
    t.deepEqual(binding.steps, ['begin', 'port unref', 'terminate'], label)
  }
})

// Without a crash the same chain runs every step exactly as before and
// resolves; the keep-alive interval lives only as long as the drain.
test('node WASI disposal without a crash runs the whole chain on real timers', async (t) => {
  const code = createWasiBinding('test', '@scope/test')
  const addon = { asyncWorkPending: 1, runtimeWorkPending: 1 }
  const binding = createInflightWasiDisposal(code, addon)
  const first = binding.dispose()
  await waitUntil(() => binding.reads.asyncWork >= 3, 'the drain to poll')
  addon.asyncWorkPending = 0
  await waitUntil(() => binding.reads.runtimeWork >= 3, 'the barrier to poll')
  addon.runtimeWorkPending = 0
  t.deepEqual(await settleWithin(first), { value: undefined })
  t.deepEqual(binding.steps, [
    'cancel',
    'interval set',
    'interval cleared',
    'begin',
    'finish',
    'drain',
    'destroy',
    'terminate',
    'complete',
  ])
  t.is(binding.liveIntervals(), 0)
})

// The crash check fires only while a public disposal or the initialization
// rollback is in flight. A poll started by neither keeps polling.
test('node WASI crash abort leaves a poll outside disposal and rollback alone', async (t) => {
  const code = createWasiBinding('test', '@scope/test')
  const addon = { asyncWorkPending: 1, runtimeWorkPending: 0 }
  const binding = createInflightWasiDisposal(code, addon)
  const drain = binding.drainAsyncWork()
  t.truthy(drain)
  binding.crash()
  const readsAtCrash = binding.reads.asyncWork
  await waitUntil(
    () => binding.reads.asyncWork >= readsAtCrash + 5,
    'the drain to keep polling',
  )
  addon.asyncWorkPending = 0
  t.deepEqual(await settleWithin(drain!), { value: undefined })
  t.false(binding.steps.includes('terminate'))
  t.false(binding.steps.includes('port unref'))
})

// The initialization rollback runs the same drain as dispose(). A worker that
// died while it polled left the count above zero, and the rollback polled it
// forever with its timers holding the process open. It now stops, skips the
// barrier and the destroy, and lets the initialization error through with the
// crash attached.
test('node WASI initialization rollback stops its async-work drain when a worker crashes', async (t) => {
  const code = createWasiBinding('test', '@scope/test')
  const binding = createInflightWasiDisposal(code, {
    asyncWorkPending: 1,
    runtimeWorkPending: 0,
  })
  const initError = new Error('instantiate failed')
  const record = binding.failInitialization(initError)
  const rollback = record.promise
  t.truthy(rollback, 'the rollback waits for the drain')
  await waitUntil(() => binding.reads.asyncWork >= 5, 'the rollback to poll')
  t.is(binding.liveIntervals(), 1)
  binding.crash()
  t.falsy(((await settleWithin(rollback!)) as any).pending)

  // The error the loader threw is the initialization error, and the crash is
  // its cause.
  t.is(record.error, initError)
  t.true(record.error.cause instanceof Error)
  t.is(record.error.cause.message, CRASH_DISPOSAL_MESSAGE)
  t.false(record.active)
  t.true(binding.registered(), 'kept: the context was not destroyed')

  t.is(binding.liveIntervals(), 0, 'the keep-alive interval is cleared')
  const readsAfter = binding.reads.asyncWork
  await new Promise((resolve) => setTimeout(resolve, 20))
  t.is(binding.reads.asyncWork, readsAfter, 'the drain stopped polling')
  // No barrier, no settlement drain, no destroy: the port is released and the
  // workers are terminated once.
  t.deepEqual(binding.steps, [
    'cancel',
    'interval set',
    'interval cleared',
    'retain',
    'port unref',
    'terminate',
  ])

  // The worker's 'error' event arrives after the rollback ended: the crash
  // error it already attached gets the worker's error as its cause.
  t.is(record.error.cause.cause, undefined)
  const workerError = new Error('trap in worker')
  binding.workerError(workerError, 7)
  t.is(record.error.cause.cause, workerError)
  t.is(record.error.cause.workerThreadId, 7)
})

// Same race one step later: the barrier began and its poll waits for runtime
// work the dead thread still counts. `…_finish` would join that work, so the
// barrier stays parked and is never finished.
test('node WASI initialization rollback stops the barrier poll when a worker crashes', async (t) => {
  const code = createWasiBinding('test', '@scope/test')
  const binding = createInflightWasiDisposal(code, {
    asyncWorkPending: 0,
    runtimeWorkPending: 1,
  })
  const initError = new Error('instantiate failed')
  const record = binding.failInitialization(initError)
  const rollback = record.promise
  t.truthy(rollback)
  await waitUntil(() => binding.reads.runtimeWork >= 5, 'the barrier to poll')
  t.true(binding.parked())
  binding.crash()
  t.falsy(((await settleWithin(rollback!)) as any).pending)
  t.is(record.error, initError)
  t.is(record.error.cause?.message, CRASH_DISPOSAL_MESSAGE)
  t.false(binding.parked())
  const readsAfter = binding.reads.runtimeWork
  await new Promise((resolve) => setTimeout(resolve, 20))
  t.is(binding.reads.runtimeWork, readsAfter)
  t.deepEqual(binding.steps, ['begin', 'retain', 'port unref', 'terminate'])
})

// A thread that died before instantiation failed: the rollback does not enter
// wasm at all, and it stays synchronous, so the error the loader throws right
// away already carries the crash.
test('node WASI initialization rollback after an earlier crash skips wasm', (t) => {
  const code = createWasiBinding('test', '@scope/test')
  const binding = createInflightWasiDisposal(code, {
    asyncWorkPending: 1,
    runtimeWorkPending: 1,
  })
  binding.crash()
  const initError = new Error('instantiate failed')
  const record = binding.failInitialization(initError)
  t.is(record.promise, undefined, 'settled synchronously')
  t.is(record.error, initError)
  t.is(record.error.cause?.message, CRASH_DISPOSAL_MESSAGE)
  t.is(binding.reads.asyncWork, 0)
  t.is(binding.reads.runtimeWork, 0)
  t.deepEqual(binding.steps, ['port unref', 'terminate'])

  // An initialization error that already has a cause keeps it; the crash is
  // listed with the cleanup errors instead. The crash error is shared, and the
  // workers are not terminated a second time.
  const withCause = new Error('instantiate failed', {
    cause: new Error('link error'),
  })
  const second = binding.failInitialization(withCause)
  t.is(second.error, withCause)
  t.is(second.error.cause.message, 'link error')
  t.is(second.error.cleanupErrors[0], record.error.cause)
  t.deepEqual(binding.steps, ['port unref', 'terminate'])
})

// Without a crash the rollback runs every step exactly as before, resolves
// with no cleanup errors and leaves the initialization error untouched.
test('node WASI initialization rollback without a crash is unchanged', async (t) => {
  const code = createWasiBinding('test', '@scope/test')
  const addon = { asyncWorkPending: 1, runtimeWorkPending: 1 }
  const binding = createInflightWasiDisposal(code, addon)
  const initError = new Error('instantiate failed')
  const record = binding.failInitialization(initError)
  const rollback = record.promise
  t.truthy(rollback)
  await waitUntil(() => binding.reads.asyncWork >= 3, 'the drain to poll')
  addon.asyncWorkPending = 0
  await waitUntil(() => binding.reads.runtimeWork >= 3, 'the barrier to poll')
  addon.runtimeWorkPending = 0
  t.deepEqual(await settleWithin(rollback!), { value: undefined })
  t.is(record.error, initError)
  t.is(record.error.cause, undefined)
  t.is(record.error.cleanupErrors, undefined)
  t.false(binding.registered(), 'a clean rollback is not kept')
  t.deepEqual(binding.steps, [
    'cancel',
    'interval set',
    'interval cleared',
    'begin',
    'finish',
    'drain',
    'destroy',
    'terminate',
  ])
  t.is(binding.liveIntervals(), 0)
})

// The shared flag is raised before this thread has processed the worker's
// 'error' event, and once the workers are terminated emnapi ignores that event,
// so `_fatalError` was often still unset when the crash error was built and
// the cause was lost. The loader's own listener keeps the first error, and the
// crash error picks it up whenever it arrives.
test('node WASI crash error takes its cause from the worker error listener', async (t) => {
  const code = createWasiBinding('test', '@scope/test')

  // The event lands while the crash disposal is terminating the workers.
  {
    const binding = createInflightWasiDisposal(code, {
      asyncWorkPending: 1,
      runtimeWorkPending: 0,
    })
    const first = binding.dispose()
    await waitUntil(() => binding.reads.asyncWork >= 3, 'the drain to poll')
    binding.crash()
    const workerError = new Error('trap in worker')
    binding.workerError(workerError, 3)
    // Only the first error is kept.
    binding.workerError(new Error('second worker'), 4)
    const outcome: any = await settleWithin(first)
    t.is(outcome.error?.message, CRASH_DISPOSAL_MESSAGE)
    t.is(outcome.error.cause, workerError)
    t.is(outcome.error.workerThreadId, 3)
  }

  // The event lands after the disposal already rejected: the one shared crash
  // error is completed in place, so every holder of it sees the cause.
  {
    const binding = createInflightWasiDisposal(code, {
      asyncWorkPending: 1,
      runtimeWorkPending: 0,
    })
    const first = binding.dispose()
    await waitUntil(() => binding.reads.asyncWork >= 3, 'the drain to poll')
    binding.crash()
    const outcome: any = await settleWithin(first)
    t.is(outcome.error?.message, CRASH_DISPOSAL_MESSAGE)
    t.is(outcome.error.cause, undefined)
    const workerError = new Error('trap in worker')
    binding.workerError(workerError, 9)
    t.is(outcome.error.cause, workerError)
    t.is(outcome.error.workerThreadId, 9)
    const later: any = await settleWithin(binding.dispose())
    t.is(later.error, outcome.error)
  }
})

test('WASI loaders without the crash latch keep their disposal polls unchanged', (t) => {
  const loaders = {
    'threadless node': createWasiBinding(
      'test',
      '@scope/test',
      4000,
      65536,
      false,
    ),
    'threaded browser': createWasiBrowserBinding('test-wasi'),
    'threadless browser': createWasiBrowserBinding(
      'test-wasi',
      4000,
      65536,
      false,
      false,
      false,
      false,
      false,
    ),
  }
  for (const [label, code] of Object.entries(loaders)) {
    t.false(code.includes('__abortWasiDisposalIfThreadCrashed'), label)
    t.false(code.includes('__settleWasiDisposalAfterThreadCrash'), label)
    t.false(code.includes('finishCleanupUnlessCrashed'), label)
    t.false(code.includes('__wasiInitializationRollbackActive'), label)
    t.false(code.includes('__runWasiInitializationRollbackSteps'), label)
    t.false(
      code.includes('__rollbackWasiInitializationAfterThreadCrash'),
      label,
    )
    t.false(code.includes('__getWasiThreadCrashError'), label)
    t.false(code.includes('__recordWasiThreadCrashError'), label)
    t.false(code.includes('__readWasiThreadCrashReport'), label)
    t.true(code.includes('function __rollbackWasiInitialization() {\n'), label)
    t.true(
      generatedFunction(code, '__prepareWasmEnvCleanupWithTurns').includes(
        '  })().then(finishCleanup, finishCleanup)\n',
      ),
      label,
    )
  }
  // The threaded node loader checks the latch in every disposal poll and step,
  // and in the rollback's steps.
  const threaded = createWasiBinding('test', '@scope/test')
  for (const name of [
    '__drainWasiAsyncWork',
    '__prepareWasmEnvCleanupWithTurns',
    '__cleanUpWasmEnvForWasiDisposal',
    '__drainWasmEnvForWasiDisposal',
    '__continueWasiDisposal',
    '__destroyContextForWasiRollback',
  ]) {
    t.true(
      generatedFunction(threaded, name).includes(
        '__abortWasiDisposalIfThreadCrashed()',
      ),
      name,
    )
  }
  const steps = generatedFunction(
    threaded,
    '__runWasiInitializationRollbackSteps',
  )
  t.is(
    steps.split('    __abortWasiDisposalIfThreadCrashed()\n').length - 1,
    2,
    'before the barrier and before the settlement drain',
  )
})

test('node WASI loader shares the crash flag with its pool workers', (t) => {
  const code = createWasiBinding('test', '@scope/test')
  const createWorker = generatedFunction(code, '__createWasiWorker')
  t.true(createWorker.includes('crashFlag: __wasiThreadCrashFlag,'))
  t.true(createWorker.includes('crashReport: __wasiThreadCrashReport,'))
  const onCreateWorker = code.slice(
    code.indexOf('onCreateWorker() {'),
    code.indexOf('return worker\n', code.indexOf('onCreateWorker() {')),
  )
  t.true(
    onCreateWorker.includes("worker.on('error', (error) => {"),
    'the loader has to see a worker error even when the worker never set the flag',
  )
  t.true(onCreateWorker.includes('__wasiThreadCrashed = true'))
  t.true(
    onCreateWorker.includes(
      '__recordWasiThreadCrashError(error, worker.threadId)',
    ),
    'and keeps the error it carries for the crash error',
  )
})

// The threadless flavor has no pool workers and must not reference the latch:
// a name the exit listener cannot resolve would throw on every process exit.
test('threadless node WASI loader keeps its exit teardown unconditional', (t) => {
  const code = createWasiBinding('test', '@scope/test', 4000, 65536, false)
  t.false(code.includes('__hasWasiThreadCrashed'))
  t.false(code.includes('__wasiThreadCrash'))
  t.false(code.includes('SharedArrayBuffer'))
  t.true(generatedFunction(code, '__disposeWasiBindingAtExit').length > 0)
  t.false(code.includes('__disposeWasiBindingAfterThreadCrash'))
  t.false(code.includes('__releaseEmnapiWaitingRequestHandle'))
  t.true(
    generatedFunction(code, '__disposeWasiBinding').startsWith(
      'function __disposeWasiBinding() {\n  if (__wasiDisposePromise) {\n',
    ),
  )
})

// The browser loader has no 'exit' teardown and no crash latch; its public
// disposer is unchanged.
test('browser WASI loader public disposer has no crash latch', (t) => {
  for (const threads of [true, false]) {
    const code = createWasiBrowserBinding(
      'test-wasi',
      4000,
      65536,
      false,
      false,
      false,
      false,
      threads,
    )
    t.false(code.includes('__hasWasiThreadCrashed'), `threads=${threads}`)
    t.false(
      code.includes('__disposeWasiBindingAfterThreadCrash'),
      `threads=${threads}`,
    )
  }
})

/**
 * The column-zero `if` of the Node worker that wraps emnapi's
 * `beforeReportError`, with the helpers it calls: a function body over
 * `workerData`, `handler` and `threadId`.
 */
function wasiWorkerCrashHook(): string {
  const start =
    WASI_WORKER_TEMPLATE.indexOf(
      '\nif (workerData && workerData.crashFlag instanceof Int32Array) {\n',
    ) + 1
  return (
    WASI_WORKER_TEMPLATE.slice(
      start,
      WASI_WORKER_TEMPLATE.indexOf('\n}\n', start) + 2,
    ) +
    generatedFunction(WASI_WORKER_TEMPLATE, '__raiseWasiThreadCrashFlags') +
    generatedFunction(WASI_WORKER_TEMPLATE, '__writeCrashReport')
  )
}

test('WASI worker sets the crash flag before emnapi reports the error', (t) => {
  assertValidJS(t, WASI_WORKER_TEMPLATE, 'Node WASI worker')
  const start = WASI_WORKER_TEMPLATE.indexOf(
    '\nif (workerData && workerData.crashFlag instanceof Int32Array) {',
  )
  t.true(start > 0)
  t.true(
    start < WASI_WORKER_TEMPLATE.indexOf('globalThis.onmessage = function'),
    'the hook has to be in place before the first message is handled',
  )
  const latch = wasiWorkerCrashHook()

  const run = (workerData: { crashFlag?: Int32Array } & object) => {
    const reports: string[] = []
    const handler = {
      // emnapi's own hook, which lets the main thread start exiting.
      beforeReportError(this: unknown, error: Error, type: string) {
        const flag = workerData.crashFlag
          ? Atomics.load(workerData.crashFlag, 0)
          : 'none'
        reports.push(
          `${error.message} ${type} flag=${flag} ${this === handler}`,
        )
      },
    }
    const original = handler.beforeReportError
    new Function('workerData', 'handler', 'threadId', latch)(
      workerData,
      handler,
      1,
    )
    return { handler, original, reports }
  }

  const crashFlag = new Int32Array(new SharedArrayBuffer(4))
  const crashed = run({ crashFlag })
  t.not(crashed.handler.beforeReportError, crashed.original)
  crashed.handler.beforeReportError(new Error('trap'), 'start')
  // Set before emnapi's hook runs, and emnapi's hook still runs on the handler.
  t.deepEqual(crashed.reports, ['trap start flag=1 true'])
  t.is(Atomics.load(crashFlag, 0), 1)

  // A loader that predates the flag passes none: the hook stays emnapi's own.
  const legacy = run({ hostRoot: '/', rootDir: '/' } as object)
  t.is(legacy.handler.beforeReportError, legacy.original)
})

// The loader thread can be inside a wasm cleanup call that waits on the dead
// thread. The addon's flag makes those waits trap; the loader must already see
// its own flag when the trap reaches it.
test('WASI worker raises the addon crash flag after the loader flag', (t) => {
  const latch = wasiWorkerCrashHook()
  const crash = (
    instance: unknown,
    workerData: { crashFlag: Int32Array; addonCrashFlag?: unknown },
  ) => {
    const calls: string[] = []
    const handler = {
      instance,
      beforeReportError() {
        calls.push(`emnapi flag=${Atomics.load(workerData.crashFlag, 0)}`)
      },
    }
    new Function('workerData', 'handler', 'threadId', latch)(
      workerData,
      handler,
      1,
    )
    ;(handler.beforeReportError as (...args: unknown[]) => void)(
      new Error('trap'),
      'start',
    )
    return calls
  }

  // The loader's view of the addon's flag: one word of the shared wasm memory,
  // at an offset. A worker that failed while loading has no instance.
  const memory = new WebAssembly.Memory({
    initial: 1,
    maximum: 1,
    shared: true,
  })
  const word = new Int32Array(memory.buffer, 64, 1)
  const crashFlag = new Int32Array(new SharedArrayBuffer(4))
  const calls: string[] = []
  const workerData = {
    crashFlag,
    get addonCrashFlag() {
      calls.push(`view read, loader flag=${Atomics.load(crashFlag, 0)}`)
      return word
    },
  }
  calls.push(...crash(undefined, workerData))
  t.deepEqual(calls, ['view read, loader flag=1', 'emnapi flag=1'])
  t.is(Atomics.load(new Int32Array(memory.buffer), 16), 1)
  t.is(Atomics.load(new Int32Array(memory.buffer), 15), 0)
  t.is(Atomics.load(new Int32Array(memory.buffer), 17), 0)

  // With a view the export is not needed: it is not called.
  const exported: string[] = []
  const withInstance = crash(
    {
      exports: {
        napi_wasm_thread_crashed() {
          exported.push('napi')
        },
      },
    },
    {
      crashFlag: new Int32Array(new SharedArrayBuffer(4)),
      addonCrashFlag: new Int32Array(new SharedArrayBuffer(4)),
    },
  )
  t.deepEqual(withInstance, ['emnapi flag=1'])
  t.deepEqual(exported, [])

  // No view (an addon built with an older napi): the export, when the worker
  // has an instance, after the loader flag.
  const noViewFlag = new Int32Array(new SharedArrayBuffer(4))
  const noView: string[] = []
  noView.push(
    ...crash(
      {
        exports: {
          napi_wasm_thread_crashed() {
            noView.push(`napi flag=${Atomics.load(noViewFlag, 0)}`)
          },
        },
      },
      { crashFlag: noViewFlag },
    ),
  )
  t.deepEqual(noView, ['napi flag=1', 'emnapi flag=1'])

  // A worker that never loaded, an addon without the export, an export that
  // throws, a view that is not an Int32Array: emnapi's hook still runs.
  for (const [instance, addonCrashFlag] of [
    [undefined, undefined],
    [{ exports: {} }, undefined],
    [
      {
        exports: {
          napi_wasm_thread_crashed() {
            throw new Error('boom')
          },
        },
      },
      undefined,
    ],
    [undefined, new Uint8Array(new SharedArrayBuffer(4))],
  ]) {
    t.deepEqual(
      crash(instance, {
        crashFlag: new Int32Array(new SharedArrayBuffer(4)),
        addonCrashFlag,
      }),
      ['emnapi flag=1'],
    )
  }
})

/**
 * A shared wasm memory with a view of one word at `offset`, the way the loaders
 * build the addon's crash flag view.
 */
function addonCrashFlagView(offset = 64) {
  const memory = new WebAssembly.Memory({
    initial: 1,
    maximum: 1,
    shared: true,
  })
  return { memory, word: new Int32Array(memory.buffer, offset, 1) }
}

// A worker whose setup throws before the crash hook exists (here: the runtime
// package cannot be resolved) never gets to emnapi's beforeReportError. Its
// thread spawn has already returned, so the loader may be waiting on it inside
// wasm: it has to raise both flags itself, then fail as before.
test('WASI worker raises both crash flags when its setup throws', (t) => {
  const anchor = '\nlet handler\ntry {\n'
  const start = WASI_WORKER_TEMPLATE.indexOf(anchor) + 1
  t.true(start > 0)
  const catchStart = WASI_WORKER_TEMPLATE.indexOf('} catch (error) {\n', start)
  const setup =
    WASI_WORKER_TEMPLATE.slice(
      start,
      WASI_WORKER_TEMPLATE.indexOf('\n}\n', catchStart) + 2,
    ) +
    generatedFunction(WASI_WORKER_TEMPLATE, '__raiseWasiThreadCrashFlags') +
    generatedFunction(WASI_WORKER_TEMPLATE, '__writeCrashReport')
  t.true(
    setup.indexOf("require('@napi-rs/wasm-runtime')") <
      setup.indexOf('handler = new MessageHandler('),
  )
  const missing = new Error("Cannot find module '@napi-rs/wasm-runtime'")
  const run = (workerData: object | undefined) =>
    new Function('require', 'workerData', 'threadId', setup)(
      () => {
        throw missing
      },
      workerData,
      3,
    )

  const { memory, word } = addonCrashFlagView()
  const crashFlag = new Int32Array(new SharedArrayBuffer(4))
  const crashReport = new SharedArrayBuffer(4096)
  const order: number[] = []
  const workerData = {
    crashFlag,
    crashReport,
    get addonCrashFlag() {
      order.push(Atomics.load(crashFlag, 0))
      return word
    },
  }
  t.is(
    t.throws(() => run(workerData)),
    missing,
  )
  t.is(Atomics.load(crashFlag, 0), 1)
  t.deepEqual(order, [1], 'the loader flag goes up before the addon flag')
  t.is(Atomics.load(new Int32Array(memory.buffer), 16), 1)
  const header = new Int32Array(crashReport, 0, 3)
  t.is(Atomics.load(header, 0), 2)
  t.is(Atomics.load(header, 2), 3)

  // A loader that predates the flags: the error is only rethrown.
  t.is(
    t.throws(() => run({ hostRoot: '/', rootDir: '/' })),
    missing,
  )
  t.is(
    t.throws(() => run(undefined)),
    missing,
  )
})

// The same through a real worker thread: the generated worker, written where
// '@napi-rs/wasm-runtime' cannot be resolved, gets the view in workerData — a
// structured clone that keeps sharing the wasm memory — and raises the word.
test('WASI worker that fails to load raises the flags from a real thread', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'napi-rs-wasi-worker-'))
  t.teardown(() => rm(directory, { recursive: true, force: true }))
  const workerPath = join(directory, 'wasi-worker.mjs')
  await writeFile(workerPath, WASI_WORKER_TEMPLATE)
  const { memory, word } = addonCrashFlagView(128)
  const crashFlag = new Int32Array(new SharedArrayBuffer(4))
  const crashReport = new SharedArrayBuffer(4096)
  const worker = new Worker(workerPath, {
    workerData: { crashFlag, crashReport, addonCrashFlag: word },
  })
  const error = await new Promise<Error>((resolve, reject) => {
    worker.once('error', resolve)
    worker.once('exit', (code) =>
      reject(new Error(`the worker exited with ${code} and no error`)),
    )
  })
  t.regex(error.message, /@napi-rs\/wasm-runtime/)
  t.is(Atomics.load(crashFlag, 0), 1)
  t.is(Atomics.load(new Int32Array(memory.buffer), 32), 1)
  t.is(Atomics.load(new Int32Array(crashReport, 0, 1), 0), 2)
})

/**
 * The Node loader's view capture and worker creation, over a real shared wasm
 * memory and a stub `Worker` that keeps its options.
 */
function createNodeLoaderAddonCrashFlag() {
  const code = createWasiBinding('test', '@scope/test')
  const created: Array<{ filename: string; options: any }> = []
  class StubWorker {
    constructor(filename: string, options: unknown) {
      created.push({ filename, options })
    }
  }
  const loader = new Function(
    'Worker',
    `
const __sharedMemory = new WebAssembly.Memory({ initial: 1, maximum: 2, shared: true })
const __hostRoot = '/'
const __rootDir = '/'
const __wasiThreadCrashFlag = new Int32Array(new SharedArrayBuffer(4))
const __wasiThreadCrashReport = new SharedArrayBuffer(16)
let __wasiAddonCrashFlag
${generatedFunction(code, '__captureWasiAddonCrashFlag')}
${generatedFunction(code, '__getWasiWorkerExecArgv')}
${generatedFunction(code, '__createWasiWorker')}
return {
  memory: __sharedMemory,
  capture: __captureWasiAddonCrashFlag,
  createWorker: __createWasiWorker,
  view: () => __wasiAddonCrashFlag,
}
`,
  )(StubWorker) as {
    memory: WebAssembly.Memory
    capture: (instance: unknown) => void
    createWorker: (filename: string) => unknown
    view: () => Int32Array | undefined
  }
  return { code, created, ...loader }
}

test('node WASI loader reads the addon crash flag address before registration', (t) => {
  const { code } = createNodeLoaderAddonCrashFlag()
  const beforeInit = code.slice(code.indexOf('    beforeInit({ instance }) {'))
  const capture = beforeInit.indexOf('__captureWasiAddonCrashFlag(instance)')
  t.true(capture > 0)
  t.true(capture < beforeInit.indexOf("name.startsWith('__napi_register__')"))
  t.true(
    generatedFunction(code, '__createWasiWorker').includes(
      'addonCrashFlag: __wasiAddonCrashFlag,',
    ),
  )
  // The threadless loader has no workers and reads nothing.
  const threadless = createWasiBinding(
    'test',
    '@scope/test',
    4000,
    65536,
    false,
  )
  t.false(threadless.includes('__captureWasiAddonCrashFlag'))
  t.false(threadless.includes('napi_wasm_thread_crash_flag_address'))
})

test('node WASI loader passes each pool worker a view of the addon crash flag', (t) => {
  const loader = createNodeLoaderAddonCrashFlag()
  // Before the capture (or for an addon built with an older napi): no view.
  loader.createWorker('/w.mjs')
  t.is(loader.created[0].options.workerData.addonCrashFlag, undefined)

  loader.capture({
    exports: { napi_wasm_thread_crash_flag_address: () => 1024 },
  })
  const view = loader.view()
  t.true(view instanceof Int32Array)
  t.is(view!.buffer, loader.memory.buffer)
  t.is(view!.byteOffset, 1024)
  t.is(view!.length, 1)
  loader.createWorker('/w.mjs')
  t.is(loader.created[1].options.workerData.addonCrashFlag, view)
  t.is(
    loader.created[1].options.workerData.crashFlag instanceof Int32Array,
    true,
  )
  // The worker's store lands in the word the addon reads.
  Atomics.store(view!, 0, 1)
  t.is(Atomics.load(new Int32Array(loader.memory.buffer), 256), 1)

  // Addresses the loader cannot trust are ignored.
  for (const exports of [
    {},
    { napi_wasm_thread_crash_flag_address: 1024 },
    { napi_wasm_thread_crash_flag_address: () => 0 },
    { napi_wasm_thread_crash_flag_address: () => 1026 },
    { napi_wasm_thread_crash_flag_address: () => 65536 },
    { napi_wasm_thread_crash_flag_address: () => -4 },
    {
      napi_wasm_thread_crash_flag_address() {
        throw new Error('boom')
      },
    },
  ]) {
    const fresh = createNodeLoaderAddonCrashFlag()
    t.notThrows(() => fresh.capture({ exports }))
    t.is(fresh.view(), undefined)
  }
})

// The browser pool is created before the wasm is instantiated, so its workers
// get the view by message once the instance exists; a worker created later
// gets it right away. A browser Worker has no workerData.
test('browser WASI loader posts the addon crash flag view to every pool worker', (t) => {
  const code = createWasiBrowserBinding(
    'test-wasi',
    4000,
    65536,
    false,
    false,
    false,
    false,
    true,
  )
  assertValidJS(t, code, 'browser threads')
  const beforeInitStart = code.indexOf(
    '    beforeInit({ instance }) {\n      __napiInstance = instance\n',
  )
  t.true(beforeInitStart > 0)
  const beforeInitBody = code.slice(
    code.indexOf('      __napiInstance = instance\n', beforeInitStart),
    code.indexOf(
      '      for (const name of Object.keys(instance.exports)) {',
      beforeInitStart,
    ),
  )
  t.true(beforeInitBody.includes('__captureWasiAddonCrashFlag(instance)'))
  t.true(
    code.includes(
      '      __wasiWorkers.add(worker)\n      __shareWasiAddonCrashFlag(worker)\n',
    ),
  )

  const posted: Array<[string, unknown]> = []
  const run = new Function(
    'posted',
    `
const __sharedMemory = new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true })
const __wasiWorkers = new Set()
let __napiInstance
${generatedFunction(code, '__captureWasiAddonCrashFlag')}
${generatedFunction(code, '__shareWasiAddonCrashFlag')}
let __wasiAddonCrashFlag
function onCreateWorker(name) {
  const worker = {
    postMessage(message) {
      posted.push([name, message])
    },
  }
  __wasiWorkers.add(worker)
  __shareWasiAddonCrashFlag(worker)
  return worker
}
function beforeInit({ instance }) {
${beforeInitBody}
}
onCreateWorker('pool-1')
onCreateWorker('pool-2')
beforeInit({ instance: { exports: { napi_wasm_thread_crash_flag_address: () => 512 } } })
onCreateWorker('later')
return { memory: __sharedMemory, view: __wasiAddonCrashFlag }
`,
  )
  const { memory, view } = run(posted)
  t.true(view instanceof Int32Array)
  t.is(view.buffer, memory.buffer)
  t.is(view.byteOffset, 512)
  t.deepEqual(
    posted.map(([name]) => name),
    ['pool-1', 'pool-2', 'later'],
  )
  for (const [, message] of posted) {
    t.deepEqual(Object.keys(message as object), ['__napiRsAddonCrashFlag'])
    t.is(
      (message as { __napiRsAddonCrashFlag: unknown }).__napiRsAddonCrashFlag,
      view,
    )
  }

  // The threadless browser loader has no workers.
  const threadless = createWasiBrowserBinding(
    'test-wasi',
    4000,
    65536,
    false,
    false,
    false,
    false,
    false,
  )
  t.false(threadless.includes('__captureWasiAddonCrashFlag'))
  t.false(threadless.includes('__shareWasiAddonCrashFlag'))
})

test('browser WASI worker raises the addon crash flag it was posted', (t) => {
  for (const [fs, errorEvent] of [
    [false, false],
    [true, true],
  ]) {
    const code = createWasiBrowserWorkerBinding(fs, errorEvent)
    const start = code.indexOf('let __addonCrashFlag\n')
    t.true(start > 0)
    const bridge = code.slice(start)
    const calls: string[] = []
    const { memory, word } = addonCrashFlagView(256)
    const handler: {
      instance?: unknown
      beforeReportError: (...args: unknown[]) => unknown
      handle: (event: { data: unknown }) => void
    } = {
      instance: undefined,
      beforeReportError(this: unknown, error: unknown) {
        calls.push(
          `emnapi ${(error as Error).message} word=${Atomics.load(word, 0)} ${this === handler}`,
        )
      },
      handle(event) {
        calls.push(`handle ${JSON.stringify(event.data)}`)
      },
    }
    const globals: { onmessage?: (event: { data: unknown }) => void } = {}
    new Function('handler', 'globalThis', bridge)(handler, globals)

    // No view yet: emnapi's hook still runs, nothing is raised.
    handler.beforeReportError(new Error('early'), 'load')
    // The view is kept, not handed to emnapi; emnapi's messages still are.
    globals.onmessage!({ data: { __napiRsAddonCrashFlag: word } })
    globals.onmessage!({ data: { __emnapi__: { type: 'load' } } })
    // A wasm thread that died, with or without an instance.
    handler.beforeReportError(new Error('trap'), 'start')
    t.deepEqual(calls, [
      'emnapi early word=0 true',
      'handle {"__emnapi__":{"type":"load"}}',
      'emnapi trap word=1 true',
    ])
    t.is(Atomics.load(new Int32Array(memory.buffer), 64), 1)
  }
})

/**
 * Wires the worker's crash hook to the loader's crash error over one shared
 * report, the way `__createWasiWorker` passes it, and returns both ends.
 */
function createWasiCrashReportPair() {
  const code = createWasiBinding('test', '@scope/test')
  const latchStart = code.indexOf('const __wasiThreadCrashFlag = ')
  const latchState = code.slice(
    latchStart,
    code.indexOf('let __wasiThreadCrashed = false\n', latchStart) +
      'let __wasiThreadCrashed = false\n'.length,
  )
  const loader = new Function(`
${latchState}
function __getWasiThreadManager() {
  return {}
}
${generatedFunction(code, '__readWasiThreadCrashReport')}
${generatedFunction(code, '__recordWasiThreadCrashError')}
${generatedFunction(code, '__getWasiThreadCrashError')}
${generatedFunction(code, '__fillWasiThreadCrashError')}
return {
  workerData: {
    crashFlag: __wasiThreadCrashFlag,
    crashReport: __wasiThreadCrashReport,
  },
  crashError: __getWasiThreadCrashError,
  workerError: __recordWasiThreadCrashError,
}
`)() as {
    workerData: { crashFlag: Int32Array; crashReport: SharedArrayBuffer }
    crashError: () => any
    workerError: (error: unknown, threadId: number) => void
  }
  const hook = wasiWorkerCrashHook()
  const reportStates: number[] = []
  const crashWorker = (error: unknown, threadId: number) => {
    const handler = {
      beforeReportError() {
        reportStates.push(
          Atomics.load(new Int32Array(loader.workerData.crashReport, 0, 1), 0),
        )
      },
    }
    new Function('workerData', 'handler', 'threadId', hook)(
      loader.workerData,
      handler,
      threadId,
    )
    ;(handler.beforeReportError as (...args: unknown[]) => void)(error, 'start')
  }
  return { ...loader, crashWorker, reportStates }
}

// The 'error' event is dropped when the loader terminates the worker first, so
// the crash error lost its cause in most crash runs. The worker now writes its
// error into shared memory before it raises the flag, and the loader rebuilds
// it from there without waiting for any event.
test('WASI worker hands its error to the loader through the shared crash report', (t) => {
  const pair = createWasiCrashReportPair()
  const trap = new WebAssembly.RuntimeError('forced trap')
  pair.crashWorker(trap, 5)
  // Complete before emnapi's hook runs, and so before the flag is seen.
  t.deepEqual(pair.reportStates, [2])
  t.is(Atomics.load(pair.workerData.crashFlag, 0), 1)
  // A second crash does not overwrite the first report.
  pair.crashWorker(new Error('second worker'), 6)
  const crashError = pair.crashError()
  t.is(crashError.message, CRASH_DISPOSAL_MESSAGE)
  t.true(crashError.cause instanceof Error)
  t.is(crashError.cause.name, 'RuntimeError')
  t.is(crashError.cause.message, 'forced trap')
  t.is(crashError.cause.stack, trap.stack)
  t.is(crashError.workerThreadId, 5)
  // One shared error: a later event does not replace the cause.
  pair.workerError(new Error('late event'), 7)
  t.is(pair.crashError(), crashError)
  t.is(crashError.cause.message, 'forced trap')

  // The listener's error, when it came first, is the original object.
  const withEvent = createWasiCrashReportPair()
  withEvent.crashWorker(trap, 5)
  const eventError = new Error('from the error event')
  withEvent.workerError(eventError, 5)
  t.is(withEvent.crashError().cause, eventError)

  // A value that is not an error, and a message too large for the report.
  const thrownString = createWasiCrashReportPair()
  thrownString.crashWorker('boom', 3)
  t.is(thrownString.crashError().cause.message, 'boom')
  const huge = createWasiCrashReportPair()
  huge.crashWorker(new Error('x'.repeat(10_000)), 4)
  const hugeCause = huge.crashError().cause
  t.true(hugeCause.message.length > 0)
  t.true(hugeCause.message.length < 10_000)
  t.is(huge.crashError().workerThreadId, 4)
})
