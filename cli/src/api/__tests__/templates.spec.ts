import { execFile } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
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

test('threaded WASI node workers sanitize inherited source execArgv', (t) => {
  const code = createWasiBinding('test', '@scope/test', 1, 2)
  let workerOptions:
    | {
        env?: Record<string, string>
        execArgv?: string[]
      }
    | undefined

  class Worker {
    constructor(
      _filename: string,
      options: {
        env?: Record<string, string>
        execArgv?: string[]
      },
    ) {
      workerOptions = options
    }

    unref() {}
  }

  const mockRequire = (specifier: string) => {
    switch (specifier) {
      case 'node:fs':
        return {
          existsSync: (path: string) => path.endsWith('/test.wasm'),
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
        return { Worker }
      case '@napi-rs/wasm-runtime':
        return {
          createOnMessage: () => () => {},
          instantiateNapiModuleSync(
            _wasm: Uint8Array,
            options: { onCreateWorker(): Worker },
          ) {
            options.onCreateWorker()
            return {
              instance: {},
              module: {},
              napiModule: { exports: {} },
            }
          },
        }
      case '@emnapi/runtime':
        return {
          createContext: () => ({
            destroy() {},
            suppressDestroy() {},
          }),
        }
      default:
        throw new Error(`Unexpected require: ${specifier}`)
    }
  }
  const processMock = {
    cwd: () => '/',
    env: { WORKER_TEST: '1' },
    execArgv: [
      '--trace-warnings',
      '--input-type=module',
      '--input-type',
      'commonjs',
      '--eval',
      'evaluate()',
      '-e',
      'shortEvaluate()',
      '--eval=inlineEvaluate()',
      '--print',
      'print()',
      '-p',
      'shortPrint()',
      '--print=inlinePrint()',
      '--require',
      './hook.cjs',
      '--print-bytecode',
      '--conditions=worker-test',
    ],
    once() {},
    rawListeners() {
      return []
    },
    removeListener() {},
  }
  const originalExecArgv = [...processMock.execArgv]

  new Function('require', 'process', '__dirname', code)(
    mockRequire,
    processMock,
    '/fixture',
  )

  t.is(workerOptions?.env, processMock.env)
  t.deepEqual(processMock.execArgv, originalExecArgv)
  t.deepEqual(workerOptions?.execArgv, [
    '--trace-warnings',
    '--require',
    './hook.cjs',
    '--print-bytecode',
    '--conditions=worker-test',
  ])
})

test('threaded WASI node workers retry without Worker-invalid execArgv', (t) => {
  const code = createWasiBinding('test', '@scope/test', 1, 2)
  const workerExecArgvAttempts: string[][] = []

  class Worker {
    constructor(
      _filename: string,
      options: {
        execArgv?: string[]
      },
    ) {
      const execArgv = options.execArgv ?? []
      workerExecArgvAttempts.push(execArgv)
      if (execArgv.includes('--title=test-worker')) {
        const error = new Error('invalid worker arguments') as Error & {
          code: string
        }
        error.code = 'ERR_WORKER_INVALID_EXEC_ARGV'
        throw error
      }
    }

    unref() {}
  }

  const mockRequire = (specifier: string) => {
    switch (specifier) {
      case 'node:fs':
        return {
          existsSync: (path: string) => path.endsWith('/test.wasm'),
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
        return { Worker }
      case '@napi-rs/wasm-runtime':
        return {
          createOnMessage: () => () => {},
          instantiateNapiModuleSync(
            _wasm: Uint8Array,
            options: { onCreateWorker(): Worker },
          ) {
            options.onCreateWorker()
            return {
              instance: {},
              module: {},
              napiModule: { exports: {} },
            }
          },
        }
      case '@emnapi/runtime':
        return {
          createContext: () => ({
            destroy() {},
            suppressDestroy() {},
          }),
        }
      default:
        throw new Error(`Unexpected require: ${specifier}`)
    }
  }
  const processMock = {
    cwd: () => '/',
    env: {},
    execArgv: ['--title=test-worker', '--require', './hook.cjs'],
    once() {},
    rawListeners() {
      return []
    },
    removeListener() {},
  }

  new Function('require', 'process', '__dirname', code)(
    mockRequire,
    processMock,
    '/fixture',
  )

  t.deepEqual(workerExecArgvAttempts, [
    ['--title=test-worker', '--require', './hook.cjs'],
    [],
  ])
})

test.serial(
  'threaded WASI node initialization rollback terminates every created worker exactly once',
  async (t) => {
    const code = createWasiBinding('test', '@scope/test', 1, 2)
    const liveWorkers = new Set<Worker>()
    const workers: Worker[] = []
    const terminationPromises: Promise<number>[] = []
    const events: string[] = []
    let contexts = 0
    let activeContext = 0
    let initializationError: Error

    class Worker {
      readonly id = workers.length + 1
      readonly context = activeContext
      terminateCalls = 0

      constructor() {
        workers.push(this)
        liveWorkers.add(this)
      }

      unref() {}

      terminate() {
        this.terminateCalls += 1
        events.push(`terminate:${this.context}:${this.id}`)
        const termination = new Promise<number>((resolve) => {
          setImmediate(() => {
            liveWorkers.delete(this)
            events.push(`terminated:${this.context}:${this.id}`)
            resolve(0)
          })
        })
        terminationPromises.push(termination)
        return termination
      }
    }

    const mockRequire = (specifier: string) => {
      switch (specifier) {
        case 'node:fs':
          return {
            existsSync: (path: string) => path.endsWith('/test.wasm'),
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
          return { Worker }
        case '@napi-rs/wasm-runtime':
          return {
            createOnMessage: () => () => {},
            instantiateNapiModuleSync(
              _wasm: Uint8Array,
              options: {
                context: { id: number }
                onCreateWorker(): Worker
              },
            ) {
              activeContext = options.context.id
              options.onCreateWorker()
              options.onCreateWorker()
              options.onCreateWorker()
              throw initializationError
            },
          }
        case '@emnapi/runtime':
          return {
            createContext: () => {
              const id = ++contexts
              return {
                id,
                suppressDestroy() {},
                destroy() {
                  events.push(`destroy:${id}`)
                },
              }
            },
          }
        default:
          throw new Error(`Unexpected require: ${specifier}`)
      }
    }
    const processMock = Object.assign(new EventEmitter(), {
      cwd: () => '/',
      env: {},
      execArgv: [],
    })
    const execute = new Function(
      'require',
      'process',
      '__dirname',
      'WebAssembly',
      code,
    )

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      initializationError = new Error(`initialization failed: ${attempt}`)
      const eventOffset = events.length
      const terminationOffset = terminationPromises.length
      const workerOffset = workers.length
      let observed
      try {
        execute(mockRequire, processMock, '/fixture', {
          Memory: class {},
        })
      } catch (error) {
        observed = error
      }

      t.is(observed, initializationError)
      t.deepEqual(events.slice(eventOffset, eventOffset + 4), [
        `terminate:${attempt}:${workerOffset + 1}`,
        `terminate:${attempt}:${workerOffset + 2}`,
        `terminate:${attempt}:${workerOffset + 3}`,
        `destroy:${attempt}`,
      ])
      await Promise.all(terminationPromises.slice(terminationOffset))
      t.is(liveWorkers.size, 0)
      t.true(
        workers
          .slice(workerOffset)
          .every((worker) => worker.terminateCalls === 1),
      )
      t.is(processMock.rawListeners('beforeExit').length, 0)
      t.is(processMock.rawListeners('exit').length, 0)
    }

    t.is(contexts, 3)
    t.is(workers.length, 9)
    t.is(terminationPromises.length, 9)
    t.true(workers.every((worker) => worker.terminateCalls === 1))
  },
)

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
            instantiateNapiModuleSync() {
              return {
                instance: {},
                module: {},
                napiModule: { exports: {} },
              }
            },
          }
        case '@emnapi/runtime':
          return {
            createContext() {
              return {
                destroy() {},
                suppressDestroy() {},
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
  execute(
    mockRequire,
    {
      cwd: () => '/',
      env: {},
      once() {},
      rawListeners() {
        return []
      },
      removeListener() {},
    },
    '/root',
  )
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
  const bufferedSrc = createWasiDeferredBrowserBinding(
    'custom_async_runtime',
    1024,
    65536,
    true,
  )
  // workerd bans: I/O in global scope, compile-from-bytes
  t.false(src.includes('await fetch'))
  t.false(src.includes('arrayBuffer'))
  // The wasm imports `env.memory` (built with `--import-memory`), so a
  // Memory allocation is required — but only in function scope
  // (workerd-legal), never in global scope.
  const instanceFactoryOffset = src.indexOf('async function __createInstance')
  t.true(instanceFactoryOffset > 0)
  const topLevel = src.slice(0, instanceFactoryOffset)
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
  t.true(src.includes('__emnapiContext.suppressDestroy()'))
  t.true(src.includes('__captureEmnapiAutoDestroyListener'))
  t.true(src.includes('__managedEmnapiContextDestroyers'))
  t.regex(
    src,
    /__managedCleanupProcess\.once\(\s*'beforeExit',\s*__destroyManagedEmnapiContextsBeforeExit,\s*\)/,
  )
  t.false(src.includes('Promise.resolve().then(__destroy)'))
  t.false(/\.once\(\s*['"]exit['"]/.test(src))
  t.false(src.includes("__process.rawListeners('beforeExit')"))
  t.false(src.includes('__removeAddedBeforeExitListeners'))
  t.false(src.includes("import { Buffer } from 'buffer'"))
  t.false(src.includes('__emnapiContext.feature.Buffer = Buffer'))
  t.true(bufferedSrc.includes("import { Buffer } from 'buffer'"))
  t.true(bufferedSrc.includes('__emnapiContext.feature.Buffer = Buffer'))
  t.false(
    src.includes(
      "__process.once('beforeExit', __destroyManagedEmnapiContexts)",
    ),
  )
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

test.serial(
  'eager WASI Node loaders invoke synchronous context cleanup at process exit',
  async (t) => {
    const nodeSrc = `${createWasiBinding(
      'binding',
      'exit-fixture-never-published',
      1,
      2,
      false,
      'wasm32-wasip1',
    )}
module.exports = __napiModule.exports
`
    const deferredSrc = createWasiDeferredBrowserBinding(
      'custom_async_runtime',
      1,
      2,
    )

    t.true(nodeSrc.includes('beforeExit'))
    t.true(
      nodeSrc.includes("process.once('exit', __destroyEmnapiContextAtExit)"),
    )
    t.false(/\.once\(\s*['"]exit['"]/.test(deferredSrc))

    const tmpDir = await mkdtemp(
      join(fileURLToPath(new URL('.', import.meta.url)), '.tmp-exit-cleanup-'),
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
          main: './index.cjs',
        }),
      )
      await writeFile(
        join(runtimeDir, 'index.cjs'),
        `module.exports = {
  instantiateNapiModuleSync() {
    return {
      instance: {},
      module: {},
      napiModule: { exports: {} },
    }
  },
}
`,
      )
      const emnapiContext = `function createContext(options) {
  if (options?.autoDestroy !== false) {
    throw new Error('generated loader must disable emnapi auto-destroy')
  }
  return {
    suppressDestroy() {},
    destroy() {
      process.stdout.write('terminal-cleanup\\n')
    },
  }
}
`
      await writeFile(
        join(emnapiRuntimeDir, 'package.json'),
        JSON.stringify({
          name: '@emnapi/runtime',
          main: './index.cjs',
        }),
      )
      await writeFile(
        join(emnapiRuntimeDir, 'index.cjs'),
        `${emnapiContext}
module.exports = { createContext }
`,
      )
      await writeFile(join(tmpDir, 'binding.cjs'), nodeSrc)
      await writeFile(join(tmpDir, 'binding.wasm'), '')
      await writeFile(
        join(tmpDir, 'exit.cjs'),
        `require('./binding.cjs')
process.exit(0)
`,
      )

      const result = await execFileAsync(
        process.execPath,
        ['--unhandled-rejections=strict', join(tmpDir, 'exit.cjs')],
        { cwd: tmpDir, timeout: 2_000 },
      )
      t.is(result.stdout, 'terminal-cleanup\n')
    } finally {
      await rm(tmpDir, { recursive: true, force: true })
    }
  },
)

test.serial(
  'successful eager WASI contexts stay live while deferred rollback cleanup retries on beforeExit',
  async (t) => {
    const nodeSrc = `${createWasiBinding(
      'binding',
      'before-exit-retry-never-published',
      1,
      2,
      false,
      'wasm32-wasip1',
    )}
module.exports = __napiModule.exports
`
    const deferredSrc = createWasiDeferredBrowserBinding(
      'custom_async_runtime',
      1,
      2,
    )
    const tmpDir = await mkdtemp(
      join(
        fileURLToPath(new URL('.', import.meta.url)),
        '.tmp-before-exit-retry-',
      ),
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
          exports: {
            '.': {
              import: './index.mjs',
              require: './index.cjs',
            },
          },
        }),
      )
      await writeFile(
        join(runtimeDir, 'index.cjs'),
        `module.exports = {
  instantiateNapiModuleSync() {
    return {
      instance: {},
      module: {},
      napiModule: { exports: {} },
    }
  },
}
`,
      )
      await writeFile(
        join(runtimeDir, 'index.mjs'),
        `export class WASI {}
export async function instantiateNapiModule() {
  const state = globalThis.__beforeExitRetryState
  if (state?.initializationError) {
    throw state.initializationError
  }
  return { napiModule: { exports: {} } }
}
`,
      )
      const emnapiContext = `function createContext(options) {
  if (options?.autoDestroy !== false) {
    throw new Error('generated loader must disable emnapi auto-destroy')
  }
  return {
    suppressDestroy() {},
    destroy() {
      const state = globalThis.__beforeExitRetryState
      state.attempts += 1
      if (state.attempts === 1) {
        const error = new Error(state.errorMessage)
        if (state.async) {
          return Promise.reject(error)
        }
        throw error
      }
      state.destroyed += 1
      if (state.async) {
        return Promise.resolve()
      }
    },
  }
}
`
      await writeFile(
        join(emnapiRuntimeDir, 'package.json'),
        JSON.stringify({
          name: '@emnapi/runtime',
          exports: {
            '.': {
              import: './index.mjs',
              require: './index.cjs',
            },
          },
        }),
      )
      await writeFile(
        join(emnapiRuntimeDir, 'index.cjs'),
        `${emnapiContext}
module.exports = { createContext }
`,
      )
      await writeFile(
        join(emnapiRuntimeDir, 'index.mjs'),
        `${emnapiContext}
export { createContext }
`,
      )
      await writeFile(join(tmpDir, 'binding.cjs'), nodeSrc)
      await writeFile(join(tmpDir, 'binding.wasm'), '')
      await writeFile(join(tmpDir, 'deferred.mjs'), deferredSrc)
      await writeFile(
        join(tmpDir, 'retry.cjs'),
        `globalThis.__beforeExitRetryState = {
  async: false,
  attempts: 0,
  caught: 0,
  destroyed: 0,
  errorMessage: 'ordinary cleanup failed',
  unexpected: [],
}
const state = globalThis.__beforeExitRetryState
process.on('uncaughtException', (error) => {
  if (error?.message === state.errorMessage) {
    state.caught += 1
  } else {
    state.unexpected.push(String(error?.stack || error))
  }
  setImmediate(() => {})
})
require('./binding.cjs')
process.once('exit', () => {
  if (
    state.attempts !== 1 ||
    state.destroyed !== 0 ||
    state.caught !== 0 ||
    state.unexpected.length !== 0
  ) {
    process.stderr.write('ordinary terminal state: ' + JSON.stringify(state) + '\\n')
    process.exitCode = 1
    return
  }
  process.stdout.write('ordinary-terminal-attempt-ok\\n')
})
`,
      )
      await writeFile(
        join(tmpDir, 'retry.mjs'),
        `globalThis.__beforeExitRetryState = {
  async: true,
  attempts: 0,
  caught: 0,
  destroyed: 0,
  errorMessage: 'deferred cleanup failed',
  initializationError: new Error('deferred initialization failed'),
  unexpected: [],
}
const state = globalThis.__beforeExitRetryState
process.on('uncaughtException', (error) => {
  if (error?.message === state.errorMessage) {
    state.caught += 1
  } else {
    state.unexpected.push(String(error?.stack || error))
  }
  setImmediate(() => {})
})
process.once('exit', () => {
  if (
    state.attempts !== 2 ||
    state.destroyed !== 1 ||
    state.caught !== 0 ||
    state.unexpected.length !== 0
  ) {
    process.stderr.write('deferred retry state: ' + JSON.stringify(state) + '\\n')
    process.exitCode = 1
    return
  }
  process.stdout.write('deferred-retry-ok\\n')
})
const { instantiate } = await import('./deferred.mjs')
const module = new WebAssembly.Module(
  new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]),
)
try {
  await instantiate(module)
  throw new Error('deferred initialization unexpectedly succeeded')
} catch (error) {
  if (
    error !== state.initializationError ||
    error.cause?.message !== state.errorMessage
  ) {
    throw error
  }
}
`,
      )

      const results = await Promise.all(
        ['retry.cjs', 'retry.mjs'].map((entry) =>
          execFileAsync(
            process.execPath,
            ['--unhandled-rejections=strict', join(tmpDir, entry)],
            { cwd: tmpDir, timeout: 10_000 },
          ),
        ),
      )
      t.deepEqual(
        results.map((result) => result.stdout),
        ['ordinary-terminal-attempt-ok\n', 'deferred-retry-ok\n'],
      )
    } finally {
      await rm(tmpDir, { recursive: true, force: true })
    }
  },
)

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
  t.true(memoryOffset < contextOffset)
  t.true(src.includes('Failed to fetch WASI module'))
})

for (const { name, asyncInit } of [
  { name: 'synchronous', asyncInit: false },
  { name: 'asynchronous', asyncInit: true },
]) {
  test.serial(
    `browser WASI binding rolls back contexts after ${name} initialization failures`,
    async (t) => {
      const tmpDir = await mkdtemp(
        join(
          fileURLToPath(new URL('.', import.meta.url)),
          `.tmp-browser-rollback-${asyncInit ? 'async' : 'sync'}-`,
        ),
      )
      const browserBinding = createWasiBrowserBinding(
        'binding',
        1,
        2,
        false,
        asyncInit,
        false,
        false,
        false,
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

function failInitialization(options) {
  const state = globalThis.__browserWasiRollbackState
  state.contexts.push(options.context)
  throw state.initializationError
}

export function instantiateNapiModuleSync(_wasm, options) {
  return failInitialization(options)
}

export async function instantiateNapiModule(_wasm, options) {
  await Promise.resolve()
  return failInitialization(options)
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
          `export function createContext() {
  const state = globalThis.__browserWasiRollbackState
  state.created += 1
  return {
    destroy() {
      state.destroyAttempts += 1
      if (state.cleanupError) {
        throw state.cleanupError
      }
      state.destroyed += 1
    },
  }
}
`,
        )
        await writeFile(join(tmpDir, 'binding.mjs'), browserBinding)
        await writeFile(
          join(tmpDir, 'test.mjs'),
          `import assert from 'node:assert/strict'

globalThis.fetch = async () => ({
  ok: true,
  arrayBuffer: async () => new ArrayBuffer(0),
})

const state = {
  contexts: [],
  created: 0,
  destroyAttempts: 0,
  destroyed: 0,
  cleanupError: undefined,
  initializationError: undefined,
}
globalThis.__browserWasiRollbackState = state

async function load(query) {
  try {
    await import('./binding.mjs?' + query)
  } catch (error) {
    return error
  }
  assert.fail('browser WASI loader unexpectedly initialized')
}

const initializationError = Object.freeze(new Error('initialization failed'))
state.initializationError = initializationError
const observedInitializationError = await load('initialization')
assert.strictEqual(observedInitializationError, initializationError)
assert.strictEqual(
  Object.prototype.hasOwnProperty.call(initializationError, 'cause'),
  false,
)
assert.strictEqual(state.destroyAttempts, 1)
assert.strictEqual(state.destroyed, 1)

const cleanupInitializationError = Object.freeze(
  new Error('initialization failed before cleanup'),
)
const cleanupError = Object.freeze(new Error('cleanup failed'))
state.initializationError = cleanupInitializationError
state.cleanupError = cleanupError
const observedCleanupError = await load('cleanup')
assert.ok(observedCleanupError instanceof AggregateError)
assert.strictEqual(
  observedCleanupError.message,
  cleanupInitializationError.message,
)
assert.strictEqual(observedCleanupError.cause, cleanupInitializationError)
assert.deepStrictEqual(observedCleanupError.errors, [
  cleanupInitializationError,
  cleanupError,
])
assert.strictEqual(
  Object.prototype.hasOwnProperty.call(cleanupInitializationError, 'cause'),
  false,
)
assert.strictEqual(
  Object.prototype.hasOwnProperty.call(cleanupError, 'cause'),
  false,
)
assert.strictEqual(state.created, 2)
assert.strictEqual(state.contexts.length, 2)
assert.strictEqual(state.destroyAttempts, 2)
assert.strictEqual(state.destroyed, 1)
process.stdout.write('rollback-ok\\n')
`,
        )

        const result = await execFileAsync(
          process.execPath,
          ['--unhandled-rejections=strict', join(tmpDir, 'test.mjs')],
          { cwd: tmpDir, timeout: 10_000 },
        )
        t.is(result.stdout, 'rollback-ok\n')
      } finally {
        await rm(tmpDir, { recursive: true, force: true })
      }
    },
  )
}

test.serial(
  'deferred WASI Buffer injection failures roll back contexts',
  async (t) => {
    const src = createWasiDeferredBrowserBinding(
      'custom_async_runtime',
      1,
      2,
      true,
    )
    const tmpDir = await mkdtemp(
      join(
        fileURLToPath(new URL('.', import.meta.url)),
        '.tmp-buffer-rollback-',
      ),
    )
    const initialBeforeExitListeners = new Set(
      process.rawListeners('beforeExit'),
    )
    const state = {
      cleanupError: undefined as Error | undefined,
      contexts: 0,
      destroyAttempts: [] as number[],
      destroyed: [] as number[],
      injectionError: new Error('Buffer injection failed'),
      instantiations: 0,
    }
    ;(globalThis as any).__napiDeferredBufferState = state

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
  globalThis.__napiDeferredBufferState.instantiations += 1
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
        `export function createContext(options) {
  if (options?.autoDestroy !== false) {
    throw new Error('deferred loader must disable emnapi auto-destroy')
  }
  const state = globalThis.__napiDeferredBufferState
  const id = ++state.contexts
  process.once('beforeExit', () => {})
  const feature = {}
  Object.defineProperty(feature, 'Buffer', {
    set() {
      throw state.injectionError
    },
  })
  return {
    feature,
    suppressDestroy() {},
    destroy() {
      state.destroyAttempts.push(id)
      if (state.cleanupError) {
        throw state.cleanupError
      }
      state.destroyed.push(id)
    },
  }
}
`,
      )

      const loaderPath = join(tmpDir, 'deferred.mjs')
      await writeFile(loaderPath, src)
      const { createInstance, instantiate } = await import(
        pathToFileURL(loaderPath).href
      )
      const module = new WebAssembly.Module(
        new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]),
      )
      const getOwnedBeforeExitListeners = () =>
        process
          .rawListeners('beforeExit')
          .filter((listener) => !initialBeforeExitListeners.has(listener))

      t.is(
        await t.throwsAsync(() => createInstance(module)),
        state.injectionError,
      )
      t.deepEqual(state.destroyAttempts, [1])
      t.deepEqual(state.destroyed, [1])
      t.is(state.instantiations, 0)
      t.is(getOwnedBeforeExitListeners().length, 0)

      const cleanupError = new Error('Buffer rollback failed')
      state.cleanupError = cleanupError
      const failedRollback = await t.throwsAsync(() => instantiate(module))
      t.is(failedRollback, state.injectionError)
      t.is(failedRollback.cause, cleanupError)
      t.deepEqual(state.destroyAttempts, [1, 2])
      t.deepEqual(state.destroyed, [1])
      t.is(state.instantiations, 0)
      const retainedBeforeExitListeners = getOwnedBeforeExitListeners()
      t.is(retainedBeforeExitListeners.length, 1)

      state.cleanupError = undefined
      retainedBeforeExitListeners[0](0)
      await new Promise((resolve) => setImmediate(resolve))
      t.deepEqual(state.destroyAttempts, [1, 2, 2])
      t.deepEqual(state.destroyed, [1, 2])
      t.is(getOwnedBeforeExitListeners().length, 0)
    } finally {
      for (const listener of process.rawListeners('beforeExit')) {
        if (!initialBeforeExitListeners.has(listener)) {
          process.removeListener('beforeExit', listener)
        }
      }
      delete (globalThis as any).__napiDeferredBufferState
      await rm(tmpDir, { recursive: true, force: true })
    }
  },
)

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
    suppressDestroy() {},
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
  'deferred WASI beforeExit owns cleanup errors, not pending initialization errors',
  async (t) => {
    const src = createWasiDeferredBrowserBinding('custom_async_runtime', 1, 2)
    const tmpDir = await mkdtemp(
      join(
        fileURLToPath(new URL('.', import.meta.url)),
        '.tmp-before-exit-failure-',
      ),
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
  const state = globalThis.__napiDeferredFailureState
  state.initializationStarted = true
  await state.initializationGate
  throw state.initializationError
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
    suppressDestroy() {},
    destroy() {
      const state = globalThis.__napiDeferredFailureState
      state.destroyAttempts++
      const error = state.cleanupErrors.shift()
      if (error) {
        return Promise.reject(error)
      }
      state.destroyed++
      return Promise.resolve()
    },
  }
}
`,
      )
      await writeFile(join(tmpDir, 'deferred.mjs'), src)
      await writeFile(
        join(tmpDir, 'failure.mjs'),
        `import assert from 'node:assert/strict'

