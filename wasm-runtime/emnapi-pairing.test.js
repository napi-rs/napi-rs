import assert from 'node:assert/strict'
import { once } from 'node:events'
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'

const runtimeDirectory = dirname(fileURLToPath(import.meta.url))

// A fake emnapi copy. Every value it hands out carries `copy`, a label unique
// to this installed directory, so a test can tell two copies of the same
// version apart. `createContext` returns an instance of the copy's own
// `Context` (with the generation's `createEnv` arity), the core records which
// copy ran and with which options, and v2 copies export their own plugins.
// The modules are fixed source; the label and version come from `copy.json`.
const writeEmnapi = async (nodeModules, version, label) => {
  const generation = version.split('.')[0]
  const copyJson = JSON.stringify({ copy: `${version} ${label}`, version })
  const coreDirectory = join(nodeModules, '@emnapi', 'core')
  const emnapiRuntimeDirectory = join(nodeModules, '@emnapi', 'runtime')
  await Promise.all([
    mkdir(coreDirectory, { recursive: true }),
    mkdir(emnapiRuntimeDirectory, { recursive: true }),
  ])
  await Promise.all([
    writeFile(
      join(coreDirectory, 'package.json'),
      JSON.stringify({
        name: '@emnapi/core',
        version,
        exports: {
          '.': './index.cjs',
          ...(generation === '1' ? {} : { './plugins': './plugins.cjs' }),
        },
      }),
    ),
    writeFile(join(coreDirectory, 'copy.json'), copyJson),
    writeFile(join(emnapiRuntimeDirectory, 'copy.json'), copyJson),
    writeFile(
      join(coreDirectory, 'index.cjs'),
      `const { copy, version } = require('./copy.json')
const result = (mode) => (wasm, options) => ({ copy, mode, wasm, options })
module.exports = {
  version,
  MessageHandler: class MessageHandler {
    constructor(options) { this.copy = copy; this.options = options }
  },
  instantiateNapiModuleSync: result('sync'),
  instantiateNapiModule: async (...args) => result('async')(...args),
}
`,
    ),
    writeFile(
      join(coreDirectory, 'plugins.cjs'),
      `const { copy } = require('./copy.json')
function asyncWork() {}
asyncWork.copy = copy
function tsfn() {}
tsfn.copy = copy
module.exports = { asyncWork, tsfn }
`,
    ),
    writeFile(
      join(emnapiRuntimeDirectory, 'package.json'),
      JSON.stringify({
        name: '@emnapi/runtime',
        version,
        exports: { '.': './index.cjs' },
      }),
    ),
    writeFile(
      join(emnapiRuntimeDirectory, 'index.cjs'),
      `const { copy, version } = require('./copy.json')
class Context {
  constructor() { this.copy = copy }
  ${generation === '1' ? 'createEnv(a, b, c, d, e, f) {}' : 'createEnv(a, b, c, d) {}'}
}
let defaultContext
module.exports = {
  version,
  Context,
  createContext: () => new Context(),
  getDefaultContext: () => (defaultContext ??= new Context()),
}
`,
    ),
  ])
}

const writeRuntimePackage = async (nodeModules) => {
  const runtimePackage = join(nodeModules, '@napi-rs', 'wasm-runtime')
  await mkdir(join(runtimePackage, 'dist'), { recursive: true })
  await mkdir(join(nodeModules, '@tybys', 'wasm-util'), { recursive: true })
  await Promise.all([
    writeFile(
      join(runtimePackage, 'package.json'),
      JSON.stringify({
        name: '@napi-rs/wasm-runtime',
        version: '0.0.0',
        exports: { '.': { require: './runtime.cjs' } },
      }),
    ),
    cp(
      join(runtimeDirectory, 'runtime.cjs'),
      join(runtimePackage, 'runtime.cjs'),
    ),
    cp(
      join(runtimeDirectory, 'dist', 'emnapi-plugins.cjs'),
      join(runtimePackage, 'dist', 'emnapi-plugins.cjs'),
    ),
    writeFile(
      join(runtimePackage, 'dist', 'fs-proxy.cjs'),
      'module.exports = { createFsProxy() {}, createOnMessage() {} }\n',
    ),
    writeFile(
      join(nodeModules, '@tybys', 'wasm-util', 'index.js'),
      'module.exports = { WASI: class WASI {} }\n',
    ),
  ])
}

