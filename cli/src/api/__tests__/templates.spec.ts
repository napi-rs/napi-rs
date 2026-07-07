import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { runInNewContext } from 'node:vm'

import ava, { type ExecutionContext } from 'ava'
import { parseSync } from 'oxc-parser'

import { createCjsBinding, createEsmBinding } from '../templates/js-binding.js'
import {
  createWasiBinding,
  createWasiBrowserBinding,
  createWasiDeferredBrowserBinding,
  createWasiDeferredBrowserBindingTypeDef,
} from '../templates/load-wasi-template.js'
import { createWasiBrowserWorkerBinding } from '../templates/wasi-worker-template.js'

const test = ava
const execFileAsync = promisify(execFile)

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
  t.true(node.includes("require.resolve('@scope/test-wasm32-wasip1')"))
  t.true(
    node.includes(
      "__nodePath.dirname(__wasiPackageEntry),\n    'test-wasi.wasm32-wasip1.wasm'",
    ),
  )
  t.false(node.includes('@scope/test-wasm32-wasi/'))
  assertValidJS(t, browser, 'single-thread browser binding')
  assertValidJS(t, node, 'single-thread Node binding')
})

test('threaded WASI node binding keeps the legacy wasm32-wasi package fallback', (t) => {
  const node = createWasiBinding('test-wasi.wasm32-wasi', '@scope/test')
  t.true(node.includes("require.resolve('@scope/test-wasm32-wasi')"))
  assertValidJS(t, node, 'threaded Node binding')
})

test('standalone WASI node binding separates local and packaged artifact names', (t) => {
  const node = createWasiBinding(
    'test-wasi',
    '@scope/test',
    4000,
    65536,
    false,
    'wasm32-wasip1',
    'test-wasi.wasm32-wasip1',
  )
  t.true(node.includes("__nodePath.join(__dirname, 'test-wasi.wasm')"))
  t.true(node.includes("require.resolve('@scope/test-wasm32-wasip1')"))
  t.true(node.includes("'test-wasi.wasm32-wasip1.wasm'"))
})

function executeGeneratedWasiNodeBinding(
  code: string,
  resolvePackage: (specifier: string) => string,
  packagedWasmPath?: string,
) {
  const readPaths: string[] = []
  const mockRequire = Object.assign(
    (specifier: string) => {
      switch (specifier) {
        case 'node:fs':
          return {
            existsSync(path: string) {
              return path === packagedWasmPath
            },
            readFileSync(path: string) {
              readPaths.push(path)
              return new Uint8Array()
            },
          }
        case 'node:path':
          return {
            dirname(path: string) {
              return path.slice(0, path.lastIndexOf('/'))
            },
            join(...parts: string[]) {
              return parts.join('/').replaceAll('//', '/')
            },
            parse() {
              return { root: '/' }
            },
          }
        case 'node:wasi':
          return { WASI: class {} }
        case '@napi-rs/wasm-runtime':
          return {
            createContext() {
              return {}
            },
            instantiateNapiModuleSync() {
              return {
                instance: {},
                module: {},
                napiModule: { exports: {} },
              }
            },
          }
        default:
          throw new Error(`Unexpected require: ${specifier}`)
      }
    },
    { resolve: resolvePackage },
  )
  const execute = new Function('require', 'process', '__dirname', code)
  execute(mockRequire, { cwd: () => '/', env: {} }, '/root')
  return { readPaths }
}

test('WASI node binding resolves an exported package entry before deriving its wasm path', (t) => {
  const packageName = '@scope/test-wasm32-wasip1'
  const packageEntry = `/node_modules/${packageName}/test.wasip1.cjs`
  const packagedWasm = `/node_modules/${packageName}/test.wasm32-wasip1.wasm`
  const code = createWasiBinding(
    'test.wasm32-wasip1',
    '@scope/test',
    1,
    2,
    false,
    'wasm32-wasip1',
    'test.wasm32-wasip1',
  )
  const resolveCalls: string[] = []
  const { readPaths } = executeGeneratedWasiNodeBinding(
    code,
    (specifier) => {
      resolveCalls.push(specifier)
      return packageEntry
    },
    packagedWasm,
  )

  t.deepEqual(resolveCalls, [packageName])
  t.deepEqual(readPaths, [packagedWasm])
})

test('WASI node binding preserves package resolution failures', (t) => {
  const resolutionError = Object.assign(new Error('invalid package metadata'), {
    code: 'ERR_INVALID_PACKAGE_CONFIG',
  })
  const code = createWasiBinding(
    'test.wasm32-wasip1',
    '@scope/test',
    1,
    2,
    false,
    'wasm32-wasip1',
    'test.wasm32-wasip1',
  )
  const error = t.throws(() =>
    executeGeneratedWasiNodeBinding(code, () => {
      throw resolutionError
    }),
  )

  t.is(error, resolutionError)
})