const mode = process.argv[2]
const initialBeforeExitListeners = new Set(process.rawListeners('beforeExit'))
const initializationError = new Error('pending initialization failed')
const firstCleanupError = new Error('initial rollback failed')
const secondCleanupError = new Error('managed cleanup failed')
let releaseInitialization
const state = {
  cleanupErrors:
    mode === 'cleanup-failure'
      ? [firstCleanupError, secondCleanupError]
      : [],
  destroyAttempts: 0,
  destroyed: 0,
  initializationError,
  initializationGate: new Promise((resolve) => {
    releaseInitialization = resolve
  }),
  initializationStarted: false,
}
globalThis.__napiDeferredFailureState = state

const { instantiate } = await import('./deferred.mjs')
const module = new WebAssembly.Module(
  new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]),
)
const pending = instantiate(module)
while (!state.initializationStarted) {
  await Promise.resolve()
}
const ownedBeforeExitListeners = process
  .rawListeners('beforeExit')
  .filter((listener) => !initialBeforeExitListeners.has(listener))
assert.equal(ownedBeforeExitListeners.length, 1)

let uncaughtCleanup
if (mode === 'cleanup-failure') {
  process.once('uncaughtException', (error) => {
    uncaughtCleanup = error
  })
}
ownedBeforeExitListeners[0](0)
releaseInitialization()

