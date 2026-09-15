import ava, { type ExecutionContext } from 'ava'
import { parseSync } from 'oxc-parser'

import { createCjsBinding, createEsmBinding } from '../templates/js-binding.js'
import {
  createWasiBinding,
  createWasiBrowserBinding,
  createWasiDeferredBrowserBinding,
} from '../templates/load-wasi-template.js'
import {
  createWasiBrowserWorkerBinding,
  WASI_WORKER_TEMPLATE,
} from '../templates/wasi-worker-template.js'

const test = ava

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

test('Node WASI loader uses an accessible host root on Android', (t) => {
  const code = createWasiBinding('test', '@scope/test')
  assertValidJS(t, code, 'Node WASI loader')
  t.true(code.includes('const __cwd = process.cwd()'))
  t.true(code.includes("process.platform === 'android' ? __cwd : __rootDir"))
  t.true(code.includes('[__rootDir]: __hostRoot'))
  t.true(code.includes('[__hostRoot]: __hostRoot'))
  t.true(
    code.includes('workerData: { hostRoot: __hostRoot, rootDir: __rootDir }'),
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
const DEFERRED_ROLLBACK_SIGNATURE = "__lifecycleState = 'failed'"
const DRAIN_CALL_BY_ROLLBACK_FLAVOR = {
  eager: '__drainWasmEnvCleanup',
  deferred: '__prepareForDisposal',
} as const

/**
 * The body of a loader's initialization-failure path: `__rollbackWasiInitialization`
 * for the eager loaders, `__createInstance`'s catch for the deferred one.
 * Sliced rather than searched whole-file, so a drain that only runs on the
 * ordinary disposal path cannot satisfy the assertion.
 */
function initializationRollbackBody(code: string): string {
  const eagerStart = code.indexOf(EAGER_ROLLBACK_SIGNATURE)
  if (eagerStart !== -1) {
    return code.slice(eagerStart, code.indexOf('\n}', eagerStart))
  }
  const deferredStart = code.indexOf(DEFERRED_ROLLBACK_SIGNATURE)
  return code.slice(deferredStart, code.indexOf('throw error', deferredStart))
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
    snippets: [
      'let __emnapiWasmEnvCleanupPreparing = false',
      `function __isPreparingWasmEnvCleanup() {
  return __emnapiWasmEnvCleanupPreparing
}`,
      `  if (__emnapiWasmEnvCleanupPrepared || __emnapiWasmEnvCleanupPreparing) {
    return
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
    snippets: [
      'let __wasmEnvCleanupPreparing = false',
      'const __isPreparingEnvCleanup = () => __wasmEnvCleanupPreparing',
      `    if (__wasmEnvCleanupPrepared || __wasmEnvCleanupPreparing) {
      return
    }`,
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
    code.includes(`      exports: __napiModule.exports,
      dispose: __disposeInstance,`),
    'the instance must expose the coalescing wrapper as its dispose()',
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

test('native loaders export the artifact that actually loaded', (t) => {
  const flavors = ['wasm32-wasi', 'wasm32-wasip1']
  const cjs = createCjsBinding('test', '@scope/test', ['sum'], '1.0.0', flavors)
  assertValidJS(t, cjs, 'cjs binding target')
  t.true(cjs.includes("let __napiLoadedBindingTarget = 'native'"))
  t.true(
    cjs.includes(
      '__napiStampBindingTarget(module.exports, __napiLoadedBindingTarget)',
    ),
  )
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
  'module.exports.__napiBindingTarget = __napiStampBindingTarget(module.exports, __napiLoadedBindingTarget)'
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

test('the node WASI loader stamps after the async runtime hosts are installed', (t) => {
  // `__installCurrentThreadHosts` hands the addon's own exports object to
  // addon-provided registration functions, which can put anything on it —
  // including this marker. Stamping before that leaves the guard's view stale,
  // and a second guarded stamp after it would have to live outside the `try`.
  const code = createWasiBinding(
    'test',
    '@scope/test',
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    true,
  )
  assertValidJS(t, code, 'wasi node cjs asyncRuntime stamp order')
  const hostInstall = code.indexOf('__installCurrentThreadHosts(')
  t.true(hostInstall > -1, 'the asyncRuntime host install must be emitted')
  const stamp = code.indexOf(WASI_CJS_STAMP_LINE)
  t.true(stamp > hostInstall)
  t.true(stamp < code.indexOf(WASI_EXIT_LISTENER_CALL))
  t.true(stamp < code.indexOf('\n} catch (error) {'))
})

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