test('deferred single-thread WASI binding is workerd-safe', (t) => {
  const src = createWasiDeferredBrowserBinding('custom_async_runtime')
  // workerd bans: I/O in global scope, compile-from-bytes
  t.false(src.includes('await fetch'))
  t.false(src.includes('arrayBuffer'))
  // The wasm imports `env.memory` (built with `--import-memory`), so a
  // Memory allocation is required — but only in function scope
  // (workerd-legal), never in global scope.
  const exportOffset = src.indexOf('export async function createInstance')
  t.true(exportOffset > 0)
  const topLevel = src.slice(0, exportOffset)
  t.false(topLevel.includes('new WebAssembly.Memory'))
  t.false(topLevel.includes('fetch('))
  t.false(src.includes('shared: true'))
  t.false(src.includes('new Worker'))
  t.true(src.includes('initial: 1024'))
  t.false(src.includes('initial: 4000'))
  t.true(src.includes('export function instantiate'))
  t.true(src.includes('export async function createInstance'))
  t.true(src.includes('export async function dispose'))
  t.true(src.includes('asyncWorkPoolSize: 0'))
  t.true(src.includes('__emnapiCreateContext({ autoDestroy: false })'))
  t.true(src.includes('__managedEmnapiContextDestroyers'))
  t.false(src.includes('__takeAddedBeforeExitListeners'))
  // instantiate() accepts ONLY a precompiled WebAssembly.Module (or a Promise
  // resolving to one): anything else would require dynamic Wasm compilation,
  // which Cloudflare workerd bans everywhere. The guard must be a brand check
  // (`WebAssembly.Module.imports`), not `instanceof`: prototype-spoofed byte
  // buffers pass `instanceof`, and genuine cross-realm Modules fail it.
  t.true(src.includes('WebAssembly.Module.imports(__module)'))
  t.true(src.includes('throw new TypeError'))
  t.false(src.includes('any input emnapi accepts'))
  // The brand guard must run before realm normalization and before emnapi is
  // handed the input. emnapi currently performs realm-local instanceof checks,
  // so valid foreign Modules are structured-cloned into this realm without
  // compiling bytes.
  const guardOffset = src.indexOf('WebAssembly.Module.imports(__module)')
  const normalizationOffset = src.indexOf(
    '__module instanceof WebAssembly.Module',
  )
  const cloneOffset = src.indexOf('structuredClone(__module)')
  const emnapiCallOffset = src.indexOf('__emnapiInstantiateNapiModule(')
  t.true(emnapiCallOffset > 0)
  t.true(
    guardOffset > 0 &&
      guardOffset < normalizationOffset &&
      normalizationOffset < cloneOffset &&
      cloneOffset < emnapiCallOffset,
  )
  assertValidJS(t, src, 'deferred single-thread browser binding')
})

test('browser WASI binding validates fetch before allocating runtime state', (t) => {
  const src = createWasiBrowserBinding(
    'custom_async_runtime',
    1,
    2,
    false,
    false,
    false,
    false,
    false,
  )
  const fetchOffset = src.indexOf('await globalThis.fetch(__wasmUrl)')
  const responseCheckOffset = src.indexOf('if (!__wasmResponse.ok)')
  const contextOffset = src.indexOf('__emnapiCreateContext()')
  const memoryOffset = src.indexOf('new WebAssembly.Memory')

  t.true(fetchOffset > 0)
  t.true(responseCheckOffset > fetchOffset)
  t.true(contextOffset > responseCheckOffset)
  t.true(memoryOffset > responseCheckOffset)
  t.true(src.includes('Failed to fetch WASI module'))
})

