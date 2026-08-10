import ava, { type ExecutionContext } from 'ava'
import { parseSync } from 'oxc-parser'

import { createCjsBinding, createEsmBinding } from '../templates/js-binding.js'
import {
  createWasiBinding,
  createWasiBrowserBinding,
  createWasiDeferredBrowserBinding,
} from '../templates/load-wasi-template.js'
import { createWasiBrowserWorkerBinding } from '../templates/wasi-worker-template.js'

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