await assert.rejects(pending, (error) => {
  assert.strictEqual(error, initializationError)
  assert.strictEqual(
    error.cause,
    mode === 'cleanup-failure' ? firstCleanupError : undefined,
  )
  return true
})
await new Promise((resolve) => setImmediate(resolve))

if (mode === 'cleanup-failure') {
  assert.strictEqual(uncaughtCleanup, secondCleanupError)
  assert.equal(state.destroyAttempts, 2)
  assert.equal(state.destroyed, 0)
  process.stdout.write('managed-cleanup-failure-ok\\n')
} else {
  assert.strictEqual(uncaughtCleanup, undefined)
  assert.equal(state.destroyAttempts, 1)
  assert.equal(state.destroyed, 1)
  process.stdout.write('initialization-failure-contained\\n')
}
`,
      )

      const results = await Promise.all(
        ['cleanup-success', 'cleanup-failure'].map((mode) =>
          execFileAsync(
            process.execPath,
            [
              '--unhandled-rejections=strict',
              join(tmpDir, 'failure.mjs'),
              mode,
            ],
            { cwd: tmpDir, timeout: 10_000 },
          ),
        ),
      )
      t.deepEqual(
        results.map((result) => result.stdout),
        ['initialization-failure-contained\n', 'managed-cleanup-failure-ok\n'],
      )
    } finally {
      await rm(tmpDir, { recursive: true, force: true })
    }
  },
)

test.serial(
  'deferred WASI retries cleanup ownership after listener registration and rollback fail',
  async (t) => {
    const src = createWasiDeferredBrowserBinding('custom_async_runtime', 1, 2)
    const tmpDir = await mkdtemp(
      join(
        fileURLToPath(new URL('.', import.meta.url)),
        '.tmp-registration-retry-',
      ),
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
  const state = globalThis.__napiRegistrationRetryState
  if (state.initializeSuccessfully) {
    return { napiModule: { exports: {} } }
  }
  throw state.initializationError
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
    suppressDestroy() {},
    destroy() {
      const state = globalThis.__napiRegistrationRetryState
      state.destroyAttempts++
      const reentrantDispose = state.reentrantDispose
      state.reentrantDispose = undefined
      const reentrantResult = reentrantDispose?.()
      if (state.destroyAttempts <= state.cleanupFailures) {
        return Promise.reject(state.cleanupError)
      }
      const finish = () => {
        state.destroyed++
      }
      const dependencies = []
      if (state.returnReentrantDispose && reentrantResult) {
        dependencies.push(reentrantResult)
      }
      if (state.cleanupGate) {
        dependencies.push(state.cleanupGate)
      }
      if (dependencies.length > 0) {
        return Promise.all(dependencies).then(finish)
      }
      finish()
      return Promise.resolve()
    },
  }
}
`,
      )
      await writeFile(join(tmpDir, 'deferred.mjs'), src)
      await writeFile(
        join(tmpDir, 'retry.mjs'),
        `import assert from 'node:assert/strict'

const mode = process.argv[2]
const initialBeforeExitListeners = new Set(process.rawListeners('beforeExit'))
const initializationError = new Error('initialization failed')
const registrationError = new Error('beforeExit registration failed')
const cleanupError = new Error('registration rollback failed')
const state = {
  cleanupFailures: mode === 'singleton' ? 2 : 1,
  cleanupError,
  destroyAttempts: 0,
  destroyed: 0,
  initializationError,
}
globalThis.__napiRegistrationRetryState = state

const { createInstance, instantiate } = await import('./deferred.mjs')
const module = new WebAssembly.Module(
  new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]),
)
function throwOnceOnBeforeExit(event) {
  if (event === 'beforeExit') {
    process.removeListener('newListener', throwOnceOnBeforeExit)
    throw registrationError
  }
}
process.on('newListener', throwOnceOnBeforeExit)
try {
  const pending =
    mode === 'singleton' ? instantiate(module) : createInstance(module)
  await assert.rejects(pending, (error) => {
    if (mode === 'singleton') {
      assert.strictEqual(error, registrationError)
      assert.strictEqual(error.cause, cleanupError)
    } else {
      assert.strictEqual(error, initializationError)
      assert.strictEqual(error.cause, registrationError)
      assert.strictEqual(registrationError.cause, cleanupError)
    }
    return true
  })
} finally {
  process.removeListener('newListener', throwOnceOnBeforeExit)
}

assert.equal(state.destroyAttempts, state.cleanupFailures)
assert.equal(state.destroyed, 0)
const retainedBeforeExitListeners = process
  .rawListeners('beforeExit')
  .filter((listener) => !initialBeforeExitListeners.has(listener))
assert.equal(retainedBeforeExitListeners.length, 1)
retainedBeforeExitListeners[0](0)
await new Promise((resolve) => setImmediate(resolve))
assert.equal(state.destroyAttempts, state.cleanupFailures + 1)
assert.equal(state.destroyed, 1)
assert.equal(
  process
    .rawListeners('beforeExit')
    .filter((listener) => !initialBeforeExitListeners.has(listener)).length,
  0,
)
process.stdout.write(\`\${mode}-registration-retry-ok\\n\`)
`,
      )
      await writeFile(
        join(tmpDir, 'processless.mjs'),
        `import assert from 'node:assert/strict'

const mode = process.argv[2]
const nodeProcess = process
const initializationError = new Error('initialization failed')
const cleanupError = new Error('initial rollback failed')
const state = {
  cleanupError,
  cleanupFailures: 1,
  destroyAttempts: 0,
  destroyed: 0,
  initializationError,
}
globalThis.__napiRegistrationRetryState = state
globalThis.process = undefined

const { createInstance, dispose, instantiate } = await import('./deferred.mjs')
if (mode === 'independent') {
  state.reentrantDispose = dispose
}
const module = new WebAssembly.Module(
  new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]),
)
const pending =
  mode === 'singleton' ? instantiate(module) : createInstance(module)
await assert.rejects(pending, (error) => {
  assert.strictEqual(error, initializationError)
  assert.strictEqual(error.cause, cleanupError)
  return true
})
assert.equal(state.destroyAttempts, 1)
assert.equal(state.destroyed, 0)

let releaseCleanup
state.cleanupGate = new Promise((resolve) => {
  releaseCleanup = resolve
})
state.reentrantDispose = dispose
const cleanup = dispose()
let concurrentSettled = false
const concurrentCleanup = dispose().then(() => {
  concurrentSettled = true
})
await new Promise((resolve) => setImmediate(resolve))
assert.equal(concurrentSettled, false)
releaseCleanup()
await Promise.all([cleanup, concurrentCleanup])
assert.equal(state.destroyAttempts, 2)
assert.equal(state.destroyed, 1)

globalThis.process = nodeProcess
nodeProcess.stdout.write(\`\${mode}-processless-retry-ok\\n\`)
`,
      )
      await writeFile(
        join(tmpDir, 'successful-reentrant.mjs'),
        `import assert from 'node:assert/strict'

const nodeProcess = process
const state = {
  cleanupFailures: 0,
  destroyAttempts: 0,
  destroyed: 0,
  initializeSuccessfully: true,
  returnReentrantDispose: true,
}
globalThis.__napiRegistrationRetryState = state
globalThis.process = undefined

const { dispose, instantiate } = await import('./deferred.mjs')
const module = new WebAssembly.Module(
  new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]),
)
await instantiate(module)
state.reentrantDispose = dispose
await dispose()
assert.equal(state.destroyAttempts, 1)
assert.equal(state.destroyed, 1)

globalThis.process = nodeProcess
nodeProcess.stdout.write('successful-reentrant-dispose-ok\\n')
`,
      )
      await writeFile(
        join(tmpDir, 'independent-reentrant.mjs'),
        `import assert from 'node:assert/strict'

const nodeProcess = process
const state = {
  cleanupFailures: 0,
  destroyAttempts: 0,
  destroyed: 0,
  initializeSuccessfully: true,
  returnReentrantDispose: true,
}
globalThis.__napiRegistrationRetryState = state
globalThis.process = undefined

const { createInstance, dispose, instantiate } = await import('./deferred.mjs')
const module = new WebAssembly.Module(
  new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]),
)
await instantiate(module)
const independent = await createInstance(module)
state.reentrantDispose = dispose
await independent.dispose()
assert.equal(state.destroyAttempts, 2)
assert.equal(state.destroyed, 2)

await dispose()
assert.equal(state.destroyAttempts, 2)
globalThis.process = nodeProcess
nodeProcess.stdout.write('independent-reentrant-dispose-ok\\n')
`,
      )

      const results = await Promise.all(
        ['independent', 'singleton'].map((mode) =>
          execFileAsync(
            process.execPath,
            ['--unhandled-rejections=strict', join(tmpDir, 'retry.mjs'), mode],
            { cwd: tmpDir, timeout: 10_000 },
          ),
        ),
      )
      const processlessResults = await Promise.all(
        ['independent', 'singleton'].map((mode) =>
          execFileAsync(
            process.execPath,
            [
              '--unhandled-rejections=strict',
              join(tmpDir, 'processless.mjs'),
              mode,
            ],
            { cwd: tmpDir, timeout: 10_000 },
          ),
        ),
      )
      const successfulReentrantResult = await execFileAsync(
        process.execPath,
        [
          '--unhandled-rejections=strict',
          join(tmpDir, 'successful-reentrant.mjs'),
        ],
        { cwd: tmpDir, timeout: 10_000 },
      )
      const independentReentrantResult = await execFileAsync(
        process.execPath,
        [
          '--unhandled-rejections=strict',
          join(tmpDir, 'independent-reentrant.mjs'),
        ],
        { cwd: tmpDir, timeout: 10_000 },
      )
      t.deepEqual(
        results.map((result) => result.stdout),
        [
          'independent-registration-retry-ok\n',
          'singleton-registration-retry-ok\n',
        ],
      )
      t.deepEqual(
        processlessResults.map((result) => result.stdout),
        [
          'independent-processless-retry-ok\n',
          'singleton-processless-retry-ok\n',
        ],
      )
      t.is(
        successfulReentrantResult.stdout,
        'successful-reentrant-dispose-ok\n',
      )
      t.is(
        independentReentrantResult.stdout,
        'independent-reentrant-dispose-ok\n',
      )
    } finally {
      await rm(tmpDir, { recursive: true, force: true })
    }
  },
)