test('deferred single-thread WASI binding exposes typed lifecycle APIs', (t) => {
  const typeDef = createWasiDeferredBrowserBindingTypeDef(
    '@scope/custom-runtime',
  )
  t.true(
    typeDef.includes(
      "export type WasiBinding = typeof import('@scope/custom-runtime')",
    ),
  )
  t.true(
    typeDef.includes(
      'export function instantiate(wasmInput: WasiModuleInput): Promise<WasiBinding>',
    ),
  )
  t.true(
    typeDef.includes(
      'export function createInstance(wasmInput: WasiModuleInput): Promise<WasiInstance>',
    ),
  )
  const result = parseSync('workerd.d.ts', typeDef, {
    lang: 'ts',
    sourceType: 'module',
  })
  t.deepEqual(result.errors, [])
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

test.serial(
  'deferred WASI binding observes rejected input while disposal is pending',
  async (t) => {
    const src = createWasiDeferredBrowserBinding('custom_async_runtime', 1, 2)
    const tmpDir = await mkdtemp(
      join(fileURLToPath(new URL('.', import.meta.url)), '.tmp-disposal-race-'),
    )

    try {
      const runtimeDir = join(
        tmpDir,
        'node_modules',
        '@napi-rs',
        'wasm-runtime',
      )
      const emnapiRuntimeDir = join(
        tmpDir,
        'node_modules',
        '@emnapi',
        'runtime',
      )
      await mkdir(runtimeDir, { recursive: true })
      await mkdir(emnapiRuntimeDir, { recursive: true })
      await writeFile(
        join(runtimeDir, 'package.json'),
        JSON.stringify({
          name: '@napi-rs/wasm-runtime',
          type: 'module',
          exports: './index.js',
        }),
      )
      await writeFile(
        join(runtimeDir, 'index.js'),
        `export class WASI {}
export async function instantiateNapiModule() {
  const state = globalThis.__napiDeferredRaceState
  state.initializationStarted = true
  await state.initializationGate
  return { napiModule: { exports: { initialized: true } } }
}
`,
      )
      await writeFile(
        join(emnapiRuntimeDir, 'package.json'),
        JSON.stringify({
          name: '@emnapi/runtime',
          type: 'module',
          exports: './index.js',
        }),
      )
      await writeFile(
        join(emnapiRuntimeDir, 'index.js'),
        `export function createContext(options) {
  if (options?.autoDestroy !== false) {
    throw new Error('deferred loader must disable emnapi auto-destroy')
  }
  return {
    destroy() {
      globalThis.__napiDeferredRaceState.destroyed++
    },
  }
}
`,
      )
      await writeFile(join(tmpDir, 'deferred.mjs'), src)
      await writeFile(
        join(tmpDir, 'race.mjs'),
        `let releaseInitialization
const state = {
  destroyed: 0,
  initializationStarted: false,
  initializationGate: new Promise((resolve) => {
    releaseInitialization = resolve
  }),
}
globalThis.__napiDeferredRaceState = state

const { dispose, instantiate } = await import('./deferred.mjs')
const module = new WebAssembly.Module(
  new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]),
)
const pending = instantiate(module)
while (!state.initializationStarted) {
  await Promise.resolve()
}

const disposing = dispose()
const moduleResolutionError = new Error('module resolution failed')
let overlappingSettled = false
const overlapping = instantiate(Promise.reject(moduleResolutionError)).then(
  () => {
    overlappingSettled = true
    throw new Error('instantiate() unexpectedly resolved')
  },
  (error) => {
    overlappingSettled = true
    if (error !== moduleResolutionError) {
      throw error
    }
  },
)

await new Promise((resolve) => setImmediate(resolve))
if (overlappingSettled) {
  throw new Error('instantiate() settled before disposal completed')
}

releaseInitialization()
await pending
await disposing
await overlapping
if (state.destroyed !== 1) {
  throw new Error('dispose() did not destroy the in-flight instance')
}
`,
      )

      await t.notThrowsAsync(() =>
        execFileAsync(
          process.execPath,
          ['--unhandled-rejections=strict', join(tmpDir, 'race.mjs')],
          { cwd: tmpDir, timeout: 10_000 },
        ),
      )
    } finally {
      await rm(tmpDir, { recursive: true, force: true })
    }
  },
)

test.serial(
  'deferred WASI binding shares, disposes, and isolates instances',
  async (t) => {
    const src = createWasiDeferredBrowserBinding('custom_async_runtime', 1, 2)
    const tmpDir = await mkdtemp(
      join(fileURLToPath(new URL('.', import.meta.url)), '.tmp-lifecycle-'),
    )
    const state = {
      contexts: 0,
      destroyed: [] as number[],
      instances: 0,
      initializationError: undefined as Error | undefined,
      initializationGate: undefined as Promise<void> | undefined,
      cleanupError: undefined as Error | undefined,
      contextError: undefined as Error | undefined,
      contextOptions: [] as unknown[],
    }
    ;(globalThis as any).__napiDeferredTestState = state
    const originalMemory = WebAssembly.Memory
    const initialBeforeExitListeners = new Set(
      process.rawListeners('beforeExit'),
    )

    try {
      const runtimeDir = join(
        tmpDir,
        'node_modules',
        '@napi-rs',
        'wasm-runtime',
      )
      const emnapiRuntimeDir = join(
        tmpDir,
        'node_modules',
        '@emnapi',
        'runtime',
      )
      await mkdir(runtimeDir, { recursive: true })
      await mkdir(emnapiRuntimeDir, { recursive: true })
      await writeFile(
        join(runtimeDir, 'package.json'),
        JSON.stringify({
          name: '@napi-rs/wasm-runtime',
          type: 'module',
          exports: './index.js',
        }),
      )
      await writeFile(
        join(runtimeDir, 'index.js'),
        `export class WASI {
  constructor(options) {
    this.options = options
  }
}
export async function instantiateNapiModule(module, options) {
  const state = globalThis.__napiDeferredTestState
  if (!(module instanceof WebAssembly.Module)) {
    throw new TypeError('Invalid wasm module')
  }
  const id = ++state.instances
  if (state.initializationError) {
    throw state.initializationError
  }
  options.overwriteImports({ env: {}, napi: {}, emnapi: {} })
  options.beforeInit({ instance: { exports: {} }, module })
  if (state.initializationGate) {
    await state.initializationGate
  }
  await Promise.resolve()
  return { napiModule: { exports: { id } } }
}
`,
      )
      await writeFile(
        join(emnapiRuntimeDir, 'package.json'),
        JSON.stringify({
          name: '@emnapi/runtime',
          type: 'module',
          exports: './index.js',
        }),
      )
      await writeFile(
        join(emnapiRuntimeDir, 'index.js'),
        `export function createContext(options) {
  const state = globalThis.__napiDeferredTestState
  state.contextOptions.push(options)
  // @emnapi/runtime 1.11.x ignores autoDestroy and installs this anonymous
  // listener. The generated loader must replace it with owned cleanup.
  process.once('beforeExit', () => {})
  if (state.contextError) {
    throw state.contextError
  }
  const id = ++state.contexts
  return {
    destroy() {
      state.destroyed.push(id)
      if (state.cleanupError) {
        throw state.cleanupError
      }
    },
  }
}
`,
      )

      const loaderPath = join(tmpDir, 'deferred.mjs')
      await writeFile(loaderPath, src)
      const { createInstance, dispose, instantiate } = await import(
        pathToFileURL(loaderPath).href
      )
      const moduleA = new WebAssembly.Module(
        new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]),
      )
      const moduleB = new WebAssembly.Module(
        new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]),
      )
      const countOwnedBeforeExitListeners = () =>
        process
          .rawListeners('beforeExit')
          .filter((listener) => !initialBeforeExitListeners.has(listener))
          .length

      const memoryError = new Error('memory allocation failed')
      ;(WebAssembly as any).Memory = class {
        constructor() {
          throw memoryError
        }
      }
      const rejectedMemory = await t.throwsAsync(() => createInstance(moduleA))
      t.is(rejectedMemory, memoryError)
      t.is(state.contexts, 0)
      ;(WebAssembly as any).Memory = originalMemory

      const contextError = new Error('context creation failed')
      state.contextError = contextError
      t.is(await t.throwsAsync(() => createInstance(moduleA)), contextError)
      t.is(countOwnedBeforeExitListeners(), 0)
      state.contextError = undefined

      const initializationError = new Error('initialization failed')
      const cleanupError = new Error('cleanup failed')
      state.initializationError = initializationError
      state.cleanupError = cleanupError
      const rejectedInitialization = await t.throwsAsync(() =>
        createInstance(moduleA),
      )
      t.is(rejectedInitialization, initializationError)
      t.is(rejectedInitialization.cause, cleanupError)
      t.deepEqual(state.destroyed, [1])
      t.is(countOwnedBeforeExitListeners(), 0)
      state.initializationError = undefined
      state.cleanupError = undefined

      const [first, second] = await Promise.all([
        instantiate(moduleA),
        instantiate(Promise.resolve(moduleA)),
      ])
      t.is(first, second)
      t.is(state.instances, 2)
      t.is(state.contexts, 2)
      t.is(state.contextOptions.length, 3)
      t.true(
        state.contextOptions.every(
          (options: any) => options?.autoDestroy === false,
        ),
      )
      t.is(countOwnedBeforeExitListeners(), 1)

      await t.throwsAsync(() => instantiate(moduleB), {
        message: /already owns a different WebAssembly\.Module/,
      })

      await dispose()
      t.deepEqual(state.destroyed, [1, 2])
      t.is(countOwnedBeforeExitListeners(), 0)

      const [independentA, independentB] = await Promise.all([
        createInstance(moduleA),
        createInstance(moduleB),
      ])
      t.not(independentA.exports, independentB.exports)
      t.is(state.instances, 4)
      t.is(countOwnedBeforeExitListeners(), 1)
      state.cleanupError = cleanupError
      t.is(
        t.throws(() => independentA.dispose()),
        cleanupError,
      )
      t.is(countOwnedBeforeExitListeners(), 1)
      state.cleanupError = undefined
      independentA.dispose()
      independentA.dispose()
      independentB.dispose()
      t.deepEqual(state.destroyed, [1, 2, 3, 4])
      t.is(countOwnedBeforeExitListeners(), 0)

      const replacement = await instantiate(moduleB)
      t.is(replacement.id, 5)
      t.is(countOwnedBeforeExitListeners(), 1)
      state.cleanupError = cleanupError
      const failedDispose = dispose()
      const overlappingFailedDispose = instantiate(moduleA)
      const failedDisposeError = t.throwsAsync(failedDispose)
      const overlappingDisposeError = t.throwsAsync(overlappingFailedDispose)
      t.is(await failedDisposeError, cleanupError)
      t.is(await overlappingDisposeError, cleanupError)
      t.is(countOwnedBeforeExitListeners(), 0)
      state.cleanupError = undefined

      // Failed cleanup may leave the old context partially stopped. It is
      // terminal: the poisoned exports are never returned again and ownership
      // is clear for either module.
      const afterFailedDispose = await instantiate(moduleA)
      t.is(afterFailedDispose.id, 6)
      t.not(afterFailedDispose, replacement)
      t.is(countOwnedBeforeExitListeners(), 1)
      await dispose()
      t.deepEqual(state.destroyed, [1, 2, 3, 4, 5, 6])
      t.is(countOwnedBeforeExitListeners(), 0)

      state.initializationError = initializationError
      t.is(await t.throwsAsync(() => instantiate(moduleB)), initializationError)
      t.deepEqual(state.destroyed, [1, 2, 3, 4, 5, 6, 7])
      t.is(countOwnedBeforeExitListeners(), 0)
      state.initializationError = undefined
      const recovered = await instantiate(moduleB)
      t.is(recovered.id, 8)
      await dispose()
      t.deepEqual(state.destroyed, [1, 2, 3, 4, 5, 6, 7, 8])
      t.is(countOwnedBeforeExitListeners(), 0)

      let releaseInitialization!: () => void
      state.initializationGate = new Promise<void>((resolve) => {
        releaseInitialization = resolve
      })
      const pending = instantiate(moduleA)
      while (state.instances < 9) {
        await Promise.resolve()
      }
      const disposing = dispose()
      const overlapping = instantiate(moduleA)
      releaseInitialization()
      const firstRacedInstance = await pending
      await disposing
      state.initializationGate = undefined
      const replacementAfterDispose = await overlapping
      t.is(firstRacedInstance.id, 9)
      t.is(replacementAfterDispose.id, 10)
      t.not(firstRacedInstance, replacementAfterDispose)
      t.deepEqual(state.destroyed, [1, 2, 3, 4, 5, 6, 7, 8, 9])
      await dispose()
      t.deepEqual(state.destroyed, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
      t.is(countOwnedBeforeExitListeners(), 0)

      const hostileInitializationError = new Error(
        'initialization failed with hostile cause',
      )
      Object.defineProperty(hostileInitializationError, 'cause', {
        get() {
          throw new Error('cause access failed')
        },
      })
      state.initializationError = hostileInitializationError
      state.cleanupError = cleanupError
      let observedInitializationError: unknown
      try {
        await createInstance(moduleA)
      } catch (error) {
        observedInitializationError = error
      }
      t.is(observedInitializationError, hostileInitializationError)
      t.deepEqual(state.destroyed, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
      t.is(countOwnedBeforeExitListeners(), 0)
      state.initializationError = undefined
      state.cleanupError = undefined

      const pendingBeforeFirstAwait = instantiate(Promise.resolve(moduleA))
      const disposeBeforeFirstAwait = dispose()
      const instanceBeforeFirstAwait = await pendingBeforeFirstAwait
      await disposeBeforeFirstAwait
      t.is(instanceBeforeFirstAwait.id, 12)
      t.deepEqual(state.destroyed, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
      t.is(countOwnedBeforeExitListeners(), 0)

      const moduleResolutionError = new Error('module resolution failed')
      const instancesBeforeRejectedModule = state.instances
      const destroyedBeforeRejectedModule = state.destroyed.length
      const rejectedModule = instantiate(Promise.reject(moduleResolutionError))
      const disposeRejectedModule = dispose()
      t.is(await t.throwsAsync(rejectedModule), moduleResolutionError)
      t.is(await t.throwsAsync(disposeRejectedModule), moduleResolutionError)
      t.is(state.instances, instancesBeforeRejectedModule)
      t.is(state.destroyed.length, destroyedBeforeRejectedModule)

      const recoveredAfterRejectedModule = await instantiate(moduleA)
      t.is(recoveredAfterRejectedModule.id, instancesBeforeRejectedModule + 1)
      await dispose()

      const racedInitializationError = new Error('raced initialization failed')
      state.initializationError = racedInitializationError
      const instancesBeforeRejectedInstance = state.instances
      const contextsBeforeRejectedInstance = state.contexts
      const destroyedBeforeRejectedInstance = state.destroyed.length
      const rejectedInstance = instantiate(moduleB)
      const disposeRejectedInstance = dispose()
      t.is(await t.throwsAsync(rejectedInstance), racedInitializationError)
      t.is(
        await t.throwsAsync(disposeRejectedInstance),
        racedInitializationError,
      )
      state.initializationError = undefined
      t.is(state.instances, instancesBeforeRejectedInstance + 1)
      t.is(state.contexts, contextsBeforeRejectedInstance + 1)
      t.deepEqual(state.destroyed.slice(destroyedBeforeRejectedInstance), [
        contextsBeforeRejectedInstance + 1,
      ])

      const recoveredAfterRejectedInstance = await instantiate(moduleB)
      t.is(recoveredAfterRejectedInstance.id, state.instances)
      await dispose()
      t.deepEqual(state.destroyed.slice(destroyedBeforeRejectedInstance), [
        contextsBeforeRejectedInstance + 1,
        contextsBeforeRejectedInstance + 2,
      ])

      const crossRealmModule = runInNewContext(
        'new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]))',
      )
      Object.freeze(crossRealmModule)
      t.false(
        crossRealmModule instanceof (globalThis as any).WebAssembly.Module,
      )
      const originalStructuredClone = globalThis.structuredClone
      ;(globalThis as any).structuredClone = undefined
      let crossRealmFirst
      let crossRealmSecond
      try {
        ;[crossRealmFirst, crossRealmSecond] = await Promise.all([
          instantiate(crossRealmModule),
          instantiate(Promise.resolve(crossRealmModule)),
        ])
      } finally {
        globalThis.structuredClone = originalStructuredClone
      }
      t.is(crossRealmFirst, crossRealmSecond)
      t.false(
        crossRealmModule instanceof (globalThis as any).WebAssembly.Module,
      )
      t.is(countOwnedBeforeExitListeners(), 1)
      await dispose()
      t.is(countOwnedBeforeExitListeners(), 0)

      const destroyedBeforeConcurrentInstances = state.destroyed.length
      const concurrentInstances = await Promise.all(
        Array.from({ length: 20 }, () => createInstance(moduleA)),
      )
      t.is(countOwnedBeforeExitListeners(), 1)
      for (const instance of concurrentInstances) {
        instance.dispose()
      }
      t.is(countOwnedBeforeExitListeners(), 0)
      t.is(state.destroyed.length, destroyedBeforeConcurrentInstances + 20)

      const destroyedBeforeRepeatedInstances = state.destroyed.length
      for (let i = 0; i < 20; i++) {
        const instance = await createInstance(moduleA)
        t.is(countOwnedBeforeExitListeners(), 1)
        instance.dispose()
        t.is(countOwnedBeforeExitListeners(), 0)
      }
      t.is(state.destroyed.length, destroyedBeforeRepeatedInstances + 20)
    } finally {
      ;(WebAssembly as any).Memory = originalMemory
      for (const listener of process.rawListeners('beforeExit')) {
        if (!initialBeforeExitListeners.has(listener)) {
          process.removeListener('beforeExit', listener)
        }
      }
      delete (globalThis as any).__napiDeferredTestState
      await rm(tmpDir, { recursive: true, force: true })
    }
  },
)

test.serial(
  'deferred WASI binding owns lifecycle with the installed emnapi runtime',
  async (t) => {
    const src = createWasiDeferredBrowserBinding('custom_async_runtime', 1, 2)
    const tmpDir = await mkdtemp(
      join(fileURLToPath(new URL('.', import.meta.url)), '.tmp-emnapi-'),
    )
    const initialBeforeExitListeners = new Set(
      process.rawListeners('beforeExit'),
    )

    try {
      const runtimeDir = join(
        tmpDir,
        'node_modules',
        '@napi-rs',
        'wasm-runtime',
      )
      const emnapiRuntimeDir = join(
        tmpDir,
        'node_modules',
        '@emnapi',
        'runtime',
      )
      await mkdir(runtimeDir, { recursive: true })
      await mkdir(emnapiRuntimeDir, { recursive: true })
      await writeFile(
        join(runtimeDir, 'package.json'),
        JSON.stringify({
          name: '@napi-rs/wasm-runtime',
          type: 'module',
          exports: './index.js',
        }),
      )
      await writeFile(
        join(runtimeDir, 'index.js'),
        `export class WASI {}
export async function instantiateNapiModule(module) {
  if (!(module instanceof WebAssembly.Module)) {
    throw new TypeError('Invalid wasm module')
  }
  return { napiModule: { exports: {} } }
}
`,
      )
      await writeFile(
        join(emnapiRuntimeDir, 'package.json'),
        JSON.stringify({
          name: '@emnapi/runtime',
          type: 'module',
          exports: './index.js',
        }),
      )
      await writeFile(
        join(emnapiRuntimeDir, 'index.js'),
        `export { createContext } from ${JSON.stringify(import.meta.resolve('@emnapi/runtime'))}
`,
      )

      const loaderPath = join(tmpDir, 'deferred.mjs')
      await writeFile(loaderPath, src)
      const { createInstance } = await import(pathToFileURL(loaderPath).href)
      const module = new WebAssembly.Module(
        new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]),
      )
      const countOwnedBeforeExitListeners = () =>
        process
          .rawListeners('beforeExit')
          .filter((listener) => !initialBeforeExitListeners.has(listener))
          .length

      const instances = await Promise.all(
        Array.from({ length: 20 }, () => createInstance(module)),
      )
      t.is(countOwnedBeforeExitListeners(), 1)
      for (const instance of instances) {
        instance.dispose()
      }
      t.is(countOwnedBeforeExitListeners(), 0)
    } finally {
      for (const listener of process.rawListeners('beforeExit')) {
        if (!initialBeforeExitListeners.has(listener)) {
          process.removeListener('beforeExit', listener)
        }
      }
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

test('createWasiBrowserBinding does not collide with an exported fetch binding', (t) => {
  const code = createWasiBrowserBinding('test')

  t.true(code.includes('await globalThis.fetch(__wasmUrl)'))
  t.false(code.includes('await fetch(__wasmUrl)'))
})

test('WASI main loaders create an isolated context', (t) => {
  const contexts: object[] = []
  const code = `${createWasiBinding('test', '@scope/test')}
module.exports = __napiModule.exports
`

  function load() {
    const module: {
      exports: {
        add?: (left: number, right: number) => number
      }
    } = { exports: {} }
    const require = (specifier: string) => {
      switch (specifier) {
        case 'node:fs':
          return {
            existsSync: (path: string) => path.endsWith('test.wasm'),
            readFileSync: () => new Uint8Array(),
          }
        case 'node:path':
          return {
            join: (...parts: string[]) => parts.join('/'),
            parse: () => ({ root: '/' }),
          }
        case 'node:wasi':
          return { WASI: class {} }
        case 'node:worker_threads':
          return { Worker: class {} }
        case '@napi-rs/wasm-runtime':
          return {
            createContext() {
              const context = {}
              contexts.push(context)
              return context
            },
            createOnMessage() {},
            instantiateNapiModuleSync(
              _wasm: Uint8Array,
              options: { context: object },
            ) {
              t.is(options.context, contexts.at(-1)!)
              return {
                instance: {},
                module: {},
                napiModule: {
                  exports: {
                    add: (left: number, right: number) => left + right,
                  },
                },
              }
            },
          }
        default:
          throw new Error(`Unexpected require: ${specifier}`)
      }
    }

    new Function(
      'require',
      'module',
      'process',
      '__dirname',
      'WebAssembly',
      code,
    )(require, module, { cwd: () => '/', env: {} }, '/fixture', {
      Memory: class {},
    })
    return module.exports as {
      add: (left: number, right: number) => number
    }
  }

  const first = load()
  const firstContext = contexts.at(-1)
  const second = load()
  const secondContext = contexts.at(-1)

  t.not(firstContext, secondContext)
  t.is(first.add(1, 2), 3)
  t.is(second.add(2, 3), 5)

  const browserCode = createWasiBrowserBinding('test')
  t.true(browserCode.includes('createContext as __emnapiCreateContext'))
  t.false(browserCode.includes('napi.rs.wasi.context'))
})

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

test('js binding wasi fallback tries local flavors before package fallbacks', (t) => {
  const code = createCjsBinding('test', '@scope/test', ['sum'], undefined, [
    'wasm32-wasi',
    'wasm32-wasip1',
  ])
  const order = [
    "require('./test.wasi.cjs')",
    "require('./test.wasip1.cjs')",
    "require('@scope/test-wasm32-wasi')",
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
  const guardCount = code.match(/if \(!wasiBindingLoaded\) \{/g)?.length ?? 0
  t.is(guardCount, order.length)
  assertValidJS(t, code, 'cjs binding with both wasi flavors')
})

function executeGeneratedCjsBinding(
  code: string,
  implementations: Map<string, () => unknown>,
  resolvable: Set<string>,
  resolveErrors: Map<string, Error> = new Map(),
  env: Record<string, string> = { NAPI_RS_FORCE_WASI: 'true' },
  resolveCalls: string[] = [],
) {
  const calls: string[] = []
  const mockRequire = Object.assign(
    (specifier: string) => {
      calls.push(specifier)
      if (specifier === 'fs') {
        return { readFileSync: () => '' }
      }
      const implementation = implementations.get(specifier)
      if (implementation) {
        return implementation()
      }
      const error = new Error(`Cannot find module ${specifier}`)
      Object.assign(error, { code: 'MODULE_NOT_FOUND' })
      throw error
    },
    {
      resolve(specifier: string) {
        resolveCalls.push(specifier)
        const resolveError = resolveErrors.get(specifier)
        if (resolveError) {
          throw resolveError
        }
        if (resolvable.has(specifier)) {
          return specifier
        }
        const error = new Error(`Cannot find module ${specifier}`)
        Object.assign(error, { code: 'MODULE_NOT_FOUND' })
        throw error
      },
    },
  )
  const module = { exports: {} }
  const execute = new Function('require', 'process', 'module', 'exports', code)
  execute(
    mockRequire,
    {
      platform: 'unsupported',
      arch: 'x64',
      env,
    },
    module,
    module.exports,
  )
  return { calls, resolveCalls, exports: module.exports }
}

test('js binding does not cross WASI flavors after an existing loader fails initialization', (t) => {
  const code = createCjsBinding('test', '@scope/test', ['sum'], undefined, [
    'wasm32-wasi',
    'wasm32-wasip1',
  ])
  const threadedLocal = './test.wasi.cjs'
  const threadedArtifact = './test.wasm32-wasi.wasm'
  const singleLocal = './test.wasip1.cjs'
  const calls: string[] = []
  const error = t.throws(() => {
    const result = executeGeneratedCjsBinding(
      code,
      new Map([
        [
          threadedLocal,
          () => {
            calls.push(threadedLocal)
            throw new Error('threaded initialization failed')
          },
        ],
        [
          singleLocal,
          () => {
            calls.push(singleLocal)
            return { sum: () => 42 }
          },
        ],
      ]),
      new Set([threadedLocal, threadedArtifact, singleLocal]),
    )
    calls.push(...result.calls)
  })

  t.is(error.message, 'threaded initialization failed')
  t.false(calls.includes(singleLocal))
})

test('js binding advances to the next WASI flavor when earlier candidates are absent', (t) => {
  const code = createCjsBinding('test', '@scope/test', ['sum'], undefined, [
    'wasm32-wasi',
    'wasm32-wasip1',
  ])
  const singleLocal = './test.wasip1.cjs'
  const singleArtifact = './test.wasm32-wasip1.wasm'
  const result = executeGeneratedCjsBinding(
    code,
    new Map([[singleLocal, () => ({ sum: () => 42 })]]),
    new Set([singleLocal, singleArtifact]),
  )

  t.true(result.calls.includes(singleLocal))
  t.is((result.exports as { sum: () => number }).sum(), 42)
})

test('js binding prefers an explicit local threadless artifact over an installed threaded package', (t) => {
  const code = createCjsBinding('test', '@scope/test', ['sum'], undefined, [
    'wasm32-wasi',
    'wasm32-wasip1',
  ])
  const threadedPackage = '@scope/test-wasm32-wasi'
  const singleLocal = './test.wasip1.cjs'
  const singleArtifact = './test.wasm32-wasip1.wasm'
  const result = executeGeneratedCjsBinding(
    code,
    new Map([
      [threadedPackage, () => ({ sum: () => 1 })],
      [singleLocal, () => ({ sum: () => 42 })],
    ]),
    new Set([threadedPackage, singleLocal, singleArtifact]),
  )

  t.true(result.calls.includes(singleLocal))
  t.false(result.calls.includes(threadedPackage))
  t.is((result.exports as { sum: () => number }).sum(), 42)
})

test('js binding skips a stale local flavor loader whose wasm artifact is absent', (t) => {
  const code = createCjsBinding('test', '@scope/test', ['sum'], undefined, [
    'wasm32-wasi',
    'wasm32-wasip1',
  ])
  const threadedLocal = './test.wasi.cjs'
  const singleLocal = './test.wasip1.cjs'
  const singleArtifact = './test.wasm32-wasip1.wasm'
  const result = executeGeneratedCjsBinding(
    code,
    new Map([
      [
        threadedLocal,
        () => {
          throw new Error('stale threaded loader must not initialize')
        },
      ],
      [singleLocal, () => ({ sum: () => 42 })],
    ]),
    new Set([threadedLocal, singleLocal, singleArtifact]),
  )

  t.false(result.calls.includes(threadedLocal))
  t.true(result.calls.includes(singleLocal))
  t.is((result.exports as { sum: () => number }).sum(), 42)
})

test('js binding does not mask non-missing WASI resolution failures', (t) => {
  const code = createCjsBinding('test', '@scope/test', ['sum'], undefined, [
    'wasm32-wasi',
    'wasm32-wasip1',
  ])
  const threadedLocal = './test.wasi.cjs'
  const singleLocal = './test.wasip1.cjs'
  const resolveError = Object.assign(
    new Error('invalid threaded package metadata'),
    {
      code: 'ERR_INVALID_PACKAGE_CONFIG',
    },
  )
  const calls: string[] = []
  const error = t.throws(() => {
    const result = executeGeneratedCjsBinding(
      code,
      new Map([
        [
          threadedLocal,
          () => {
            calls.push(threadedLocal)
            throw resolveError
          },
        ],
        [
          singleLocal,
          () => {
            calls.push(singleLocal)
            return { sum: () => 42 }
          },
        ],
      ]),
      new Set([singleLocal]),
      new Map([[threadedLocal, resolveError]]),
    )
    calls.push(...result.calls)
  })

  t.is(error, resolveError)
  t.false(calls.includes(singleLocal))
})

test('js binding does not treat an installed package with a broken entry as absent', (t) => {
  const code = createCjsBinding('test', '@scope/test', ['sum'], undefined, [
    'wasm32-wasi',
    'wasm32-wasip1',
  ])
  const threadedPackage = '@scope/test-wasm32-wasi'
  const singlePackage = '@scope/test-wasm32-wasip1'
  const resolveError = Object.assign(
    new Error(
      'Cannot find module \'/node_modules/@scope/test-wasm32-wasi/missing.cjs\'. Please verify that the package.json has a valid "main" entry',
    ),
    {
      code: 'MODULE_NOT_FOUND',
      path: '/node_modules/@scope/test-wasm32-wasi/package.json',
      requestPath: threadedPackage,
    },
  )
  const error = t.throws(() =>
    executeGeneratedCjsBinding(
      code,
      new Map([[singlePackage, () => ({ sum: () => 42 })]]),
      new Set([`${threadedPackage}/package.json`, singlePackage]),
      new Map([[threadedPackage, resolveError]]),
    ),
  )

  t.is(error, resolveError)
})

test('js binding preserves a broken package entry when package.json is not exported', (t) => {
  const code = createCjsBinding('test', '@scope/test', ['sum'], undefined, [
    'wasm32-wasi',
    'wasm32-wasip1',
  ])
  const threadedPackage = '@scope/test-wasm32-wasi'
  const resolveError = Object.assign(
    new Error(`Cannot find module '${threadedPackage}/missing.cjs'`),
    {
      code: 'MODULE_NOT_FOUND',
    },
  )
  const packageJsonError = Object.assign(
    new Error(
      `Package subpath './package.json' is not defined by "exports" in ${threadedPackage}/package.json`,
    ),
    {
      code: 'ERR_PACKAGE_PATH_NOT_EXPORTED',
    },
  )
  const error = t.throws(() =>
    executeGeneratedCjsBinding(
      code,
      new Map(),
      new Set(),
      new Map([
        [threadedPackage, resolveError],
        [`${threadedPackage}/package.json`, packageJsonError],
      ]),
    ),
  )

  t.is(error, resolveError)
})

test('js binding preserves loader initialization errors without resolving again', (t) => {
  const code = createCjsBinding('test', '@scope/test', ['sum'], undefined, [
    'wasm32-wasi',
    'wasm32-wasip1',
  ])
  const threadedLocal = './test.wasi.cjs'
  const threadedDebugArtifact = './test.wasm32-wasi.debug.wasm'
  const threadedArtifact = './test.wasm32-wasi.wasm'
  const initializationError = new Error('threaded initialization failed')
  const resolveCalls: string[] = []
  const error = t.throws(() => {
    executeGeneratedCjsBinding(
      code,
      new Map([
        [
          threadedLocal,
          () => {
            throw initializationError
          },
        ],
      ]),
      new Set([threadedLocal, threadedArtifact]),
      new Map(),
      { NAPI_RS_FORCE_WASI: 'true' },
      resolveCalls,
    )
  })

  t.is(error, initializationError)
  t.deepEqual(resolveCalls, [
    threadedLocal,
    threadedDebugArtifact,
    threadedArtifact,
  ])
})

test('js binding checks a WASI package version before initialization', (t) => {
  const code = createCjsBinding('test', '@scope/test', ['sum'], '1.0.0', [
    'wasm32-wasi',
  ])
  const threadedPackage = '@scope/test-wasm32-wasi'
  let initialized = false
  const error = t.throws(() =>
    executeGeneratedCjsBinding(
      code,
      new Map([
        [
          `${threadedPackage}/package.json`,
          () => ({
            version: '2.0.0',
          }),
        ],
        [
          threadedPackage,
          () => {
            initialized = true
            return { sum: () => 42 }
          },
        ],
      ]),
      new Set([threadedPackage, `${threadedPackage}/package.json`]),
      new Map(),
      {
        NAPI_RS_FORCE_WASI: 'true',
        NAPI_RS_ENFORCE_VERSION_CHECK: '1',
      },
    ),
  )

  t.regex(error.message, /WASI binding package version mismatch/)
  t.false(initialized)
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

test('createCjsBinding does not mutate frozen load errors', (t) => {
  const immutableError = Object.freeze(
    Object.assign(new Error('immutable loader failure'), {
      code: 'MODULE_NOT_FOUND',
    }),
  )
  const require = Object.assign(
    (specifier: string) => {
      if (specifier === 'fs') {
        return { readFileSync: () => '' }
      }
      throw immutableError
    },
    {
      resolve(specifier: string) {
        const error = new Error(`Cannot find module ${specifier}`)
        Object.assign(error, { code: 'MODULE_NOT_FOUND' })
        throw error
      },
    },
  )
  const module = { exports: {} }
  const process = {
    arch: 'arm64',
    env: { NAPI_RS_NATIVE_LIBRARY_PATH: '/native.node' },
    platform: 'darwin',
  }
  const code = createCjsBinding('test', '@scope/test', [])

  const error = t.throws(() => {
    new Function('require', 'module', 'process', code)(require, module, process)
  }) as Error & { cause?: Error }

  t.is(error.cause?.message, immutableError.message)
  t.false(Object.prototype.hasOwnProperty.call(immutableError, 'cause'))
})

test('createCjsBinding forced WASI skips native addon initialization', (t) => {
  const wasiBinding = { runtime: 'wasi' }
  const requiredSpecifiers: string[] = []
  const require = Object.assign(
    (specifier: string) => {
      requiredSpecifiers.push(specifier)
      if (specifier === 'fs') {
        return { readFileSync: () => '' }
      }
      if (specifier === './test.wasi.cjs') {
        return wasiBinding
      }
      throw new Error(`Unexpected native require: ${specifier}`)
    },
    {
      resolve(specifier: string) {
        if (
          specifier === './test.wasi.cjs' ||
          specifier === './test.wasm32-wasi.wasm'
        ) {
          return specifier
        }
        const error = new Error(`Cannot find module ${specifier}`)
        Object.assign(error, { code: 'MODULE_NOT_FOUND' })
        throw error
      },
    },
  )
  const module = { exports: {} }
  const process = {
    arch: 'arm64',
    env: {
      NAPI_RS_FORCE_WASI: 'true',
      NAPI_RS_NATIVE_LIBRARY_PATH: '/native.node',
    },
    platform: 'darwin',
  }
  const code = createCjsBinding('test', '@scope/test', [])

  new Function('require', 'module', 'process', code)(require, module, process)

  t.is(module.exports, wasiBinding)
  t.deepEqual(requiredSpecifiers, ['fs', './test.wasi.cjs'])
})

test('createCjsBinding forced WASI retains a lazy native fallback', (t) => {
  const nativeBinding = { runtime: 'native' }
  const requiredSpecifiers: string[] = []
  const require = Object.assign(
    (specifier: string) => {
      requiredSpecifiers.push(specifier)
      if (specifier === 'fs') {
        return { readFileSync: () => '' }
      }
      if (specifier === '/native.node') {
        return nativeBinding
      }
      throw new Error(`Missing WASI binding: ${specifier}`)
    },
    {
      resolve(specifier: string) {
        const error = new Error(`Cannot find module ${specifier}`)
        Object.assign(error, { code: 'MODULE_NOT_FOUND' })
        throw error
      },
    },
  )
  const module = { exports: {} }
  const process = {
    arch: 'arm64',
    env: {
      NAPI_RS_FORCE_WASI: 'true',
      NAPI_RS_NATIVE_LIBRARY_PATH: '/native.node',
    },
    platform: 'darwin',
  }
  const code = createCjsBinding('test', '@scope/test', [])

  new Function('require', 'module', 'process', code)(require, module, process)

  t.is(module.exports, nativeBinding)
  t.deepEqual(requiredSpecifiers, ['fs', '/native.node'])
})

test('createEsmBinding is Node 12 compatible', (t) => {
  const code = createEsmBinding('test', '@scope/test', ['sum'])
  assertValidJS(t, code, 'esm')
  t.true(code.includes('const { sum } = nativeBinding'))
  t.true(code.includes('export { sum }'))
  t.false(code.includes('export default nativeBinding'))
  t.false(
    NODE_SCHEME_RE.test(code),
    'ESM loader must not use the node: scheme (incl. `import ... from "node:module"`)',
  )
  t.false(code.includes('?.'), 'ESM loader must not use optional chaining')
  t.false(code.includes('??'), 'ESM loader must not use nullish coalescing')
})

test('createEsmBinding defaults to the binding without type identifiers', (t) => {
  const code = createEsmBinding('test', '@scope/test', [], undefined, [
    'wasm32-wasip1',
  ])
  assertValidJS(t, code, 'untyped esm')
  t.true(code.includes('export default nativeBinding'))
  t.false(code.includes('const {  } = nativeBinding'))
})
