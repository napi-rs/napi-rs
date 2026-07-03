import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

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

test('single-thread WASI bindings do not require workers or shared memory', (t) => {
  const browser = createWasiBrowserBinding(
    'test-wasi',
    4000,
    65536,
    false,
    false,
    false,
    false,
    false,
  )
  const node = createWasiBinding(
    'test-wasi.wasm32-wasip1',
    '@scope/test',
    4000,
    65536,
    false,
    'wasm32-wasip1',
  )

  for (const code of [browser, node]) {
    t.false(code.includes('shared: true'))
    t.false(code.includes('onCreateWorker'))
    t.true(code.includes('asyncWorkPoolSize: 0'))
  }
  t.false(browser.includes('new Worker'))
  t.false(node.includes('new Worker'))
  t.false(node.includes("require('node:worker_threads')"))
  // the wasm fallback resolves from the SAME flavor's package
  t.true(
    node.includes(
      "require.resolve('@scope/test-wasm32-wasip1/test-wasi.wasm32-wasip1.wasm')",
    ),
  )
  t.false(node.includes('@scope/test-wasm32-wasi/'))
  assertValidJS(t, browser, 'single-thread browser binding')
  assertValidJS(t, node, 'single-thread Node binding')
})

test('threaded WASI node binding keeps the legacy wasm32-wasi package fallback', (t) => {
  const node = createWasiBinding('test-wasi.wasm32-wasi', '@scope/test')
  t.true(
    node.includes(
      "require.resolve('@scope/test-wasm32-wasi/test-wasi.wasm32-wasi.wasm')",
    ),
  )
  assertValidJS(t, node, 'threaded Node binding')
})

test('deferred single-thread WASI binding is workerd-safe', (t) => {
  const src = createWasiDeferredBrowserBinding('custom_async_runtime')
  // workerd bans: I/O in global scope, compile-from-bytes
  t.false(src.includes('await fetch'))
  t.false(src.includes('arrayBuffer'))
  // The wasm imports `env.memory` (built with `--import-memory`), so a
  // Memory allocation is required — but only in function scope
  // (workerd-legal), never in global scope.
  const exportOffset = src.indexOf('export async function instantiate')
  t.true(exportOffset > 0)
  const topLevel = src.slice(0, exportOffset)
  t.false(topLevel.includes('new WebAssembly.Memory'))
  t.false(topLevel.includes('fetch('))
  t.false(src.includes('shared: true'))
  t.false(src.includes('new Worker'))
  t.true(src.includes('export async function instantiate'))
  t.true(src.includes('asyncWorkPoolSize: 0'))
  // instantiate() accepts ONLY a precompiled WebAssembly.Module (or a Promise
  // resolving to one): anything else would require dynamic Wasm compilation,
  // which Cloudflare workerd bans everywhere. The guard must be a brand check
  // (`WebAssembly.Module.imports`), not `instanceof`: prototype-spoofed byte
  // buffers pass `instanceof`, and genuine cross-realm Modules fail it.
  t.true(src.includes('WebAssembly.Module.imports(__module)'))
  t.false(src.includes('instanceof WebAssembly.Module'))
  t.true(src.includes('throw new TypeError'))
  t.false(src.includes('any input emnapi accepts'))
  // The guard must run before emnapi is handed the input.
  const guardOffset = src.indexOf('WebAssembly.Module.imports(__module)')
  const emnapiCallOffset = src.indexOf('__emnapiInstantiateNapiModule(')
  t.true(emnapiCallOffset > 0)
  t.true(guardOffset > 0 && guardOffset < emnapiCallOffset)
  assertValidJS(t, src, 'deferred single-thread browser binding')
})