test.serial(
  'WASI loaders preserve newListener-owned beforeExit listeners and retained eager exports when work resumes',
  async (t) => {
    const tmpDir = await mkdtemp(
      join(fileURLToPath(new URL('.', import.meta.url)), '.tmp-before-exit-'),
    )
    const nodeBinding = `${createWasiBinding(
      'binding',
      'before-exit-test',
      1,
      2,
      false,
      'wasm32-wasip1',
    )}
module.exports = __napiModule.exports
`
    const deferredBinding = createWasiDeferredBrowserBinding('binding', 1, 2)

    try {
      const wasmRuntimeDir = join(
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
      await mkdir(wasmRuntimeDir, { recursive: true })
      await mkdir(emnapiRuntimeDir, { recursive: true })
      await writeFile(
        join(wasmRuntimeDir, 'package.json'),
        JSON.stringify({
          name: '@napi-rs/wasm-runtime',
          type: 'module',
          exports: {
            import: './index.mjs',
            require: './index.cjs',
          },
        }),
      )
      const contextFactory = `
function createContext(options) {
  if (options?.autoDestroy !== false) {
    throw new Error('generated loader must disable emnapi auto-destroy')
  }
  const context = {
    id: globalThis.__beforeExitTestContexts.length + 1,
    destroyed: false,
    destroyPromise: undefined,
    suppressed: false,
    suppressDestroy() {
      this.suppressed = true
    },
    destroy() {
      if (this.id === 1) {
        if (!this.destroyed) {
          this.destroyed = true
          globalThis.__beforeExitTestDestroyed++
        }
        return
      }
      if (!this.destroyPromise) {
        this.destroyPromise = new Promise((resolve) => {
          setTimeout(resolve, 30)
        }).then(() => {
          if (!this.destroyed) {
            this.destroyed = true
            globalThis.__beforeExitTestDestroyed++
          }
        })
      }
      return this.destroyPromise
    },
  }
  globalThis.__beforeExitTestContexts.push(context)
  // Emulate emnapi 1.11.x ignoring autoDestroy.
  process.once('beforeExit', () => {
    if (!context.suppressed) {
      context.destroy()
    }
  })
  return context
}
`
      await writeFile(
        join(wasmRuntimeDir, 'index.cjs'),
        `${contextFactory}
module.exports = {
  createContext,
  instantiateNapiModuleSync(_module, options) {
    return {
      napiModule: {
        exports: {
          ping() {
            if (options.context.destroyed) throw new Error('context destroyed')
            return 'ordinary'
          },
        },
      },
    }
  },
}
`,
      )
      await writeFile(
        join(wasmRuntimeDir, 'index.mjs'),
        `export class WASI {}
export async function instantiateNapiModule(_module, options) {
  return {
    napiModule: {
      exports: {
        ping() {
          if (options.context.destroyed) throw new Error('context destroyed')
          return 'deferred'
        },
      },
    },
  }
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
        `${contextFactory}
export { createContext }
`,
      )
      await writeFile(join(tmpDir, 'binding.cjs'), nodeBinding)
      await writeFile(join(tmpDir, 'binding.wasm'), '')
      await writeFile(join(tmpDir, 'deferred.mjs'), deferredBinding)
      await writeFile(
        join(tmpDir, 'test.mjs'),
        `import { createRequire } from 'node:module'

globalThis.__beforeExitTestContexts = []
globalThis.__beforeExitTestDestroyed = 0
globalThis.__unrelatedBeforeExitRuns = 0
const initialBeforeExitListeners = process.rawListeners('beforeExit').length
const unrelatedBeforeExitListeners = []
let addingUnrelatedBeforeExitListener = false
const addUnrelatedBeforeExitListener = (event) => {
  if (event !== 'beforeExit' || addingUnrelatedBeforeExitListener) {
    return
  }
  addingUnrelatedBeforeExitListener = true
  const listener = () => {
    globalThis.__unrelatedBeforeExitRuns++
  }
  unrelatedBeforeExitListeners.push(listener)
  process.once('beforeExit', listener)
  addingUnrelatedBeforeExitListener = false
}
process.on('newListener', addUnrelatedBeforeExitListener)
const require = createRequire(import.meta.url)
const ordinary = require('./binding.cjs')
const deferred = await import('./deferred.mjs')
const module = new WebAssembly.Module(
  new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]),
)
const singleton = await deferred.instantiate(module)
const independent = await deferred.createInstance(module)
process.removeListener('newListener', addUnrelatedBeforeExitListener)

const retainedBeforeExitListeners = process.rawListeners('beforeExit')
if (
  retainedBeforeExitListeners.length !==
  initialBeforeExitListeners + unrelatedBeforeExitListeners.length + 1
) {
  throw new Error('generated beforeExit listener count is incorrect')
}
if (unrelatedBeforeExitListeners.length !== 5) {
  throw new Error('newListener hook did not observe every emnapi registration')
}
for (const listener of unrelatedBeforeExitListeners) {
  if (
    !retainedBeforeExitListeners.some(
      (retained) => retained === listener || retained.listener === listener,
    )
  ) {
    throw new Error('generated loader removed an unrelated beforeExit listener')
  }
}
if (globalThis.__beforeExitTestContexts.length !== 3) {
  throw new Error('unexpected context count')
}
if (globalThis.__beforeExitTestContexts.some((context) => !context.suppressed)) {
  throw new Error('generated loader did not suppress emnapi auto-destroy')
}
if (
  ordinary.ping() !== 'ordinary' ||
  singleton.ping() !== 'deferred' ||
  independent.exports.ping() !== 'deferred'
) {
  throw new Error('binding returned an unexpected initial value')
}

const waitForDestroyed = async (expected) => {
  const deadline = Date.now() + 5000
  while (
    globalThis.__beforeExitTestDestroyed !== expected &&
    Date.now() < deadline
  ) {
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  if (globalThis.__beforeExitTestDestroyed !== expected) {
    throw new Error(
      \`timed out waiting for \${expected} destroyed contexts; observed \${globalThis.__beforeExitTestDestroyed}\`,
    )
  }
}

process.once('beforeExit', () => {
  setImmediate(() => {
    void (async () => {
      let replacementSingletonSettled = false
      const replacementSingletonPromise = deferred.instantiate(module)
      void replacementSingletonPromise.then(() => {
        replacementSingletonSettled = true
      })
      await new Promise((resolve) => setTimeout(resolve, 5))
      if (replacementSingletonSettled) {
        throw new Error(
          'overlapping instantiate did not wait for automatic disposal',
        )
      }

      const replacementSingleton = await replacementSingletonPromise
      await waitForDestroyed(1)
      if (!globalThis.__beforeExitTestContexts[1].destroyed) {
        throw new Error('first beforeExit pass did not destroy the singleton')
      }
      if (globalThis.__beforeExitTestContexts[2].destroyed) {
        throw new Error('first beforeExit pass destroyed an independent context')
      }

      const replacementIndependent = await deferred.createInstance(module)
      if (replacementSingleton === singleton) {
        throw new Error('automatic disposal retained the destroyed singleton')
      }
      if (
        ordinary.ping() !== 'ordinary' ||
        independent.exports.ping() !== 'deferred' ||
        replacementSingleton.ping() !== 'deferred' ||
        replacementIndependent.exports.ping() !== 'deferred'
      ) {
        throw new Error('retained or replacement contexts were not usable')
      }
      if (globalThis.__beforeExitTestContexts.length !== 5) {
        throw new Error('replacement contexts were not created')
      }

      process.once('beforeExit', () => {
        void (async () => {
          await waitForDestroyed(2)
          if (!globalThis.__beforeExitTestContexts[3].destroyed) {
            throw new Error(
              'second beforeExit pass did not destroy the replacement singleton',
            )
          }
          if (
            globalThis.__beforeExitTestContexts[2].destroyed ||
            globalThis.__beforeExitTestContexts[4].destroyed
          ) {
            throw new Error('beforeExit destroyed an independent context')
          }
          if (
            independent.exports.ping() !== 'deferred' ||
            replacementIndependent.exports.ping() !== 'deferred'
          ) {
            throw new Error('independent exports were unusable after beforeExit')
          }
          await Promise.all([
            independent.dispose(),
            replacementIndependent.dispose(),
          ])
          await waitForDestroyed(4)
          if (globalThis.__beforeExitTestContexts[0].destroyed) {
            throw new Error('eager context was destroyed while exports remain cached')
          }
          process.stdout.write('cleaned\\n')
        })().catch((error) => {
          setImmediate(() => {
            throw error
          })
        })
      })
      process.stdout.write('resumed\\n')
    })().catch((error) => {
      setImmediate(() => {
        throw error
      })
    })
  })
})
process.once('exit', () => {
  if (
    globalThis.__unrelatedBeforeExitRuns !== 5 ||
    globalThis.__beforeExitTestDestroyed !== 5 ||
    globalThis.__beforeExitTestContexts.some((context) => !context.destroyed)
  ) {
    throw new Error('terminal lifecycle state was incorrect')
  }
})
`,
      )

      const result = await execFileAsync(
        process.execPath,
        ['--unhandled-rejections=strict', join(tmpDir, 'test.mjs')],
        { cwd: tmpDir, timeout: 10_000 },
      )
      t.is(result.stdout, 'resumed\ncleaned\n')
    } finally {
      await rm(tmpDir, { recursive: true, force: true })
    }
  },
)

test.serial(
  'Node WASI binding rolls back contexts after initialization failures',
  async (t) => {
    const tmpDir = await mkdtemp(
      join(fileURLToPath(new URL('.', import.meta.url)), '.tmp-cjs-rollback-'),
    )
    const nodeBinding = `${createWasiBinding(
      'binding',
      'rollback-fixture-never-published',
      1,
      2,
      false,
      'wasm32-wasip1',
    )}
module.exports = __napiModule.exports
`

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
          main: './index.cjs',
        }),
      )
      await writeFile(
        join(runtimeDir, 'index.cjs'),
        `module.exports = {
  instantiateNapiModuleSync() {
    const state = globalThis.__cjsRollbackState
    if (state.initializationError) {
      throw state.initializationError
    }
    return {
      instance: {},
      module: {},
      napiModule: { exports: {} },
    }
  },
}
`,
      )
      await writeFile(
        join(emnapiRuntimeDir, 'package.json'),
        JSON.stringify({
          name: '@emnapi/runtime',
          main: './index.cjs',
        }),
      )
      await writeFile(
        join(emnapiRuntimeDir, 'index.cjs'),
        `module.exports = {
  createContext(options) {
    if (!options || options.autoDestroy !== false) {
      throw new Error('generated loader must disable emnapi auto-destroy')
    }
    const state = globalThis.__cjsRollbackState
    const id = ++state.contexts
    return {
      suppressDestroy() {},
      destroy() {
        state.destroyAttempts.push(id)
        if (state.cleanupError) {
          throw state.cleanupError
        }
        state.destroyed.push(id)
      },
    }
  },
}
`,
      )
      await writeFile(join(tmpDir, 'binding.cjs'), nodeBinding)
      await writeFile(
        join(tmpDir, 'test.cjs'),
        `const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const bindingPath = path.join(__dirname, 'binding.cjs')
const wasmPath = path.join(__dirname, 'binding.wasm')
const initialBeforeExitListeners = new Set(process.rawListeners('beforeExit'))
const state = {
  contexts: 0,
  destroyAttempts: [],
  destroyed: [],
  cleanupError: undefined,
  initializationError: undefined,
}
globalThis.__cjsRollbackState = state

function ownedBeforeExitListeners() {
  return process
    .rawListeners('beforeExit')
    .filter((listener) => !initialBeforeExitListeners.has(listener))
}

function load() {
  delete require.cache[bindingPath]
  return require(bindingPath)
}

function expectPrimaryError(expected, expectedOwnedListeners = 0) {
  let observed
  try {
    load()
  } catch (error) {
    observed = error
  }
  assert.strictEqual(observed, expected)
  assert.strictEqual(
    ownedBeforeExitListeners().length,
    expectedOwnedListeners,
  )
  return observed
}

const registrationError = new Error('beforeExit registration failed')
const registrationCleanupError = new Error('registration cleanup failed')
state.cleanupError = registrationCleanupError
function throwOnceOnBeforeExit(event) {
  if (event === 'beforeExit') {
    process.removeListener('newListener', throwOnceOnBeforeExit)
    throw registrationError
  }
}
process.on('newListener', throwOnceOnBeforeExit)
try {
  const observedRegistrationError = expectPrimaryError(registrationError, 1)
  assert.strictEqual(observedRegistrationError.cause, registrationCleanupError)
} finally {
  process.removeListener('newListener', throwOnceOnBeforeExit)
}
const registrationRetryListeners = ownedBeforeExitListeners()
assert.strictEqual(registrationRetryListeners.length, 1)
state.cleanupError = undefined
registrationRetryListeners[0]()
assert.strictEqual(ownedBeforeExitListeners().length, 0)
assert.deepStrictEqual(state.destroyAttempts, [1, 1])
assert.deepStrictEqual(state.destroyed, [1])

const OriginalMemory = WebAssembly.Memory
const memoryError = new Error('memory allocation failed')
WebAssembly.Memory = class {
  constructor() {
    throw memoryError
  }
}
try {
  expectPrimaryError(memoryError)
} finally {
  WebAssembly.Memory = OriginalMemory
}

const cleanupError = new Error('cleanup failed')
state.cleanupError = cleanupError
let resolutionError
try {
  load()
} catch (error) {
  resolutionError = error
}
assert.strictEqual(resolutionError.code, 'MODULE_NOT_FOUND')
assert.strictEqual(resolutionError.cause, cleanupError)
const retainedBeforeExitListeners = ownedBeforeExitListeners()
assert.strictEqual(retainedBeforeExitListeners.length, 1)
assert.deepStrictEqual(state.destroyAttempts, [1, 1, 2, 3])
assert.deepStrictEqual(state.destroyed, [1, 2])
state.cleanupError = undefined
retainedBeforeExitListeners[0]()
assert.strictEqual(ownedBeforeExitListeners().length, 0)
assert.deepStrictEqual(state.destroyAttempts, [1, 1, 2, 3, 3])
assert.deepStrictEqual(state.destroyed, [1, 2, 3])

fs.writeFileSync(wasmPath, '')
const originalReadFileSync = fs.readFileSync
const readError = new Error('wasm read failed')
fs.readFileSync = function(filename, ...args) {
  if (filename === wasmPath) {
    throw readError
  }
  return originalReadFileSync.call(this, filename, ...args)
}
try {
  expectPrimaryError(readError)
} finally {
  fs.readFileSync = originalReadFileSync
}

const initializationError = new Error('emnapi initialization failed')
state.initializationError = initializationError
expectPrimaryError(initializationError)

assert.strictEqual(state.contexts, 5)
assert.deepStrictEqual(state.destroyAttempts, [1, 1, 2, 3, 3, 4, 5])
assert.deepStrictEqual(state.destroyed, [1, 2, 3, 4, 5])
process.stdout.write('rollback-ok\\n')
`,
      )

      const result = await execFileAsync(
        process.execPath,
        ['--unhandled-rejections=strict', join(tmpDir, 'test.cjs')],
        { cwd: tmpDir, timeout: 10_000 },
      )
      t.is(result.stdout, 'rollback-ok\n')
    } finally {
      await rm(tmpDir, { recursive: true, force: true })
    }
  },
)

