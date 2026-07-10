import ava, { type ExecutionContext } from 'ava'
import { EventEmitter } from 'node:events'
import { parseSync } from 'oxc-parser'

import { createCjsBinding, createEsmBinding } from '../templates/js-binding.js'
import {
  createWasiBinding,
  createWasiBrowserBinding,
} from '../templates/load-wasi-template.js'
import { createWasiBrowserWorkerBinding } from '../templates/wasi-worker-template.js'

const test = ava
const wasiDisposeSymbol = Symbol.for('napi.rs.wasi.dispose')

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

test('createWasiBrowserBinding does not collide with an exported fetch binding', (t) => {
  const code = createWasiBrowserBinding('test')

  t.true(code.includes('await globalThis.fetch(__wasmUrl)'))
  t.false(code.includes('await fetch(__wasmUrl)'))
})

test.serial('WASI main loaders expose isolated public disposal', async (t) => {
  const cleanupEvents: string[] = []
  const workers: Worker[] = []
  let contextCount = 0
  const code = `${createWasiBinding('test', '@scope/test')}
module.exports = __napiModule.exports
`

  class Worker {
    readonly id = workers.length + 1

    constructor() {
      workers.push(this)
    }

    unref() {}

    terminate() {
      cleanupEvents.push(`terminate:${this.id}`)
      return Promise.resolve(0)
    }
  }

  const processMock = Object.assign(new EventEmitter(), {
    cwd: () => '/',
    env: {},
    execArgv: [],
  })

  function load() {
    const module: {
      exports: Record<PropertyKey, unknown>
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
          return { Worker }
        case '@napi-rs/wasm-runtime':
          return {
            createContext(options: { autoDestroy?: boolean }) {
              t.false(options.autoDestroy)
              const id = ++contextCount
              processMock.once('beforeExit', function emnapiAutoDestroy() {
                cleanupEvents.push(`auto-destroy:${id}`)
              })
              const context = {
                suppressDestroy() {
                  cleanupEvents.push(`suppress:${id}`)
                },
                destroy() {
                  cleanupEvents.push(`destroy:${id}`)
                },
              }
              return context
            },
            createOnMessage: () => () => {},
            instantiateNapiModuleSync(
              _wasm: Uint8Array,
              options: {
                beforeInit(input: {
                  instance: {
                    exports: {
                      napi_prepare_wasm_env_cleanup(): void
                    }
                  }
                }): void
                onCreateWorker(): Worker
              },
            ) {
              options.onCreateWorker()
              const id = contextCount
              const instance = {
                exports: {
                  napi_prepare_wasm_env_cleanup() {
                    cleanupEvents.push(`prepare:${id}`)
                  },
                },
              }
              options.beforeInit({ instance })
              return {
                instance,
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
    )(require, module, processMock, '/fixture', {
      Memory: class {},
    })
    return module.exports as {
      add: (left: number, right: number) => number
      [wasiDisposeSymbol]: () => Promise<void>
    }
  }

  const first = load()
  const second = load()

  t.is(first.add(1, 2), 3)
  t.is(second.add(2, 3), 5)
  t.is(typeof first[wasiDisposeSymbol], 'function')
  t.false(Object.keys(first).includes(String(wasiDisposeSymbol)))
  t.is(processMock.rawListeners('beforeExit').length, 0)
  t.is(processMock.rawListeners('exit').length, 2)

  const firstDispose = first[wasiDisposeSymbol]()
  t.is(first[wasiDisposeSymbol](), firstDispose)
  await firstDispose
  t.is(first[wasiDisposeSymbol](), firstDispose)
  t.is(processMock.rawListeners('exit').length, 1)

  await second[wasiDisposeSymbol]()
  t.is(processMock.rawListeners('exit').length, 0)
  t.deepEqual(cleanupEvents, [
    'suppress:1',
    'suppress:2',
    'prepare:1',
    'destroy:1',
    'terminate:1',
    'prepare:2',
    'destroy:2',
    'terminate:2',
  ])

  const browserCode = createWasiBrowserBinding('test')
  t.true(browserCode.includes('createContext as __emnapiCreateContext'))
  t.true(browserCode.includes("Symbol.for('napi.rs.wasi.dispose')"))
  t.true(browserCode.includes('__emnapiContext.suppressDestroy()'))
  t.true(browserCode.includes('__wasiWorkers.add(worker)'))
  t.true(browserCode.includes('napi_prepare_wasm_env_cleanup'))
})

test.serial(
  'WASI public disposal retries incomplete phases without repeating successful cleanup',
  async (t) => {
    const cleanupEvents: string[] = []
    let prepareAttempts = 0
    let destroyAttempts = 0
    let terminateAttempts = 0
    const context = {
      suppressDestroy() {},
      destroy() {
        cleanupEvents.push('destroy')
        destroyAttempts += 1
        if (destroyAttempts === 1) {
          throw new Error('destroy failed')
        }
      },
    }
    class Worker {
      unref() {}

      terminate() {
        cleanupEvents.push('terminate')
        terminateAttempts += 1
        if (terminateAttempts === 1) {
          return Promise.reject(new Error('terminate failed'))
        }
        return Promise.resolve(0)
      }
    }
    const code = `${createWasiBinding('test', '@scope/test')}
module.exports = __napiModule.exports
`
    const module: {
      exports: Record<PropertyKey, unknown>
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
          return { Worker }
        case '@napi-rs/wasm-runtime':
          return {
            createContext: () => context,
            createOnMessage: () => () => {},
            instantiateNapiModuleSync(
              _wasm: Uint8Array,
              options: {
                beforeInit(input: {
                  instance: { exports: Record<string, () => void> }
                }): void
                onCreateWorker(): Worker
              },
            ) {
              options.onCreateWorker()
              const instance = {
                exports: {
                  napi_prepare_wasm_env_cleanup() {
                    cleanupEvents.push('prepare')
                    prepareAttempts += 1
                    if (prepareAttempts === 1) {
                      throw new Error('prepare failed')
                    }
                  },
                },
              }
              options.beforeInit({ instance })
              return {
                instance,
                module: {},
                napiModule: { exports: {} },
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

    new Function(
      'require',
      'module',
      'process',
      '__dirname',
      'WebAssembly',
      code,
    )(require, module, processMock, '/fixture', {
      Memory: class {},
    })

    const binding = module.exports as {
      [wasiDisposeSymbol]: () => Promise<void>
    }
    await t.throwsAsync(binding[wasiDisposeSymbol](), {
      message: 'prepare failed',
    })
    t.deepEqual(cleanupEvents, ['prepare'])

    await t.throwsAsync(binding[wasiDisposeSymbol](), {
      message: 'destroy failed',
    })
    t.deepEqual(cleanupEvents, ['prepare', 'prepare', 'destroy'])

    await t.throwsAsync(binding[wasiDisposeSymbol](), {
      message: 'terminate failed',
    })
    t.deepEqual(cleanupEvents, [
      'prepare',
      'prepare',
      'destroy',
      'destroy',
      'terminate',
    ])

    const successfulDispose = binding[wasiDisposeSymbol]()
    await successfulDispose
    t.is(binding[wasiDisposeSymbol](), successfulDispose)
    t.deepEqual(cleanupEvents, [
      'prepare',
      'prepare',
      'destroy',
      'destroy',
      'terminate',
      'terminate',
    ])
    t.is(prepareAttempts, 2)
    t.is(destroyAttempts, 2)
    t.is(terminateAttempts, 2)
    t.is(processMock.rawListeners('exit').length, 0)
  },
)

test.serial(
  'WASI node initialization rollback destroys the context before terminating workers',
  async (t) => {
    const cleanupEvents: string[] = []
    const initializationError = new Error('initialization failed')
    const terminationPromises: Promise<number>[] = []
    let workerCount = 0

    class Worker {
      readonly id = ++workerCount

      unref() {}

      terminate() {
        cleanupEvents.push(`terminate:${this.id}`)
        const result = Promise.resolve(0)
        terminationPromises.push(result)
        return result
      }
    }

    const code = createWasiBinding('test', '@scope/test')
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
          return { Worker }
        case '@napi-rs/wasm-runtime':
          return {
            createContext: () => ({
              suppressDestroy() {},
              destroy() {
                cleanupEvents.push('destroy')
                return new Promise<void>((resolve) => {
                  setImmediate(() => {
                    cleanupEvents.push('destroyed')
                    resolve()
                  })
                })
              },
            }),
            createOnMessage: () => () => {},
            instantiateNapiModuleSync(
              _wasm: Uint8Array,
              options: {
                beforeInit(input: {
                  instance: { exports: Record<string, () => void> }
                }): void
                onCreateWorker(): Worker
              },
            ) {
              options.onCreateWorker()
              options.onCreateWorker()
              const instance = {
                exports: {
                  napi_prepare_wasm_env_cleanup() {
                    cleanupEvents.push('prepare')
                  },
                },
              }
              options.beforeInit({ instance })
              throw initializationError
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

    let observed
    try {
      new Function('require', 'process', '__dirname', 'WebAssembly', code)(
        require,
        processMock,
        '/fixture',
        { Memory: class {} },
      )
    } catch (error) {
      observed = error
    }

    t.is(observed, initializationError)
    t.deepEqual(cleanupEvents, ['prepare', 'destroy'])
    await new Promise<void>((resolve) => setImmediate(resolve))
    await Promise.all(terminationPromises)
    t.deepEqual(cleanupEvents, [
      'prepare',
      'destroy',
      'destroyed',
      'terminate:1',
      'terminate:2',
    ])
    t.is(processMock.rawListeners('beforeExit').length, 0)
    t.is(processMock.rawListeners('exit').length, 0)
  },
)

test('WASI node initialization preserves and aggregates cleanup failures', (t) => {
  const initializationError = new Error('initialization failed')
  const destroyError = new Error('destroy failed')
  const firstTerminationError = new Error('terminate 1 failed')
  const secondTerminationError = new Error('terminate 2 failed')
  let workerCount = 0

  class Worker {
    readonly id = ++workerCount

    unref() {}

    terminate() {
      throw this.id === 1 ? firstTerminationError : secondTerminationError
    }
  }

  const code = createWasiBinding('test', '@scope/test')
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
        return { Worker }
      case '@napi-rs/wasm-runtime':
        return {
          createContext: () => ({
            suppressDestroy() {},
            destroy() {
              throw destroyError
            },
          }),
          createOnMessage: () => () => {},
          instantiateNapiModuleSync(
            _wasm: Uint8Array,
            options: { onCreateWorker(): Worker },
          ) {
            options.onCreateWorker()
            options.onCreateWorker()
            throw initializationError
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

  const observed = t.throws(() =>
    new Function('require', 'process', '__dirname', 'WebAssembly', code)(
      require,
      processMock,
      '/fixture',
      { Memory: class {} },
    ),
  ) as Error & { cause?: AggregateError }

  t.is(observed, initializationError)
  t.true(observed.cause instanceof AggregateError)
  t.is(observed.cause?.errors[0], destroyError)
  const workerError = observed.cause?.errors[1] as AggregateError
  t.true(workerError instanceof AggregateError)
  t.deepEqual(workerError.errors, [
    firstTerminationError,
    secondTerminationError,
  ])
})

test('WASI node initialization aggregates cleanup failures for frozen primary errors', (t) => {
  const initializationError = Object.freeze(new Error('initialization failed'))
  const cleanupError = new Error('destroy failed')
  const code = createWasiBinding('test', '@scope/test')
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
          createContext: () => ({
            suppressDestroy() {},
            destroy() {
              throw cleanupError
            },
          }),
          createOnMessage: () => () => {},
          instantiateNapiModuleSync() {
            throw initializationError
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

  const observed = t.throws(() =>
    new Function('require', 'process', '__dirname', 'WebAssembly', code)(
      require,
      processMock,
      '/fixture',
      { Memory: class {} },
    ),
  ) as AggregateError

  t.true(observed instanceof AggregateError)
  t.is(observed.cause, initializationError)
  t.deepEqual(observed.errors, [initializationError, cleanupError])
})

test.serial(
  'WASI browser initialization rollback destroys context before workers',
  async (t) => {
    for (const asyncInit of [false, true]) {
      const cleanupEvents: string[] = []
      const initializationError = new Error(
        `browser initialization failed: ${asyncInit}`,
      )
      const runtimeKey = `__napiWasiBrowserRuntime${Number(asyncInit)}`
      const workerKey = `__napiWasiBrowserWorker${Number(asyncInit)}`
      const source = createWasiBrowserBinding('test', 1, 2, false, asyncInit)
        .replace(
          /import \{[\s\S]*?\} from '@napi-rs\/wasm-runtime'/,
          `const {
  createContext: __emnapiCreateContext,
  createOnMessage: __wasmCreateOnMessageForFsProxy,
  ${asyncInit ? 'instantiateNapiModule: __emnapiInstantiateNapiModule' : 'instantiateNapiModuleSync: __emnapiInstantiateNapiModuleSync'},
  WASI: __WASI,
} = globalThis.${runtimeKey}`,
        )
        .replace(
          "const __wasmUrl = new URL('./test.wasm', import.meta.url).href",
          "const __wasmUrl = 'https://example.test/test.wasm'",
        )
        .replace(
          "new URL('./wasi-worker-browser.mjs', import.meta.url)",
          "'wasi-worker-browser.mjs'",
        )

      class Worker {
        constructor() {
          cleanupEvents.push('worker')
        }

        terminate() {
          cleanupEvents.push('terminate')
          return Promise.resolve(0)
        }
      }

      const instantiate = (
        _wasm: ArrayBuffer,
        options: {
          beforeInit(input: {
            instance: { exports: Record<string, () => void> }
          }): void
          onCreateWorker(): Worker
        },
      ) => {
        options.onCreateWorker()
        const instance = {
          exports: {
            napi_prepare_wasm_env_cleanup() {
              cleanupEvents.push('prepare')
            },
          },
        }
        options.beforeInit({ instance })
        if (asyncInit) {
          return Promise.reject(initializationError)
        }
        throw initializationError
      }
      Object.assign(globalThis, {
        [runtimeKey]: {
          createContext: () => ({
            suppressDestroy() {
              cleanupEvents.push('suppress')
            },
            destroy() {
              cleanupEvents.push('destroy')
            },
          }),
          createOnMessage: () => () => {},
          instantiateNapiModule: instantiate,
          instantiateNapiModuleSync: instantiate,
          WASI: class {},
        },
        [workerKey]: Worker,
      })
      const originalWorker = globalThis.Worker
      const originalFetch = globalThis.fetch
      Object.assign(globalThis, {
        Worker,
        fetch: async () => ({
          arrayBuffer: async () => new ArrayBuffer(0),
          ok: true,
          status: 200,
          statusText: 'OK',
        }),
      })

      try {
        const AsyncFunction = Object.getPrototypeOf(async function () {})
          .constructor as new (source: string) => () => Promise<unknown>
        const runModule = new AsyncFunction(
          `${source}\n//# sourceURL=wasi-browser-${asyncInit}.mjs`,
        )
        const observed = await t.throwsAsync(runModule())
        t.is(observed, initializationError)
        t.deepEqual(cleanupEvents, [
          'suppress',
          'worker',
          'prepare',
          'destroy',
          'terminate',
        ])
      } finally {
        if (originalWorker === undefined) {
          delete (globalThis as { Worker?: unknown }).Worker
        } else {
          globalThis.Worker = originalWorker
        }
        globalThis.fetch = originalFetch
        delete (globalThis as Record<string, unknown>)[runtimeKey]
        delete (globalThis as Record<string, unknown>)[workerKey]
      }
    }
  },
)

test('WASI node workers preserve valid arguments when removing invalid inherited arguments', (t) => {
  const code = createWasiBinding('test', '@scope/test')
  const workerExecArgvAttempts: string[][] = []

  class Worker {
    constructor(_filename: string, options: { execArgv?: string[] }) {
      const execArgv = options.execArgv ?? []
      workerExecArgvAttempts.push(execArgv)
      if (
        execArgv.includes('--title') ||
        execArgv.includes('--stack-trace-limit=100')
      ) {
        const error = new Error(
          'Initiated Worker with invalid execArgv flags: --title, --stack-trace-limit=100',
        ) as Error & { code: string }
        error.code = 'ERR_WORKER_INVALID_EXEC_ARGV'
        throw error
      }
    }

    unref() {}
  }

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
        return { Worker }
      case '@napi-rs/wasm-runtime':
        return {
          createContext: () => ({
            suppressDestroy() {},
            destroy() {},
          }),
          createOnMessage: () => () => {},
          instantiateNapiModuleSync(
            _wasm: Uint8Array,
            options: {
              beforeInit(input: {
                instance: { exports: Record<string, () => void> }
              }): void
              onCreateWorker(): Worker
            },
          ) {
            options.onCreateWorker()
            const instance = { exports: {} }
            options.beforeInit({ instance })
            return {
              instance,
              module: {},
              napiModule: { exports: {} },
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
    execArgv: [
      '--trace-warnings',
      '--input-type=module',
      '--eval',
      'evaluate()',
      '-p',
      'print()',
      '--title',
      'test-worker',
      '--require',
      './hook.cjs',
      '--stack-trace-limit=100',
      '--conditions=worker-test',
    ],
  })

  new Function('require', 'process', '__dirname', 'WebAssembly', code)(
    require,
    processMock,
    '/fixture',
    { Memory: class {} },
  )

  t.deepEqual(workerExecArgvAttempts, [
    [
      '--trace-warnings',
      '--title',
      'test-worker',
      '--require',
      './hook.cjs',
      '--stack-trace-limit=100',
      '--conditions=worker-test',
    ],
    ['--trace-warnings', '--require', './hook.cjs', '--conditions=worker-test'],
  ])
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

test('createCjsBinding does not mutate frozen load errors', (t) => {
  const immutableError = Object.freeze(
    Object.assign(new Error('immutable loader failure'), {
      code: 'MODULE_NOT_FOUND',
    }),
  )
  const require = (specifier: string) => {
    if (specifier === 'fs') {
      return { readFileSync: () => '' }
    }
    throw immutableError
  }
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
  const require = (specifier: string) => {
    requiredSpecifiers.push(specifier)
    if (specifier === 'fs') {
      return { readFileSync: () => '' }
    }
    if (specifier === './test.wasi.cjs') {
      return wasiBinding
    }
    throw new Error(`Unexpected native require: ${specifier}`)
  }
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
  const require = (specifier: string) => {
    requiredSpecifiers.push(specifier)
    if (specifier === 'fs') {
      return { readFileSync: () => '' }
    }
    if (specifier === '/native.node') {
      return nativeBinding
    }
    throw new Error(`Missing WASI binding: ${specifier}`)
  }
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
    './test.wasi.cjs',
    '@scope/test-wasm32-wasi',
    '/native.node',
  ])
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