// Serial: temporarily stubs process-wide globals (WebAssembly.*, fetch).
test.serial(
  'deferred WASI binding rejects non-Module input at runtime',
  async (t) => {
    const src = createWasiDeferredBrowserBinding('custom_async_runtime')
    // Import the generated code for real: write it inside the repo so
    // `@napi-rs/wasm-runtime` resolves from the workspace node_modules.
    const tmpDir = await mkdtemp(
      join(fileURLToPath(new URL('.', import.meta.url)), '.tmp-deferred-'),
    )
    // Stub every dynamic-compilation path: if the guard fails to reject the
    // input BEFORE emnapi touches it, the rejection would surface as one of
    // these stub errors instead of the expected TypeError.
    const originalCompile = WebAssembly.compile
    const originalInstantiate = WebAssembly.instantiate
    const originalInstantiateStreaming = WebAssembly.instantiateStreaming
    const originalFetch = globalThis.fetch
    const banned = (name: string) => () => {
      throw new Error(`dynamic compilation attempted via ${name}`)
    }
    try {
      const loaderPath = join(tmpDir, 'deferred.mjs')
      await writeFile(loaderPath, src)
      const { instantiate } = await import(pathToFileURL(loaderPath).href)

      WebAssembly.compile = banned('WebAssembly.compile') as never
      WebAssembly.instantiate = banned('WebAssembly.instantiate') as never
      WebAssembly.instantiateStreaming = banned(
        'WebAssembly.instantiateStreaming',
      ) as never
      globalThis.fetch = banned('fetch') as never

      const bytesError = await t.throwsAsync(
        () => instantiate(new Uint8Array([0, 1])),
        { instanceOf: TypeError },
      )
      t.regex(bytesError.message, /precompiled WebAssembly\.Module/)
      t.regex(bytesError.message, /Cloudflare Workers/)

      // Promise inputs are awaited first, then held to the same contract.
      const promiseError = await t.throwsAsync(
        () => instantiate(Promise.resolve(new Uint8Array([0, 1]))),
        { instanceOf: TypeError },
      )
      t.regex(promiseError.message, /precompiled WebAssembly\.Module/)

      // Prototype-spoofed bytes pass `instanceof WebAssembly.Module` but
      // emnapi treats BufferSource inputs (a slot-based check) as bytes to
      // compile — the forbidden path. The brand check must reject them.
      const spoofedBytes = new Uint8Array([0, 1])
      Object.setPrototypeOf(spoofedBytes, WebAssembly.Module.prototype)
      const spoofedError = await t.throwsAsync(
        () => instantiate(spoofedBytes),
        { instanceOf: TypeError },
      )
      t.regex(spoofedError.message, /precompiled WebAssembly\.Module/)
    } finally {
      WebAssembly.compile = originalCompile
      WebAssembly.instantiate = originalInstantiate
      WebAssembly.instantiateStreaming = originalInstantiateStreaming
      globalThis.fetch = originalFetch
      await rm(tmpDir, { recursive: true, force: true })
    }
  },
)

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
    name: 'single-thread',
    args: ['test', 4000, 65536, false, false, false, false, false],
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
  {
    name: 'with both wasi flavors',
    code: createCjsBinding('test', '@scope/test', ['sum', 'sub'], undefined, [
      'wasm32-wasi',
      'wasm32-wasip1',
    ]),
  },
]

test('js binding wasi fallback defaults to the legacy wasm32-wasi chain', (t) => {
  const code = createCjsBinding('test', '@scope/test', ['sum'])
  t.true(code.includes("require('./test.wasi.cjs')"))
  t.true(code.includes("require('@scope/test-wasm32-wasi')"))
  t.false(code.includes('wasip1'))
})

test('js binding wasi fallback enumerates declared flavors threaded-first and stops at the first hit', (t) => {
  const code = createCjsBinding('test', '@scope/test', ['sum'], undefined, [
    'wasm32-wasi',
    'wasm32-wasip1',
  ])
  const order = [
    "require('./test.wasi.cjs')",
    "require('@scope/test-wasm32-wasi')",
    "require('./test.wasip1.cjs')",
    "require('@scope/test-wasm32-wasip1')",
  ]
  let lastIndex = -1
  for (const candidate of order) {
    const index = code.indexOf(candidate)
    t.true(index > lastIndex, `${candidate} out of order or missing`)
    lastIndex = index
  }
  // every candidate is guarded so a loaded threaded binding is never
  // silently overridden by the non-threaded flavor
  const guardCount = code.match(/if \(!wasiBinding\) \{/g)?.length ?? 0
  t.is(guardCount, order.length)
  assertValidJS(t, code, 'cjs binding with both wasi flavors')
})

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