// A package that calls the runtime the way generated loaders and workers do.
// `loader.cjs` makes its no-context calls while it is being loaded, like a
// generated loader, and exposes the rest for later calls.
const writeCaller = async (directory, name, dependencies) => {
  await mkdir(directory, { recursive: true })
  await writeFile(
    join(directory, 'package.json'),
    JSON.stringify({ name, version: '1.0.0', dependencies }),
  )
  await writeFile(
    join(directory, 'loader.cjs'),
    `const runtime = require('@napi-rs/wasm-runtime')
const ownRuntime = require('@emnapi/runtime')
const custom = () => ({})
module.exports = {
  runtime,
  custom,
  atLoad: {
    defaultContext: runtime.getDefaultContext(),
    createContext: runtime.createContext(),
    handler: new runtime.MessageHandler({ onLoad() {} }),
    noContext: runtime.instantiateNapiModuleSync('wasm', { childThread: true }),
  },
  ownContext: () => ownRuntime.createContext(),
  sync: (options) => runtime.instantiateNapiModuleSync('wasm', options),
  async: (options) => runtime.instantiateNapiModule('wasm', options),
  later: {
    defaultContext: () => runtime.getDefaultContext(),
    handler: () => new runtime.MessageHandler({ onLoad() {} }),
  },
}
`,
  )
  // A generated worker: an ES module that loads the runtime through
  // createRequire and takes everything from it.
  await writeFile(
    join(directory, 'worker.mjs'),
    `import { createRequire } from 'node:module'
import { parentPort } from 'node:worker_threads'
const require = createRequire(import.meta.url)
const runtime = require('@napi-rs/wasm-runtime')
const handler = new runtime.MessageHandler({ onLoad() {} })
const context = runtime.getDefaultContext()
const instantiated = runtime.instantiateNapiModuleSync('wasm', {
  childThread: true,
  context,
  plugins: [runtime.emnapiAsyncWorkPlugin, runtime.emnapiTSFNPlugin],
})
parentPort.postMessage({
  handler: handler.copy,
  context: context.copy,
  instantiated: instantiated.copy,
  plugins: instantiated.options.plugins.map((plugin) => plugin.copy ?? null),
})
`,
  )
}

const runWorker = async (file) => {
  const worker = new Worker(file)
  const [message] = await once(worker, 'message')
  await worker.terminate()
  return message
}

const tempRoot = async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'napi-rs-wasm-runtime-pairing-'))
  t.after(() => rm(root, { force: true, recursive: true }))
  return root
}

const BETA = '2.0.0-beta.2'

// npm: the runtime and its peers hoisted to the root (an unrelated emnapi
// 1.x), a binding with its own emnapi nested under it.
const createNpmFixture = async (t) => {
  const root = await tempRoot(t)
  const nodeModules = join(root, 'node_modules')
  await writeRuntimePackage(nodeModules)
  await writeEmnapi(nodeModules, '1.11.3', 'root')
  const binding = join(nodeModules, 'binding')
  await writeCaller(binding, 'binding', {
    '@napi-rs/wasm-runtime': '*',
    '@emnapi/core': BETA,
    '@emnapi/runtime': BETA,
  })
  await writeEmnapi(join(binding, 'node_modules'), BETA, 'binding')
  const plain = join(nodeModules, 'plain')
  await writeCaller(plain, 'plain', { '@napi-rs/wasm-runtime': '*' })
  return { root, binding, plain }
}

