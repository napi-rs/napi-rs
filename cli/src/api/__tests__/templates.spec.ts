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
const wasiLoaderCases: Array<{ name: string; code: string }> = [
  { name: 'node cjs', code: createWasiBinding('test', '@scope/test') },
  {
    name: 'node cjs threadless',
    code: createWasiBinding('test', '@scope/test', 4000, 65536, false),
  },
  { name: 'browser esm', code: createWasiBrowserBinding('test') },
  { name: 'deferred/workerd', code: createWasiDeferredBrowserBinding('test') },
]

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
