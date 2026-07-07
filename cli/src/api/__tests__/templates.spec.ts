import ava, { type ExecutionContext } from 'ava'
import { parseSync } from 'oxc-parser'

import { createCjsBinding, createEsmBinding } from '../templates/js-binding.js'
import {
  createWasiBinding,
  createWasiBrowserBinding,
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

test('WASI main loaders create an isolated context', (t) => {
  const contexts: object[] = []
  const code = `${createWasiBinding('test', '@scope/test')}
module.exports = __napiModule.exports
`

  function load() {
    const module = { exports: {} }
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
              t.is(options.context, contexts.at(-1))
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
    return module.exports
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
  })

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