test('a binding with its own emnapi runs on its own copy', async (t) => {
  const { binding } = await createNpmFixture(t)
  const loader = createRequire(import.meta.url)(join(binding, 'loader.cjs'))
  const { runtime, custom } = loader
  const context = loader.ownContext()
  assert.equal(context.copy, `${BETA} binding`)

  const plugins = [
    custom,
    runtime.emnapiAsyncWorkPlugin,
    runtime.emnapiTSFNPlugin,
  ]
  for (const result of [
    loader.sync({ context, plugins }),
    await loader.async({ context, plugins }),
  ]) {
    assert.equal(result.copy, `${BETA} binding`)
    assert.equal(result.options.context, context)
    // The bundled plugins are swapped for the running core's own.
    assert.deepEqual(
      result.options.plugins.map((plugin) => plugin.copy ?? 'custom'),
      ['custom', `${BETA} binding`, `${BETA} binding`],
    )
    assert.equal(result.options.plugins[0], custom)
  }
  // Calls without a context made while the loader is loading.
  assert.equal(loader.atLoad.defaultContext.copy, `${BETA} binding`)
  assert.equal(loader.atLoad.createContext.copy, `${BETA} binding`)
  assert.equal(loader.atLoad.handler.copy, `${BETA} binding`)
  assert.equal(loader.atLoad.noContext.copy, `${BETA} binding`)
  // After loading there is no caller to go by: the runtime's own peers.
  assert.equal(loader.later.defaultContext().copy, '1.11.3 root')
  assert.equal(loader.later.handler().copy, '1.11.3 root')
})

test('the context lookup does not read exports of unrelated modules', async (t) => {
  const { root, binding } = await createNpmFixture(t)
  // A cached module whose exports run code on property access.
  const trap = join(root, 'node_modules', 'trap', 'index.cjs')
  await mkdir(dirname(trap), { recursive: true })
  await writeFile(
    trap,
    `let reads = 0
module.exports = {
  get Context() { reads++; throw new Error('Context getter ran') },
  reads: () => reads,
}
`,
  )
  // A second binding the runtime has not seen yet, so its context is found
  // only through the `require.cache` scan.
  const other = join(root, 'node_modules', 'other')
  await writeEmnapi(join(other, 'node_modules'), BETA, 'other')
  await writeFile(
    join(other, 'context.cjs'),
    "module.exports = require('@emnapi/runtime').createContext()\n",
  )
  const require = createRequire(import.meta.url)
  const { reads } = require(trap)
  const loader = require(join(binding, 'loader.cjs'))
  const context = require(join(other, 'context.cjs'))
  assert.equal(context.copy, `${BETA} other`)
  assert.equal(loader.sync({ context }).copy, `${BETA} other`)
  assert.equal(reads(), 0)
})

test('replacing the plugins keeps every other option', async (t) => {
  const { binding } = await createNpmFixture(t)
  const loader = createRequire(import.meta.url)(join(binding, 'loader.cjs'))
  const { runtime } = loader
  const context = loader.ownContext()
  class Options {
    #wasi = { kind: 'wasi' }
    constructor() {
      this.context = context
      this.plugins = [runtime.emnapiAsyncWorkPlugin, runtime.emnapiTSFNPlugin]
      Object.defineProperty(this, 'hidden', { value: 'own non-enumerable' })
    }
    get wasi() {
      return this.#wasi
    }
  }
  Options.prototype.overwriteImports = function overwriteImports(imports) {
    return imports
  }
  const options = new Options()
  for (const result of [loader.sync(options), await loader.async(options)]) {
    assert.equal(result.copy, `${BETA} binding`)
    assert.deepEqual(
      result.options.plugins.map((plugin) => plugin.copy),
      [`${BETA} binding`, `${BETA} binding`],
    )
    assert.equal(result.options.context, context)
    assert.equal(
      result.options.overwriteImports,
      Options.prototype.overwriteImports,
    )
    assert.equal(result.options.hidden, 'own non-enumerable')
    assert.deepEqual(result.options.wasi, { kind: 'wasi' })
  }
  // The caller's object is not changed.
  assert.equal(options.plugins[0], runtime.emnapiAsyncWorkPlugin)
})