test.serial(
  'WASI fallback isolates async rollback and removes cleanup listeners',
  async (t) => {
    const tmpDir = await mkdtemp(
      join(fileURLToPath(new URL('.', import.meta.url)), '.tmp-cjs-fallback-'),
    )
    const createFlavorBinding = (
      wasmFileName: string,
      packageName: string,
      platformArchABI: string,
    ) => `${createWasiBinding(
      wasmFileName,
      packageName,
      1,
      2,
      false,
      platformArchABI,
    )}
module.exports = __napiModule.exports
`

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
          main: './index.cjs',
        }),
      )
      await writeFile(
        join(runtimeDir, 'index.cjs'),
        `module.exports = {
  instantiateNapiModuleSync(_wasm, options) {
    const state = globalThis.__fallbackLifecycleState
    if (state.failedContextIds.has(options.context.id)) {
      throw new Error('flavor initialization failed: ' + options.context.id)
    }
    return {
      napiModule: {
        exports: { runtime: 'fallback-' + options.context.id },
      },
    }
  },
}
`,
      )
      await writeFile(
        join(emnapiRuntimeDir, 'package.json'),
        JSON.stringify({
          name: '@emnapi/runtime',
          main: './index.cjs',
        }),
      )
      await writeFile(
        join(emnapiRuntimeDir, 'index.cjs'),
        `module.exports = {
  createContext(options) {
    if (!options || options.autoDestroy !== false) {
      throw new Error('generated loader must disable emnapi auto-destroy')
    }
    const state = globalThis.__fallbackLifecycleState
    const id = ++state.contexts
    return {
      id,
      suppressDestroy() {},
      destroy() {
        const attempt = (state.destroyAttempts[id] || 0) + 1
        state.destroyAttempts[id] = attempt
        return new Promise((resolve, reject) => {
          setTimeout(() => {
            if (state.rejectFirstCleanupForId === id && attempt === 1) {
              reject(new Error('async cleanup failed: ' + id))
              return
            }
            state.destroyed.push(id)
            resolve()
          }, 20)
        })
      },
    }
  },
}
`,
      )

      for (const prefix of ['success', 'retry']) {
        await Promise.all([
          writeFile(
            join(tmpDir, `${prefix}.wasi.cjs`),
            createFlavorBinding(
              `${prefix}.wasm32-wasi`,
              `${prefix}-fixture`,
              'wasm32-wasi',
            ),
          ),
          writeFile(
            join(tmpDir, `${prefix}.wasip1.cjs`),
            createFlavorBinding(
              `${prefix}.wasm32-wasip1`,
              `${prefix}-fixture`,
              'wasm32-wasip1',
            ),
          ),
          writeFile(join(tmpDir, `${prefix}.wasm32-wasi.wasm`), ''),
          writeFile(join(tmpDir, `${prefix}.wasm32-wasip1.wasm`), ''),
          writeFile(
            join(tmpDir, `${prefix}.cjs`),
            createCjsBinding(
              prefix,
              `${prefix}-fixture`,
              ['runtime'],
              undefined,
              ['wasm32-wasi', 'wasm32-wasip1'],
            ),
          ),
        ])
      }

      await writeFile(
        join(tmpDir, 'test.cjs'),
        `const assert = require('node:assert/strict')
const path = require('node:path')

async function main() {
const initialBeforeExitListeners = new Set(process.rawListeners('beforeExit'))
const state = {
  contexts: 0,
  destroyed: [],
  destroyAttempts: {},
  failedContextIds: new Set([1, 3]),
  rejectFirstCleanupForId: undefined,
}
globalThis.__fallbackLifecycleState = state

const ownedBeforeExitListeners = () =>
  process
    .rawListeners('beforeExit')
    .filter((listener) => !initialBeforeExitListeners.has(listener))
const waitFor = async (condition) => {
  const deadline = Date.now() + 5000
  while (!condition() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  assert.ok(condition(), 'timed out waiting for lifecycle state')
}
const runOwnedBeforeExitPass = async () => {
  for (const listener of ownedBeforeExitListeners()) {
    listener(0)
  }
  await new Promise((resolve) => setImmediate(resolve))
}
const load = (name) => {
  const entry = path.join(__dirname, name + '.cjs')
  delete require.cache[entry]
  return require(entry)
}

process.env.NAPI_RS_FORCE_WASI = 'true'
const success = load('success')
assert.strictEqual(success.runtime, 'fallback-2')
assert.strictEqual(ownedBeforeExitListeners().length, 1)
await waitFor(() => state.destroyed.includes(1))
assert.strictEqual(ownedBeforeExitListeners().length, 0)
assert.deepStrictEqual(state.destroyAttempts, { 1: 1 })

state.rejectFirstCleanupForId = 3
const retry = load('retry')
assert.strictEqual(retry.runtime, 'fallback-4')
await waitFor(() => state.destroyAttempts[3] === 1)
await new Promise((resolve) => setTimeout(resolve, 30))
assert.deepStrictEqual(state.destroyAttempts, { 1: 1, 3: 1 })
assert.strictEqual(ownedBeforeExitListeners().length, 1)

await runOwnedBeforeExitPass()
await waitFor(() => state.destroyed.includes(3))
assert.deepStrictEqual(state.destroyAttempts, { 1: 1, 3: 2 })
assert.strictEqual(ownedBeforeExitListeners().length, 0)
process.stdout.write('fallback-cleanup-ok\\n')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
`,
      )

      const result = await execFileAsync(
        process.execPath,
        ['--unhandled-rejections=strict', join(tmpDir, 'test.cjs')],
        { cwd: tmpDir, timeout: 10_000 },
      )
      t.is(result.stdout, 'fallback-cleanup-ok\n')
    } finally {
      await rm(tmpDir, { recursive: true, force: true })
    }
  },
)