test('a worker of a binding runs on the binding copy', async (t) => {
  const { binding, plain } = await createNpmFixture(t)
  assert.deepEqual(await runWorker(join(binding, 'worker.mjs')), {
    handler: `${BETA} binding`,
    context: `${BETA} binding`,
    instantiated: `${BETA} binding`,
    plugins: [`${BETA} binding`, `${BETA} binding`],
  })
  // A worker of a package without its own emnapi keeps the runtime's peers.
  assert.deepEqual(await runWorker(join(plain, 'worker.mjs')), {
    handler: '1.11.3 root',
    context: '1.11.3 root',
    instantiated: '1.11.3 root',
    plugins: [null, null],
  })
})

test('a context from the runtime peer copy runs on that copy', async (t) => {
  const { root, binding, plain } = await createNpmFixture(t)
  const loader = createRequire(import.meta.url)(join(binding, 'loader.cjs'))
  const peerRuntime = createRequire(join(root, 'x.cjs'))('@emnapi/runtime')
  assert.equal(
    loader.sync({ context: peerRuntime.createContext() }).copy,
    '1.11.3 root',
  )
  // A package that does not declare emnapi keeps the runtime's peers.
  const other = createRequire(import.meta.url)(join(plain, 'loader.cjs'))
  assert.equal(other.atLoad.defaultContext.copy, '1.11.3 root')
  assert.equal(other.atLoad.handler.copy, '1.11.3 root')
  const otherContext = other.ownContext()
  assert.equal(otherContext.copy, '1.11.3 root')
  assert.equal(other.sync({ context: otherContext }).copy, '1.11.3 root')
})

// pnpm: every package in its own store directory, linked by symlinks. The
// binding's emnapi copy has no core next to its runtime, and resolving from
// inside the runtime's store directory reaches the hoisted
// `.pnpm/node_modules`, which here holds another copy of the same version.
test('pnpm: the core comes from the binding, not from the runtime store directory', async (t) => {
  const root = await tempRoot(t)
  const store = join(root, 'node_modules', '.pnpm')
  const link = async (target, path) => {
    await mkdir(dirname(path), { recursive: true })
    await symlink(relative(dirname(path), target), path, 'dir')
  }
  // The runtime with its peers: 1.11.3.
  const runtimeStore = join(store, 'runtime', 'node_modules')
  await writeRuntimePackage(runtimeStore)
  await writeEmnapi(join(store, 'emnapi-1', 'node_modules'), '1.11.3', 'peer')
  for (const name of ['core', 'runtime']) {
    await link(
      join(store, 'emnapi-1', 'node_modules', '@emnapi', name),
      join(runtimeStore, '@emnapi', name),
    )
  }
  // The binding's own copy, core and runtime in separate store directories.
  await writeEmnapi(join(store, 'core-2', 'node_modules'), BETA, 'binding')
  await writeEmnapi(join(store, 'runtime-2', 'node_modules'), BETA, 'binding')
  // The hoisted fallback: another copy of the same version.
  await writeEmnapi(join(store, 'node_modules'), BETA, 'hoisted')
  const bindingStore = join(store, 'binding', 'node_modules')
  const binding = join(bindingStore, 'binding')
  await writeCaller(binding, 'binding', {
    '@napi-rs/wasm-runtime': '*',
    '@emnapi/core': BETA,
    '@emnapi/runtime': BETA,
  })
  await link(
    join(runtimeStore, '@napi-rs', 'wasm-runtime'),
    join(bindingStore, '@napi-rs', 'wasm-runtime'),
  )
  await link(
    join(store, 'core-2', 'node_modules', '@emnapi', 'core'),
    join(bindingStore, '@emnapi', 'core'),
  )
  await link(
    join(store, 'runtime-2', 'node_modules', '@emnapi', 'runtime'),
    join(bindingStore, '@emnapi', 'runtime'),
  )
  await link(binding, join(root, 'node_modules', 'binding'))

  const loader = createRequire(import.meta.url)(
    join(root, 'node_modules', 'binding', 'loader.cjs'),
  )
  const context = loader.ownContext()
  assert.equal(context.copy, `${BETA} binding`)
  const result = loader.sync({
    context,
    plugins: [loader.runtime.emnapiAsyncWorkPlugin],
  })
  assert.equal(result.copy, `${BETA} binding`)
  assert.equal(result.options.plugins[0].copy, `${BETA} binding`)
  assert.equal(loader.atLoad.defaultContext.copy, `${BETA} binding`)
  assert.equal(loader.atLoad.handler.copy, `${BETA} binding`)
  assert.deepEqual(
    await runWorker(join(root, 'node_modules', 'binding', 'worker.mjs')),
    {
      handler: `${BETA} binding`,
      context: `${BETA} binding`,
      instantiated: `${BETA} binding`,
      plugins: [`${BETA} binding`, `${BETA} binding`],
    },
  )
})