test.serial(
  'deferred WASI binding shares, disposes, isolates, and orders beforeExit initialization',
  async (t) => {
    const src = createWasiDeferredBrowserBinding('custom_async_runtime', 1, 2)
    const tmpDir = await mkdtemp(
      join(fileURLToPath(new URL('.', import.meta.url)), '.tmp-lifecycle-'),
    )
    const state = {
      contexts: 0,
      cleanupErrors: new Map<number, Error>(),
      cleanupGates: new Map<number, Promise<void>>(),
      destroyed: [] as number[],
      destroyAttempts: [] as number[],
      instances: 0,
      initializationError: undefined as Error | undefined,
      initializationGate: undefined as Promise<void> | undefined,
      cleanupError: undefined as Error | undefined,
      contextError: undefined as Error | undefined,
      contextOptions: [] as unknown[],
      liveContexts: new Set<number>(),
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
  const contextId = options.context.id
  return {
    napiModule: {
      exports: {
        id,
        assertLive() {
          if (!state.liveContexts.has(contextId)) {
            throw new Error('dead context')
          }
        },
      },
    },
  }
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
  if (
    typeof process === 'object' &&
    process !== null &&
    typeof process.once === 'function'
  ) {
    process.once('beforeExit', () => {})
  }
  if (state.contextError) {
    throw state.contextError
  }
  const id = ++state.contexts
  state.liveContexts.add(id)
  return {
    id,
    suppressDestroy() {},
    destroy() {
      state.destroyAttempts.push(id)
      // emnapi marks the context as stopping before cleanup hooks run. A
      // throwing hook therefore leaves previously returned exports unusable.
      state.liveContexts.delete(id)
      const cleanupError = state.cleanupErrors.get(id) ?? state.cleanupError
      if (cleanupError) {
        throw cleanupError
      }
      const cleanupGate = state.cleanupGates.get(id)
      if (cleanupGate) {
        state.cleanupGates.delete(id)
        return cleanupGate.then(() => {
          state.destroyed.push(id)
        })
      }
      state.destroyed.push(id)
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
      const runOwnedBeforeExitCleanup = async () => {
        const listeners = process
          .rawListeners('beforeExit')
          .filter((listener) => !initialBeforeExitListeners.has(listener))
        t.is(listeners.length, 1)
        listeners[0](0)
        await new Promise((resolve) => setImmediate(resolve))
      }

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
      t.deepEqual(state.destroyAttempts, [1])
      t.deepEqual(state.destroyed, [])
      t.is(countOwnedBeforeExitListeners(), 1)
      state.initializationError = undefined
      state.cleanupError = undefined
      await runOwnedBeforeExitCleanup()
      t.deepEqual(state.destroyAttempts, [1, 1])
      t.deepEqual(state.destroyed, [1])
      t.is(countOwnedBeforeExitListeners(), 0)

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
      t.is(countOwnedBeforeExitListeners(), 0)
      state.cleanupError = cleanupError
      t.is(
        t.throws(() => independentA.dispose()),
        cleanupError,
      )
      t.is(countOwnedBeforeExitListeners(), 0)
      t.deepEqual(state.destroyAttempts.slice(-1), [3])
      state.cleanupError = undefined
      independentA.dispose()
      independentA.dispose()
      independentB.dispose()
      t.deepEqual(state.destroyed, [1, 2, 3, 4])
      t.deepEqual(state.destroyAttempts.slice(-3), [3, 3, 4])
      t.is(countOwnedBeforeExitListeners(), 0)

      const hostProcess = globalThis.process
      let replacement!: { id: number; assertLive(): void }
      ;(globalThis as any).process = undefined
      try {
        replacement = await instantiate(moduleB)
        t.is(replacement.id, 5)
        t.notThrows(() => replacement.assertLive())
        state.cleanupError = cleanupError
        const failedDispose = dispose()
        const concurrentFailedDispose = dispose()
        const overlappingFailedDispose = instantiate(moduleA)
        t.is(await t.throwsAsync(failedDispose), cleanupError)
        t.is(await t.throwsAsync(concurrentFailedDispose), cleanupError)
        t.is(await t.throwsAsync(overlappingFailedDispose), cleanupError)
        t.deepEqual(state.destroyAttempts.slice(-1), [5])
        t.throws(() => replacement.assertLive(), {
          message: 'dead context',
        })

        // A processless host has no beforeExit hook. Failed cleanup must
        // retain singleton ownership only so cleanup can be retried. The
        // invalidated exports must never be published again.
        t.is(await t.throwsAsync(() => instantiate(moduleB)), cleanupError)
        t.is(state.instances, 5)
        t.deepEqual(state.destroyAttempts.slice(-2), [5, 5])

        state.cleanupError = undefined
        const [recovered, concurrentRecovered] = await Promise.all([
          instantiate(moduleB),
          instantiate(moduleB),
        ])
        t.is(recovered, concurrentRecovered)
        t.not(recovered, replacement)
        t.is(recovered.id, 6)
        t.notThrows(() => recovered.assertLive())
        t.deepEqual(state.destroyAttempts.slice(-3), [5, 5, 5])
        t.is(state.instances, 6)
        t.deepEqual(state.destroyed, [1, 2, 3, 4, 5])
        await dispose()
        t.deepEqual(state.destroyed, [1, 2, 3, 4, 5, 6])
        t.throws(() => recovered.assertLive(), {
          message: 'dead context',
        })
      } finally {
        ;(globalThis as any).process = hostProcess
      }
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
      t.deepEqual(state.destroyed, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
      t.is(countOwnedBeforeExitListeners(), 1)
      state.initializationError = undefined
      state.cleanupError = undefined
      await runOwnedBeforeExitCleanup()
      t.deepEqual(state.destroyed, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
      t.is(countOwnedBeforeExitListeners(), 0)

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
      t.is(countOwnedBeforeExitListeners(), 0)
      for (const instance of concurrentInstances) {
        instance.dispose()
      }
      t.is(countOwnedBeforeExitListeners(), 0)
      t.is(state.destroyed.length, destroyedBeforeConcurrentInstances + 20)

      const destroyedBeforeRepeatedInstances = state.destroyed.length
      for (let i = 0; i < 20; i++) {
        const instance = await createInstance(moduleA)
        t.is(countOwnedBeforeExitListeners(), 0)
        instance.dispose()
        t.is(countOwnedBeforeExitListeners(), 0)
      }
      t.is(state.destroyed.length, destroyedBeforeRepeatedInstances + 20)

      let releaseSingletonInitialization!: () => void
      state.initializationGate = new Promise<void>((resolve) => {
        releaseSingletonInitialization = resolve
      })
      const pendingSingletonInstanceId = state.instances + 1
      const pendingSingletonContextId = state.contexts + 1
      const pendingBeforeExitSingleton = instantiate(moduleA)
      while (state.instances < pendingSingletonInstanceId) {
        await Promise.resolve()
      }
      const [pendingSingletonBeforeExitListener] = process
        .rawListeners('beforeExit')
        .filter((listener) => !initialBeforeExitListeners.has(listener))
      t.truthy(pendingSingletonBeforeExitListener)
      pendingSingletonBeforeExitListener(0)
      t.false(state.destroyed.includes(pendingSingletonContextId))
      const replacementAfterPendingBeforeExit = instantiate(moduleA)
      t.is(state.instances, pendingSingletonInstanceId)
      state.initializationGate = undefined
      releaseSingletonInitialization()
      const initializedDuringBeforeExit = await pendingBeforeExitSingleton
      const replacementAfterBeforeExit = await replacementAfterPendingBeforeExit
      t.is(initializedDuringBeforeExit.id, pendingSingletonInstanceId)
      t.not(replacementAfterBeforeExit, initializedDuringBeforeExit)
      t.true(state.destroyed.includes(pendingSingletonContextId))
      t.false(state.destroyed.includes(pendingSingletonContextId + 1))
      await dispose()
      t.is(countOwnedBeforeExitListeners(), 0)

      await instantiate(moduleA)
      let releaseIndependentInitialization!: () => void
      state.initializationGate = new Promise<void>((resolve) => {
        releaseIndependentInitialization = resolve
      })
      const pendingIndependentInstanceId = state.instances + 1
      const pendingIndependentContextId = state.contexts + 1
      const pendingIndependent = createInstance(moduleB)
      while (state.instances < pendingIndependentInstanceId) {
        await Promise.resolve()
      }
      const [independentBeforeExitListener] = process
        .rawListeners('beforeExit')
        .filter((listener) => !initialBeforeExitListeners.has(listener))
      t.truthy(independentBeforeExitListener)
      independentBeforeExitListener(0)
      t.false(state.destroyed.includes(pendingIndependentContextId))
      const singletonDisposal = dispose()
      state.initializationGate = undefined
      releaseIndependentInitialization()
      await singletonDisposal
      const independentAfterBeforeExit = await pendingIndependent
      t.is(independentAfterBeforeExit.exports.id, pendingIndependentInstanceId)
      t.false(state.destroyed.includes(pendingIndependentContextId))
      t.is(countOwnedBeforeExitListeners(), 0)
      await independentAfterBeforeExit.dispose()
      t.true(state.destroyed.includes(pendingIndependentContextId))

      await instantiate(moduleA)
      const overlappingCleanupContextId = state.contexts
      let releaseOverlappingCleanup!: () => void
      state.cleanupGates.set(
        overlappingCleanupContextId,
        new Promise<void>((resolve) => {
          releaseOverlappingCleanup = resolve
        }),
      )
      const [firstOverlappingBeforeExitListener] = process
        .rawListeners('beforeExit')
        .filter((listener) => !initialBeforeExitListeners.has(listener))
      t.truthy(firstOverlappingBeforeExitListener)
      firstOverlappingBeforeExitListener(0)
      t.false(state.destroyed.includes(overlappingCleanupContextId))
      t.is(countOwnedBeforeExitListeners(), 0)

      const overlappingInitializationError = new Error(
        'overlapping initialization failed',
      )
      state.initializationError = overlappingInitializationError
      const overlappingFailedRollbackContextId = state.contexts + 1
      state.cleanupErrors.set(overlappingFailedRollbackContextId, cleanupError)
      t.is(
        await t.throwsAsync(() => createInstance(moduleB)),
        overlappingInitializationError,
      )
      state.initializationError = undefined
      state.cleanupErrors.delete(overlappingFailedRollbackContextId)
      t.is(countOwnedBeforeExitListeners(), 1)
      t.false(state.destroyed.includes(overlappingFailedRollbackContextId))

      const [secondOverlappingBeforeExitListener] = process
        .rawListeners('beforeExit')
        .filter((listener) => !initialBeforeExitListeners.has(listener))
      t.truthy(secondOverlappingBeforeExitListener)
      secondOverlappingBeforeExitListener(0)
      t.is(countOwnedBeforeExitListeners(), 0)
      t.false(state.destroyed.includes(overlappingFailedRollbackContextId))

      releaseOverlappingCleanup()
      await new Promise((resolve) => setImmediate(resolve))
      t.true(state.destroyed.includes(overlappingCleanupContextId))
      t.false(state.destroyed.includes(overlappingFailedRollbackContextId))
      t.is(countOwnedBeforeExitListeners(), 1)

      await runOwnedBeforeExitCleanup()
      t.true(state.destroyed.includes(overlappingFailedRollbackContextId))
      t.is(new Set(state.destroyed).size, state.contexts)
      t.is(countOwnedBeforeExitListeners(), 0)
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
      t.is(countOwnedBeforeExitListeners(), 0)
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
  t.true(code.includes('const __AggregateError = globalThis.AggregateError'))
  t.false(code.includes('typeof AggregateError'))
})

test('browser WASI worker errors use the available global event realm', (t) => {
  const code = createWasiBrowserBinding(
    'test',
    4000,
    65536,
    false,
    false,
    false,
    true,
  )

  t.false(code.includes('window.dispatchEvent'))
  t.false(code.includes('new CustomEvent('))
  t.true(code.includes('const __CustomEvent = globalThis.CustomEvent'))
  t.true(code.includes("typeof globalThis.dispatchEvent === 'function'"))
  t.true(code.includes('globalThis.dispatchEvent('))
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
        case '@emnapi/runtime':
          return {
            createContext() {
              const context = { suppressDestroy() {} }
              contexts.push(context)
              return context
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
    )(
      require,
      module,
      {
        cwd: () => '/',
        env: {},
        once() {},
        rawListeners() {
          return []
        },
        removeListener() {},
      },
      '/fixture',
      {
        Memory: class {},
      },
    )
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
  t.true(
    browserCode.includes(
      "import { createContext as __emnapiCreateContext } from '@emnapi/runtime'",
    ),
  )
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
  const guardCount = code.match(/if \(!wasiBindingLoaded && \(/g)?.length ?? 0
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

function getCauseMessages(error: Error & { cause?: unknown }): string[] {
  const messages: string[] = []
  let current = error.cause
  while (current instanceof Error) {
    messages.push(current.message)
    current = (current as Error & { cause?: unknown }).cause
  }
  return messages
}

test('js binding advances to the next WASI flavor after a local loader fails initialization', (t) => {
  const code = createCjsBinding('test', '@scope/test', ['sum'], undefined, [
    'wasm32-wasi',
    'wasm32-wasip1',
  ])
  const threadedLocal = './test.wasi.cjs'
  const threadedArtifact = './test.wasm32-wasi.wasm'
  const singleLocal = './test.wasip1.cjs'
  const singleArtifact = './test.wasm32-wasip1.wasm'
  const result = executeGeneratedCjsBinding(
    code,
    new Map([
      [
        threadedLocal,
        () => {
          throw new Error('threaded initialization failed')
        },
      ],
      [singleLocal, () => ({ sum: () => 42 })],
    ]),
    new Set([threadedLocal, threadedArtifact, singleLocal, singleArtifact]),
  )

  t.deepEqual(result.calls, ['fs', threadedLocal, singleLocal])
  t.is((result.exports as { sum: () => number }).sum(), 42)
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

test('js binding defaults to the threaded package when both WASI flavors are installed', (t) => {
  const code = createCjsBinding('test', '@scope/test', ['runtime'], undefined, [
    'wasm32-wasi',
    'wasm32-wasip1',
  ])
  const threadedPackage = '@scope/test-wasm32-wasi'
  const threadlessPackage = '@scope/test-wasm32-wasip1'
  const result = executeGeneratedCjsBinding(
    code,
    new Map([
      [threadedPackage, () => ({ runtime: 'threaded' })],
      [threadlessPackage, () => ({ runtime: 'threadless' })],
    ]),
    new Set([threadedPackage, threadlessPackage]),
  )

  t.is((result.exports as { runtime: string }).runtime, 'threaded')
  t.true(result.calls.includes(threadedPackage))
  t.false(result.calls.includes(threadlessPackage))
})

test('js binding advances after an installed WASI package fails initialization', (t) => {
  const code = createCjsBinding('test', '@scope/test', ['runtime'], undefined, [
    'wasm32-wasi',
    'wasm32-wasip1',
  ])
  const threadedPackage = '@scope/test-wasm32-wasi'
  const threadlessPackage = '@scope/test-wasm32-wasip1'
  const result = executeGeneratedCjsBinding(
    code,
    new Map([
      [
        threadedPackage,
        () => {
          throw new Error('threaded package initialization failed')
        },
      ],
      [threadlessPackage, () => ({ runtime: 'threadless' })],
    ]),
    new Set([threadedPackage, threadlessPackage]),
  )

  t.deepEqual(result.calls, ['fs', threadedPackage, threadlessPackage])
  t.is((result.exports as { runtime: string }).runtime, 'threadless')
})

test('js binding selects the threadless package through the dual-flavor root loader', (t) => {
  const code = createCjsBinding('test', '@scope/test', ['runtime'], undefined, [
    'wasm32-wasi',
    'wasm32-wasip1',
  ])
  const threadedPackage = '@scope/test-wasm32-wasi'
  const threadlessPackage = '@scope/test-wasm32-wasip1'
  const result = executeGeneratedCjsBinding(
    code,
    new Map([
      [threadedPackage, () => ({ runtime: 'threaded' })],
      [threadlessPackage, () => ({ runtime: 'threadless' })],
    ]),
    new Set([threadedPackage, threadlessPackage]),
    new Map(),
    { NAPI_RS_WASI_FLAVOR: 'wasm32-wasip1' },
  )

  t.is((result.exports as { runtime: string }).runtime, 'threadless')
  t.deepEqual(result.calls, ['fs', threadlessPackage])
  t.false(result.resolveCalls.includes('./test.wasi.cjs'))
  t.false(result.resolveCalls.includes(threadedPackage))
})

test('root package selects an installed WASI flavor in a real dual-flavor layout', async (t) => {
  const tempDir = await mkdtemp(join(tmpdir(), 'napi-rs-wasi-flavors-'))
  const rootPackageDir = join(tempDir, 'node_modules', '@scope', 'test')
  const threadedPackageDir = join(
    tempDir,
    'node_modules',
    '@scope',
    'test-wasm32-wasi',
  )
  const threadlessPackageDir = join(
    tempDir,
    'node_modules',
    '@scope',
    'test-wasm32-wasip1',
  )
  const entryPath = join(tempDir, 'consumer.cjs')
  const baseEnv = { ...process.env }
  delete baseEnv.NAPI_RS_FORCE_WASI
  delete baseEnv.NAPI_RS_WASI_FLAVOR

  try {
    await Promise.all([
      mkdir(rootPackageDir, { recursive: true }),
      mkdir(threadedPackageDir, { recursive: true }),
      mkdir(threadlessPackageDir, { recursive: true }),
    ])
    await Promise.all([
      writeFile(
        join(rootPackageDir, 'package.json'),
        JSON.stringify({
          name: '@scope/test',
          version: '1.0.0',
          main: 'index.cjs',
        }),
      ),
      writeFile(
        join(rootPackageDir, 'index.cjs'),
        createCjsBinding('test', '@scope/test', ['runtime'], undefined, [
          'wasm32-wasi',
          'wasm32-wasip1',
        ]),
      ),
      writeFile(
        join(threadedPackageDir, 'package.json'),
        JSON.stringify({
          name: '@scope/test-wasm32-wasi',
          version: '1.0.0',
          main: 'index.cjs',
        }),
      ),
      writeFile(
        join(threadedPackageDir, 'index.cjs'),
        "module.exports = { runtime: 'threaded' }\n",
      ),
      writeFile(
        join(threadlessPackageDir, 'package.json'),
        JSON.stringify({
          name: '@scope/test-wasm32-wasip1',
          version: '1.0.0',
          main: 'index.cjs',
        }),
      ),
      writeFile(
        join(threadlessPackageDir, 'index.cjs'),
        "module.exports = { runtime: 'threadless' }\n",
      ),
      writeFile(
        entryPath,
        "process.stdout.write(require('@scope/test').runtime)\n",
      ),
    ])

    const defaultResult = await execFileAsync(process.execPath, [entryPath], {
      cwd: tempDir,
      env: { ...baseEnv, NAPI_RS_FORCE_WASI: 'true' },
    })
    t.is(defaultResult.stdout, 'threaded')

    const selectedResult = await execFileAsync(process.execPath, [entryPath], {
      cwd: tempDir,
      env: { ...baseEnv, NAPI_RS_WASI_FLAVOR: 'wasm32-wasip1' },
    })
    t.is(selectedResult.stdout, 'threadless')
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

test('js binding rejects an unavailable selected WASI flavor without loading native', (t) => {
  const code = createCjsBinding('test', '@scope/test', ['runtime'], undefined, [
    'wasm32-wasi',
    'wasm32-wasip1',
  ])
  let nativeInitialized = false
  const error = t.throws(() =>
    executeGeneratedCjsBinding(
      code,
      new Map([
        [
          '/native.node',
          () => {
            nativeInitialized = true
            return { runtime: 'native' }
          },
        ],
        ['@scope/test-wasm32-wasi', () => ({ runtime: 'threaded' })],
      ]),
      new Set(['@scope/test-wasm32-wasi']),
      new Map(),
      {
        NAPI_RS_NATIVE_LIBRARY_PATH: '/native.node',
        NAPI_RS_WASI_FLAVOR: 'wasm32-wasip1',
      },
    ),
  )

  t.is(error.message, 'WASI binding for flavor "wasm32-wasip1" not found')
  t.false(nativeInitialized)
})

test('js binding explicit flavor aggregates selected candidate failures only', (t) => {
  const code = createCjsBinding('test', '@scope/test', ['runtime'], undefined, [
    'wasm32-wasi',
    'wasm32-wasip1',
  ])
  const threadedLocal = './test.wasi.cjs'
  const threadlessLocal = './test.wasip1.cjs'
  const threadlessArtifact = './test.wasm32-wasip1.wasm'
  const threadedPackage = '@scope/test-wasm32-wasi'
  const threadlessPackage = '@scope/test-wasm32-wasip1'
  const localError = new Error('threadless local initialization failed')
  const packageRootCause = new Error('threadless package root cause')
  const packageError = Object.assign(
    new Error('threadless package initialization failed'),
    {
      cause: packageRootCause,
    },
  )
  const resolveCalls: string[] = []
  let nativeInitialized = false
  const error = t.throws(() =>
    executeGeneratedCjsBinding(
      code,
      new Map([
        [threadedLocal, () => ({ runtime: 'wrong local flavor' })],
        [
          threadlessLocal,
          () => {
            throw localError
          },
        ],
        [threadedPackage, () => ({ runtime: 'wrong package flavor' })],
        [
          threadlessPackage,
          () => {
            throw packageError
          },
        ],
        [
          '/native.node',
          () => {
            nativeInitialized = true
            return { runtime: 'native' }
          },
        ],
      ]),
      new Set([
        threadedLocal,
        threadlessLocal,
        threadlessArtifact,
        threadedPackage,
        threadlessPackage,
      ]),
      new Map(),
      {
        NAPI_RS_NATIVE_LIBRARY_PATH: '/native.node',
        NAPI_RS_WASI_FLAVOR: 'wasm32-wasip1',
      },
      resolveCalls,
    ),
  ) as Error & { cause?: unknown }

  t.is(error.message, 'WASI binding for flavor "wasm32-wasip1" not found')
  t.deepEqual(getCauseMessages(error), [
    packageError.message,
    localError.message,
  ])
  t.false(resolveCalls.includes(threadedLocal))
  t.false(resolveCalls.includes(threadedPackage))
  t.false(nativeInitialized)
  t.is(packageError.cause, packageRootCause)
  t.false(Object.prototype.hasOwnProperty.call(localError, 'cause'))
})

test('js binding strict WASI mode aggregates every candidate failure before throwing', (t) => {
  const code = createCjsBinding('test', '@scope/test', ['runtime'], undefined, [
    'wasm32-wasi',
    'wasm32-wasip1',
  ])
  const threadedLocal = './test.wasi.cjs'
  const threadedArtifact = './test.wasm32-wasi.wasm'
  const threadlessLocal = './test.wasip1.cjs'
  const threadlessArtifact = './test.wasm32-wasip1.wasm'
  const threadedPackage = '@scope/test-wasm32-wasi'
  const threadlessPackage = '@scope/test-wasm32-wasip1'
  const failures = [
    new Error('threaded local failed'),
    new Error('threadless local failed'),
    new Error('threaded package failed'),
    new Error('threadless package failed'),
  ]
  let nativeInitialized = false
  const error = t.throws(() =>
    executeGeneratedCjsBinding(
      code,
      new Map([
        [
          threadedLocal,
          () => {
            throw failures[0]
          },
        ],
        [
          threadlessLocal,
          () => {
            throw failures[1]
          },
        ],
        [
          threadedPackage,
          () => {
            throw failures[2]
          },
        ],
        [
          threadlessPackage,
          () => {
            throw failures[3]
          },
        ],
        [
          '/native.node',
          () => {
            nativeInitialized = true
            return { runtime: 'native' }
          },
        ],
      ]),
      new Set([
        threadedLocal,
        threadedArtifact,
        threadlessLocal,
        threadlessArtifact,
        threadedPackage,
        threadlessPackage,
      ]),
      new Map(),
      {
        NAPI_RS_FORCE_WASI: 'error',
        NAPI_RS_NATIVE_LIBRARY_PATH: '/native.node',
      },
    ),
  ) as Error & { cause?: unknown }

  t.is(
    error.message,
    'WASI binding not found and NAPI_RS_FORCE_WASI is set to error',
  )
  t.deepEqual(
    getCauseMessages(error),
    failures.map(({ message }) => message).reverse(),
  )
  t.false(nativeInitialized)
})

test('js binding rejects an unknown WASI flavor before binding initialization', (t) => {
  const code = createCjsBinding('test', '@scope/test', ['runtime'], undefined, [
    'wasm32-wasi',
    'wasm32-wasip1',
  ])
  let nativeInitialized = false
  const error = t.throws(() =>
    executeGeneratedCjsBinding(
      code,
      new Map([
        [
          '/native.node',
          () => {
            nativeInitialized = true
            return { runtime: 'native' }
          },
        ],
      ]),
      new Set(),
      new Map(),
      {
        NAPI_RS_NATIVE_LIBRARY_PATH: '/native.node',
        NAPI_RS_WASI_FLAVOR: 'wasm32-unknown',
      },
    ),
  )

  t.is(
    error.message,
    'Unsupported WASI flavor "wasm32-unknown". Available flavors: wasm32-wasi, wasm32-wasip1',
  )
  t.false(nativeInitialized)
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

test('js binding advances after a non-missing WASI resolution failure', (t) => {
  const code = createCjsBinding('test', '@scope/test', ['sum'], undefined, [
    'wasm32-wasi',
    'wasm32-wasip1',
  ])
  const threadedLocal = './test.wasi.cjs'
  const singleLocal = './test.wasip1.cjs'
  const singleArtifact = './test.wasm32-wasip1.wasm'
  const resolveError = Object.assign(
    new Error('invalid threaded package metadata'),
    {
      code: 'ERR_INVALID_PACKAGE_CONFIG',
    },
  )
  const result = executeGeneratedCjsBinding(
    code,
    new Map([[singleLocal, () => ({ sum: () => 42 })]]),
    new Set([singleLocal, singleArtifact]),
    new Map([[threadedLocal, resolveError]]),
  )

  t.false(result.calls.includes(threadedLocal))
  t.true(result.calls.includes(singleLocal))
  t.is((result.exports as { sum: () => number }).sum(), 42)
})

test('js binding advances after an installed package has a broken entry', (t) => {
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
  const result = executeGeneratedCjsBinding(
    code,
    new Map([[singlePackage, () => ({ sum: () => 42 })]]),
    new Set([`${threadedPackage}/package.json`, singlePackage]),
    new Map([[threadedPackage, resolveError]]),
  )

  t.false(result.calls.includes(threadedPackage))
  t.true(result.calls.includes(singlePackage))
  t.is((result.exports as { sum: () => number }).sum(), 42)
})

test('js binding advances after a broken package entry whose package.json is not exported', (t) => {
  const code = createCjsBinding('test', '@scope/test', ['sum'], undefined, [
    'wasm32-wasi',
    'wasm32-wasip1',
  ])
  const threadedPackage = '@scope/test-wasm32-wasi'
  const singlePackage = '@scope/test-wasm32-wasip1'
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
  const result = executeGeneratedCjsBinding(
    code,
    new Map([[singlePackage, () => ({ sum: () => 42 })]]),
    new Set([singlePackage]),
    new Map([
      [threadedPackage, resolveError],
      [`${threadedPackage}/package.json`, packageJsonError],
    ]),
  )

  t.false(result.calls.includes(threadedPackage))
  t.true(result.calls.includes(singlePackage))
  t.is((result.exports as { sum: () => number }).sum(), 42)
})

test('js binding records loader initialization errors without resolving the candidate again', (t) => {
  const code = createCjsBinding('test', '@scope/test', ['sum'], undefined, [
    'wasm32-wasi',
    'wasm32-wasip1',
  ])
  const threadedLocal = './test.wasi.cjs'
  const threadedDebugArtifact = './test.wasm32-wasi.debug.wasm'
  const threadedArtifact = './test.wasm32-wasi.wasm'
  const singleLocal = './test.wasip1.cjs'
  const singleDebugArtifact = './test.wasm32-wasip1.debug.wasm'
  const singleArtifact = './test.wasm32-wasip1.wasm'
  const initializationError = new Error('threaded initialization failed')
  const resolveCalls: string[] = []
  const result = executeGeneratedCjsBinding(
    code,
    new Map([
      [
        threadedLocal,
        () => {
          throw initializationError
        },
      ],
      [singleLocal, () => ({ sum: () => 42 })],
    ]),
    new Set([threadedLocal, threadedArtifact, singleLocal, singleArtifact]),
    new Map(),
    { NAPI_RS_FORCE_WASI: 'true' },
    resolveCalls,
  )

  t.deepEqual(resolveCalls, [
    threadedLocal,
    threadedDebugArtifact,
    threadedArtifact,
    singleLocal,
    singleDebugArtifact,
    singleArtifact,
  ])
  t.is((result.exports as { sum: () => number }).sum(), 42)
})

test('js binding advances after a WASI package version check fails', (t) => {
  const code = createCjsBinding('test', '@scope/test', ['sum'], '1.0.0', [
    'wasm32-wasi',
    'wasm32-wasip1',
  ])
  const threadedPackage = '@scope/test-wasm32-wasi'
  const singlePackage = '@scope/test-wasm32-wasip1'
  let threadedInitialized = false
  const result = executeGeneratedCjsBinding(
    code,
    new Map<string, () => unknown>([
      [
        `${threadedPackage}/package.json`,
        () => ({
          version: '2.0.0',
        }),
      ],
      [
        threadedPackage,
        () => {
          threadedInitialized = true
          return { sum: () => 1 }
        },
      ],
      [
        `${singlePackage}/package.json`,
        () => ({
          version: '1.0.0',
        }),
      ],
      [singlePackage, () => ({ sum: () => 42 })],
    ]),
    new Set([
      threadedPackage,
      `${threadedPackage}/package.json`,
      singlePackage,
      `${singlePackage}/package.json`,
    ]),
    new Map(),
    {
      NAPI_RS_FORCE_WASI: 'true',
      NAPI_RS_ENFORCE_VERSION_CHECK: '1',
    },
  )

  t.false(threadedInitialized)
  t.false(result.calls.includes(threadedPackage))
  t.true(result.calls.includes(singlePackage))
  t.is((result.exports as { sum: () => number }).sum(), 42)
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
  }) as Error & { cause?: unknown }

  const causeMessages = getCauseMessages(error)
  t.is(causeMessages[causeMessages.length - 1], immutableError.message)
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
  const localLoader = './test.wasi.cjs'
  const localArtifact = './test.wasm32-wasi.wasm'
  const installedPackage = '@scope/test-wasm32-wasi'
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
      if (specifier === localLoader) {
        throw new Error('local WASI initialization failed')
      }
      if (specifier === installedPackage) {
        throw new Error('installed WASI initialization failed')
      }
      throw new Error(`Unexpected require: ${specifier}`)
    },
    {
      resolve(specifier: string) {
        if (
          specifier === localLoader ||
          specifier === localArtifact ||
          specifier === installedPackage
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

  t.is(module.exports, nativeBinding)
  t.deepEqual(requiredSpecifiers, [
    'fs',
    localLoader,
    installedPackage,
    '/native.node',
  ])
})

test('createCjsBinding forced WASI preserves ordered load diagnostics without rewriting source causes', (t) => {
  const code = createCjsBinding('test', '@scope/test', [])
  const localLoader = './test.wasi.cjs'
  const localArtifact = './test.wasm32-wasi.wasm'
  const installedPackage = '@scope/test-wasm32-wasi'
  const localError = new Error('local WASI initialization failed')
  const packageRootCause = new Error('installed WASI root cause')
  const packageError = Object.assign(
    new Error('installed WASI initialization failed'),
    {
      cause: packageRootCause,
    },
  )
  const nativeError = new Error('native initialization failed')
  const attempts: string[] = []
  const error = t.throws(() =>
    executeGeneratedCjsBinding(
      code,
      new Map([
        [
          localLoader,
          () => {
            attempts.push(localLoader)
            throw localError
          },
        ],
        [
          installedPackage,
          () => {
            attempts.push(installedPackage)
            throw packageError
          },
        ],
        [
          '/native.node',
          () => {
            attempts.push('/native.node')
            throw nativeError
          },
        ],
      ]),
      new Set([localLoader, localArtifact, installedPackage]),
      new Map(),
      {
        NAPI_RS_FORCE_WASI: 'true',
        NAPI_RS_NATIVE_LIBRARY_PATH: '/native.node',
      },
    ),
  ) as Error & { cause?: unknown }

  t.deepEqual(attempts, [localLoader, installedPackage, '/native.node'])
  t.deepEqual(getCauseMessages(error), [
    nativeError.message,
    packageError.message,
    localError.message,
  ])
  t.is(packageError.cause, packageRootCause)
  t.false(Object.prototype.hasOwnProperty.call(localError, 'cause'))
  t.false(Object.prototype.hasOwnProperty.call(nativeError, 'cause'))
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