// npm can resolve this package's two peers to different versions: here the
// root runtime is the binding's version, but the root core is not, and the
// binding's core is nested under it.
test('a context from the runtime peer runtime uses the matching core', async (t) => {
  const root = await tempRoot(t)
  const nodeModules = join(root, 'node_modules')
  await writeRuntimePackage(nodeModules)
  await writeEmnapi(join(root, 'mixed'), '2.0.0-alpha.6', 'root')
  await writeEmnapi(join(root, 'mixed2'), BETA, 'root')
  await cp(
    join(root, 'mixed', '@emnapi', 'core'),
    join(nodeModules, '@emnapi', 'core'),
    { recursive: true },
  )
  await cp(
    join(root, 'mixed2', '@emnapi', 'runtime'),
    join(nodeModules, '@emnapi', 'runtime'),
    { recursive: true },
  )
  const binding = join(nodeModules, 'binding')
  await writeCaller(binding, 'binding', {
    '@napi-rs/wasm-runtime': '*',
    '@emnapi/core': BETA,
    '@emnapi/runtime': BETA,
  })
  await writeEmnapi(join(binding, 'node_modules'), BETA, 'binding')
  await rm(join(binding, 'node_modules', '@emnapi', 'runtime'), {
    recursive: true,
  })
  const loader = createRequire(import.meta.url)(join(binding, 'loader.cjs'))
  const context = loader.ownContext()
  assert.equal(context.copy, `${BETA} root`)
  assert.equal(loader.sync({ context }).copy, `${BETA} binding`)
})

test('a context from another emnapi generation is a clear error', async (t) => {
  const { binding } = await createNpmFixture(t)
  const loader = createRequire(import.meta.url)(join(binding, 'loader.cjs'))
  // Contexts from no copy the runtime can see fall back to the runtime's own
  // peers (1.11.3 here). The same generation keeps the old behavior.
  assert.equal(
    loader.sync({ context: { createEnv(_a, _b, _c, _d, _e, _f) {} } }).copy,
    '1.11.3 root',
  )
  // Another generation would fail inside emnapi with an unrelated message.
  const v2Foreign = { createEnv(_a, _b, _c, _d) {} }
  assert.throws(
    () => loader.sync({ context: v2Foreign }),
    (error) =>
      error instanceof TypeError &&
      /created by @emnapi\/runtime v2, but @emnapi\/core 1\.11\.3/.test(
        error.message,
      ),
  )
  await assert.rejects(loader.async({ context: v2Foreign }), TypeError)
})
