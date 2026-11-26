import assert from 'node:assert/strict'
import { EventEmitter, once } from 'node:events'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Worker } from 'node:worker_threads'

import wabtFactory from 'wabt'

// CI points this at the installed tarball so tests exercise the published file
// list and bundles with real peers, outside the monorepo's resolutions.
const runtimeDirectory = process.env.WASM_RUNTIME_TEST_PACKAGE
  ? resolve(process.env.WASM_RUNTIME_TEST_PACKAGE)
  : dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const coreVersion = createRequire(join(runtimeDirectory, 'package.json'))(
  '@emnapi/core',
).version
const wabt = await wabtFactory()
const wat = await readFile(
  new URL('./fixtures/plugins.wat', import.meta.url),
  'utf8',
)
const compile = (shared) => {
  const module = wabt.parseWat(
    'plugins.wat',
    wat.replace('MEMORY_SHARED', shared ? 'shared' : ''),
    { threads: true },
  )
  try {
    return new WebAssembly.Module(module.toBinary({}).buffer)
  } finally {
    module.destroy()
  }
}
const modules = [compile(false), compile(true)]

const createTestContext = (runtime, t) => {
  // Older emnapi contexts retain a one-shot beforeExit hook even after explicit
  // destroy. Remove only this test's hook once its context has been destroyed.
  const existingHooks = new Set(process.listeners('beforeExit'))
  const context = runtime.createContext({ autoDestroy: false })
  const hooks = process
    .listeners('beforeExit')
    .filter((hook) => !existingHooks.has(hook))
  t.after(() => {
    context.destroy()
    for (const hook of hooks) process.removeListener('beforeExit', hook)
  })
  return context
}

for (const format of ['cjs', 'esm']) {
  const runtime =
    format === 'cjs'
      ? require(join(runtimeDirectory, 'runtime.cjs'))
      : await import(pathToFileURL(join(runtimeDirectory, 'runtime.js')).href)

  for (const async of [false, true]) {
    for (const workerMode of [false, true]) {
      test(
        `${format} ${async ? 'async' : 'sync'}: real async work and TSFN${workerMode ? ' through a worker' : ''}`,
        { timeout: 10000 },
        async (t) => {
          const context = createTestContext(runtime, t)
          const memory = new WebAssembly.Memory({
            initial: 1,
            maximum: 4,
            shared: workerMode,
          })
          const events = []
          const emitter = new EventEmitter()
          const record = (...event) => {
            events.push(event)
            emitter.emit(String(event[0]), event)
          }
          const waitFor = (kind) => {
            const event = events.find(([type]) => type === kind)
            return event
              ? Promise.resolve(event)
              : once(emitter, String(kind)).then(([value]) => value)
          }
          const workers = []
          const exits = []
          let napiModule
          t.after(async () => {
            workers.forEach((worker) =>
              napiModule?.PThread.terminateWorker(worker),
            )
            await Promise.all(workers.map((worker) => worker.terminate()))
            context.destroy()
          })
          const options = {
            context,
            // Exercise the JS async-work implementation with bounded scheduling.
            asyncWorkPoolSize: -1,
            // v1 only supports preloading with asynchronous instantiation.
            reuseWorker: workerMode
              ? async
                ? { size: 1, strict: true }
                : true
              : false,
            plugins: [runtime.emnapiAsyncWorkPlugin, runtime.emnapiTSFNPlugin],
            onCreateWorker() {
              const worker = new Worker(
                new URL('./fixtures/plugin-worker.mjs', import.meta.url),
                {
                  workerData: { runtimeDirectory, format },
                },
              )
              workers.push(worker)
              exits.push(new Promise((resolve) => worker.once('exit', resolve)))
              worker.on('message', (message) => {
                if (message.event) record(...message.event)
              })
              return worker
            },
            overwriteImports(imports) {
              imports.env.memory = memory
              imports.test = {
                workerMode: () => Number(workerMode),
                event: record,
              }
            },
          }
          const source = await (async
            ? runtime.instantiateNapiModule(
                modules[Number(workerMode)],
                options,
              )
            : runtime.instantiateNapiModuleSync(
                modules[Number(workerMode)],
                options,
              ))
          napiModule = source.napiModule
          assert.equal(napiModule.loaded, true)
          assert.equal(typeof napiModule.initWorker, 'function')

          if (workerMode) {
            const worker = napiModule.PThread.getNewWorker()
            assert.equal(workers.length, 1)
            await worker.whenLoaded
            // MessageHandler must invoke the real bundled initWorker on the
            // child core context, including its table callback.
            worker.postMessage({
              __emnapi__: {
                type: 'async-worker-init',
                payload: { arg: 77, func: [5, 88] },
              },
            })
            assert.deepEqual(await waitFor(7), [7, 77, 0])
            // Early v1 initializes the worker without the optional table callback.
            if (napiModule.initWorker.length > 1) {
              assert.deepEqual(await waitFor(8), [8, 88, 0])
            }
            worker.postMessage({
              callTSFN: new DataView(memory.buffer).getUint32(136, true),
            })
            assert.deepEqual(await waitFor(3), [3, 43, 123])
            source.instance.exports.releaseTSFN()
          }

          assert.deepEqual(await waitFor(1), [1, 42, 0])
          assert.deepEqual(await waitFor(2), [2, 42, 0])
          assert.deepEqual(await waitFor(3), [3, 43, 123])
          assert.deepEqual(await waitFor(4), [4, 99, 123])
          assert(
            events.some(([type]) => type === 5),
            'TSFN allocations must be freed',
          )
          workers.forEach((worker) =>
            napiModule.PThread.terminateWorker(worker),
          )
          await Promise.all(exits)
          context.destroy()
          // Disposal must be safe to repeat after all work and TSFN finalizers.
          context.destroy()
          assert.equal(events.filter(([type]) => type === 4).length, 1)
          if (coreVersion.startsWith('2.')) {
            assert(
              events.some(([type]) => type === 6),
              'env must be deleted',
            )
          }
        },
      )
    }
  }

  test(`${format}: rejects invalid wasm after plugin initialization`, async (t) => {
    const context = createTestContext(runtime, t)
    try {
      const options = {
        context,
        plugins: [runtime.emnapiAsyncWorkPlugin, runtime.emnapiTSFNPlugin],
      }
      assert.throws(
        () => runtime.instantiateNapiModuleSync(new Uint8Array(), options),
        WebAssembly.CompileError,
      )
      await assert.rejects(
        runtime.instantiateNapiModule(new Uint8Array(), options),
        WebAssembly.CompileError,
      )
    } finally {
      context.destroy()
    }
  })

  // v1's thread manager deliberately rethrows worker errors on the parent.
  // v2 reports preload failures through the instantiation promise, starting
  // with 2.0.0-alpha.5 (@emnapi/wasi-threads 2.1.0). alpha.1 to alpha.4 throw
  // the failure inside the worker instead, whichever plugins are passed.
  if (
    coreVersion.startsWith('2.') &&
    !/^2\.0\.0-alpha\.[1-4]$/.test(coreVersion)
  ) {
    test(
      `${format}: rejects a failed worker load and permits cleanup`,
      { timeout: 10000 },
      async (t) => {
        const context = createTestContext(runtime, t)
        const workers = []
        t.after(() => Promise.all(workers.map((worker) => worker.terminate())))
        await assert.rejects(
          runtime.instantiateNapiModule(modules[1], {
            context,
            reuseWorker: { size: 1, strict: true },
            plugins: [runtime.emnapiAsyncWorkPlugin, runtime.emnapiTSFNPlugin],
            printErr() {},
            onCreateWorker() {
              const worker = new Worker(
                new URL('./fixtures/plugin-worker.mjs', import.meta.url),
                {
                  workerData: { runtimeDirectory, format, failLoad: true },
                },
              )
              workers.push(worker)
              return worker
            },
            overwriteImports(imports) {
              imports.env.memory = new WebAssembly.Memory({
                initial: 1,
                maximum: 4,
                shared: true,
              })
              imports.test = { workerMode: () => 1, event() {} }
            },
          }),
          /fixture worker load failure/,
        )
        assert(workers.length > 0)
      },
    )
  }
}

const arrayBufferCopyWat = `
(module
  (import "env" "memory" (memory 1 4 MEMORY_SHARED))
  (import "env" "napi_create_string_utf8" (func $createString (param i32 i32 i32 i32) (result i32)))
  (import "env" "napi_set_named_property" (func $setProp (param i32 i32 i32 i32) (result i32)))
  (import "env" "napi_get_and_clear_last_exception" (func $clearExc (param i32 i32) (result i32)))
  (import "env" "emnapi_create_arraybuffer_copy" (func $createABCopy (param i32 i32 i32 i32) (result i32)))
  (export "memory" (memory 0))
  (table (export "__indirect_function_table") 1 funcref)
  (data (i32.const 64) "hello-ab-copy")
  (data (i32.const 80) "copied\\00")
  (data (i32.const 96) "empty\\00")

  ;; Slots: heap cursor = 192, statusNullData = 200, statusNullResult = 204,
  ;; statusOob = 208, freeCount = 212, abHandle = 216, emptyHandle = 220,
  ;; excHandle = 224, v2 env = 256.
  (func (export "malloc") (param $size i32) (result i32) (local $p i32)
    (local.set $p (i32.load (i32.const 192)))
    (i32.store (i32.const 192) (i32.and (i32.add (i32.add (local.get $p) (local.get $size)) (i32.const 7)) (i32.const -8)))
    (local.get $p))
  (func (export "free") (param $p i32)
    (i32.store (i32.const 212) (i32.add (i32.load (i32.const 212)) (i32.const 1))))
  (func (export "emnapi_create_env") (result i32) (i32.const 256))
  (func (export "emnapi_delete_env") (param i32))

  (func $check (param $status i32)
    (if (local.get $status) (then unreachable)))

  (func (export "napi_register_wasm_v1") (param $env i32) (param $exports i32) (result i32)
    (i32.store (i32.const 192) (i32.const 1024))
    (i32.store (i32.const 212) (i32.const 0))

    ;; 1. Non-empty copy from wasm memory
    (call $check (call $createABCopy (local.get $env) (i32.const 64) (i32.const 13) (i32.const 216)))
    (call $check (call $setProp (local.get $env) (local.get $exports) (i32.const 80) (i32.load (i32.const 216))))

    ;; 2. Zero-length copy with null data pointer
    (call $check (call $createABCopy (local.get $env) (i32.const 0) (i32.const 0) (i32.const 220)))
    (call $check (call $setProp (local.get $env) (local.get $exports) (i32.const 96) (i32.load (i32.const 220))))

    ;; 3. Invalid: non-zero byteLength with null data pointer -> napi_invalid_arg (1)
    (i32.store (i32.const 200) (call $createABCopy (local.get $env) (i32.const 0) (i32.const 4) (i32.const 216)))

    ;; 4. Invalid: null result pointer -> napi_invalid_arg (1)
    (i32.store (i32.const 204) (call $createABCopy (local.get $env) (i32.const 64) (i32.const 4) (i32.const 0)))

    ;; 5. Out-of-bounds data + byteLength -> non-zero status (clear pending RangeError if native threw)
    (i32.store (i32.const 208) (call $createABCopy (local.get $env) (i32.const -16) (i32.const 32) (i32.const 216)))
    (drop (call $clearExc (local.get $env) (i32.const 224)))

    (local.get $exports))
)
`

const compileArrayBufferCopyModule = (shared, exportMemory = true) => {
  let source = arrayBufferCopyWat.replace(
    'MEMORY_SHARED',
    shared ? 'shared' : '',
  )
  if (!exportMemory) {
    source = source.replace('  (export "memory" (memory 0))\n', '')
  }
  const module = wabt.parseWat('ab-copy.wat', source, { threads: true })
  try {
    return new WebAssembly.Module(module.toBinary({}).buffer)
  } finally {
    module.destroy()
  }
}

const abCopyModules = {
  unshared: compileArrayBufferCopyModule(false),
  unsharedNoExport: compileArrayBufferCopyModule(false, false),
  shared: compileArrayBufferCopyModule(true),
}

// Create a fixture with `@emnapi/core` stripped of `emnapi_create_arraybuffer_copy`
// to exercise the fallback shim against older emnapi core versions (1.7.1, beta.2, beta.3).
const createStrippedEmnapiFixture = async (t, fakeCoreVersion) => {
  const root = await mkdtemp(join(tmpdir(), 'napi-rs-wasm-runtime-ab-copy-'))
  t.after(() => rm(root, { force: true, recursive: true }))
  const realCoreEntry = createRequire(
    join(runtimeDirectory, 'package.json'),
  ).resolve('@emnapi/core')
  const realRuntimeEntry = createRequire(
    join(runtimeDirectory, 'package.json'),
  ).resolve('@emnapi/runtime')
  const realWasmUtilEntry = createRequire(
    join(runtimeDirectory, 'package.json'),
  ).resolve('@tybys/wasm-util')
  const nodeModules = join(root, 'node_modules')
  const coreDir = join(nodeModules, '@emnapi', 'core')
  const emnapiRtDir = join(nodeModules, '@emnapi', 'runtime')
  const utilDir = join(nodeModules, '@tybys', 'wasm-util')
  await Promise.all([
    mkdir(join(root, 'dist'), { recursive: true }),
    mkdir(coreDir, { recursive: true }),
    mkdir(emnapiRtDir, { recursive: true }),
    mkdir(utilDir, { recursive: true }),
  ])
  const wrapCoreBody = `
function stripNativeCopy(options) {
  if (!options || typeof options !== 'object') return options
  return new Proxy(options, {
    get(target, key) {
      if (key === 'overwriteImports') {
        const original = Reflect.get(target, key)
        return function (importObject) {
          if (importObject && importObject.emnapi) {
            delete importObject.emnapi.emnapi_create_arraybuffer_copy
          }
          return typeof original === 'function'
            ? Reflect.apply(original, target, [importObject])
            : importObject
        }
      }
      return Reflect.get(target, key)
    },
  })
}
`
  await Promise.all([
    writeFile(join(root, 'package.json'), JSON.stringify({ type: 'module' })),
    cp(join(runtimeDirectory, 'runtime.cjs'), join(root, 'runtime.cjs')),
    cp(join(runtimeDirectory, 'runtime.js'), join(root, 'runtime.js')),
    cp(
      join(runtimeDirectory, 'runtime-node.js'),
      join(root, 'runtime-node.js'),
    ),
    cp(
      join(runtimeDirectory, 'dist', 'emnapi-compat.cjs'),
      join(root, 'dist', 'emnapi-compat.cjs'),
    ),
    cp(
      join(runtimeDirectory, 'dist', 'emnapi-compat.js'),
      join(root, 'dist', 'emnapi-compat.js'),
    ),
    cp(
      join(runtimeDirectory, 'dist', 'emnapi-pairing.cjs'),
      join(root, 'dist', 'emnapi-pairing.cjs'),
    ),
    cp(
      join(runtimeDirectory, 'dist', 'emnapi-pairing.js'),
      join(root, 'dist', 'emnapi-pairing.js'),
    ),
    cp(
      join(runtimeDirectory, 'dist', 'emnapi-plugins.cjs'),
      join(root, 'dist', 'emnapi-plugins.cjs'),
    ),
    cp(
      join(runtimeDirectory, 'dist', 'emnapi-plugins.js'),
      join(root, 'dist', 'emnapi-plugins.js'),
    ),
    cp(join(runtimeDirectory, 'fs-proxy.js'), join(root, 'fs-proxy.js')),
    cp(
      join(runtimeDirectory, 'dist', 'fs-proxy.cjs'),
      join(root, 'dist', 'fs-proxy.cjs'),
    ),
    writeFile(
      join(coreDir, 'package.json'),
      JSON.stringify({
        name: '@emnapi/core',
        version: fakeCoreVersion,
        type: 'module',
        exports: { '.': { import: './index.js', require: './index.cjs' } },
      }),
    ),
    writeFile(
      join(coreDir, 'index.cjs'),
      `const realCore = require(${JSON.stringify(realCoreEntry)})
${wrapCoreBody}
module.exports = {
  ...realCore,
  version: ${JSON.stringify(fakeCoreVersion)},
  instantiateNapiModuleSync: (wasm, options) => realCore.instantiateNapiModuleSync(wasm, stripNativeCopy(options)),
  instantiateNapiModule: (wasm, options) => realCore.instantiateNapiModule(wasm, stripNativeCopy(options)),
}
`,
    ),
    writeFile(
      join(coreDir, 'index.js'),
      `import { createRequire } from 'node:module'
const realCore = createRequire(import.meta.url)(${JSON.stringify(realCoreEntry)})
${wrapCoreBody}
export const version = ${JSON.stringify(fakeCoreVersion)}
export const MessageHandler = realCore.MessageHandler
export const instantiateNapiModuleSync = (wasm, options) => realCore.instantiateNapiModuleSync(wasm, stripNativeCopy(options))
export const instantiateNapiModule = (wasm, options) => realCore.instantiateNapiModule(wasm, stripNativeCopy(options))
`,
    ),
    writeFile(
      join(emnapiRtDir, 'package.json'),
      JSON.stringify({
        name: '@emnapi/runtime',
        version: fakeCoreVersion,
        type: 'module',
        exports: { '.': { import: './index.js', require: './index.cjs' } },
      }),
    ),
    writeFile(
      join(emnapiRtDir, 'index.cjs'),
      `const realRuntime = require(${JSON.stringify(realRuntimeEntry)})
const isV1 = ${JSON.stringify(fakeCoreVersion.startsWith('1.'))}
const adaptContext = (ctx) => {
  if (typeof ctx.createEnv === 'function') {
    const realCreateEnv = ctx.createEnv
    if (isV1 && realCreateEnv.length !== 6) {
      ctx.createEnv = function (a, b, c, d, _e, _f) {
        return realCreateEnv.apply(this, arguments)
      }
    } else if (!isV1 && realCreateEnv.length !== 4) {
      ctx.createEnv = function (a, b, c, d) {
        return realCreateEnv.apply(this, arguments)
      }
    }
  }
  return ctx
}
module.exports = {
  ...realRuntime,
  version: ${JSON.stringify(fakeCoreVersion)},
  createContext: (...args) => adaptContext(realRuntime.createContext(...args)),
  getDefaultContext: (...args) => adaptContext(realRuntime.getDefaultContext(...args)),
}
`,
    ),
    writeFile(
      join(emnapiRtDir, 'index.js'),
      `import { createRequire } from 'node:module'
const rt = createRequire(import.meta.url)(${JSON.stringify(realRuntimeEntry)})
const isV1 = ${JSON.stringify(fakeCoreVersion.startsWith('1.'))}
const adaptContext = (ctx) => {
  if (typeof ctx.createEnv === 'function') {
    const realCreateEnv = ctx.createEnv
    if (isV1 && realCreateEnv.length !== 6) {
      ctx.createEnv = function (a, b, c, d, _e, _f) {
        return realCreateEnv.apply(this, arguments)
      }
    } else if (!isV1 && realCreateEnv.length !== 4) {
      ctx.createEnv = function (a, b, c, d) {
        return realCreateEnv.apply(this, arguments)
      }
    }
  }
  return ctx
}
export const Context = rt.Context
export const createContext = (...args) => adaptContext(rt.createContext(...args))
export const getDefaultContext = (...args) => adaptContext(rt.getDefaultContext(...args))
export const version = ${JSON.stringify(fakeCoreVersion)}
`,
    ),
    writeFile(
      join(utilDir, 'package.json'),
      JSON.stringify({
        name: '@tybys/wasm-util',
        version: '0.10.4',
        exports: { '.': './index.cjs' },
      }),
    ),
    writeFile(
      join(utilDir, 'index.cjs'),
      `module.exports = require(${JSON.stringify(realWasmUtilEntry)})\n`,
    ),
  ])
  return root
}

const runArrayBufferCopyAssertion = async ({
  runtime,
  t,
  asyncMode,
  shared,
  expectShim,
}) => {
  const context = createTestContext(runtime, t)
  const memory = new WebAssembly.Memory({
    initial: 1,
    maximum: 4,
    shared,
  })
  let sawCopyFn
  const options = {
    context,
    asyncWorkPoolSize: 0,
    overwriteImports(importObject) {
      sawCopyFn = importObject.emnapi.emnapi_create_arraybuffer_copy
      importObject.env = {
        ...importObject.env,
        ...importObject.napi,
        ...importObject.emnapi,
        memory,
      }
      return importObject
    },
  }
  const wasmModule = shared ? abCopyModules.shared : abCopyModules.unshared
  const { napiModule } = await (asyncMode
    ? runtime.instantiateNapiModule(wasmModule, options)
    : runtime.instantiateNapiModuleSync(wasmModule, options))

  assert.equal(typeof sawCopyFn, 'function')
  if (expectShim) {
    assert.equal(sawCopyFn.name, 'emnapi_create_arraybuffer_copy')
  }
  assert.ok(napiModule.exports.copied instanceof ArrayBuffer)
  assert.equal(
    new TextDecoder().decode(new Uint8Array(napiModule.exports.copied)),
    'hello-ab-copy',
  )
  assert.ok(napiModule.exports.empty instanceof ArrayBuffer)
  assert.equal(napiModule.exports.empty.byteLength, 0)

  const view = new DataView(memory.buffer)
  assert.equal(
    view.getInt32(200, true),
    1,
    'null data with len > 0 -> invalid_arg',
  )
  assert.equal(view.getInt32(204, true), 1, 'null result -> invalid_arg')
  assert.notEqual(
    view.getInt32(208, true),
    0,
    'out-of-bounds -> non-zero error',
  )
  if (expectShim) {
    // Scratch out-param pointer allocated via malloc(4) must be freed in finally.
    assert.ok(
      view.getInt32(212, true) >= 1,
      'fallback must free scratch pointer',
    )
  } else {
    assert.equal(
      view.getInt32(212, true),
      0,
      'native beta.4 path must not call malloc/free',
    )
  }
}

const coreHasNativeArrayBufferCopy = (() => {
  const pkgRequire = createRequire(join(runtimeDirectory, 'package.json'))
  const rawCore = pkgRequire('@emnapi/core')
  const rawRuntime = pkgRequire('@emnapi/runtime')
  const existingHooks = new Set(process.listeners('beforeExit'))
  const probeContext = rawRuntime.createContext({ autoDestroy: false })
  const hooks = process
    .listeners('beforeExit')
    .filter((hook) => !existingHooks.has(hook))
  const sentinel = new Error('probe')
  let hasNative = false
  try {
    rawCore.instantiateNapiModuleSync(abCopyModules.unshared, {
      context: probeContext,
      asyncWorkPoolSize: 0,
      overwriteImports(importObject) {
        hasNative =
          typeof importObject?.emnapi?.emnapi_create_arraybuffer_copy ===
          'function'
        throw sentinel
      },
    })
  } catch (error) {
    if (error !== sentinel) {
      throw error
    }
  } finally {
    probeContext.destroy()
    for (const hook of hooks) process.removeListener('beforeExit', hook)
  }
  return hasNative
})()

for (const format of ['cjs', 'esm', 'node-esm']) {
  test(`${format}: emnapi_create_arraybuffer_copy works with installed @emnapi/core ${coreVersion}`, async (t) => {
    const runtime =
      format === 'cjs'
        ? require(join(runtimeDirectory, 'runtime.cjs'))
        : await import(
            pathToFileURL(
              join(
                runtimeDirectory,
                format === 'node-esm' ? 'runtime-node.js' : 'runtime.js',
              ),
            ).href
          )
    for (const asyncMode of [false, true]) {
      for (const shared of [false, true]) {
        await runArrayBufferCopyAssertion({
          runtime,
          t,
          asyncMode,
          shared,
          expectShim: !coreHasNativeArrayBufferCopy,
        })
      }
    }
  })
}

for (const oldVersion of ['1.7.1', '2.0.0-beta.2', '2.0.0-beta.3']) {
  test(`emnapi_create_arraybuffer_copy fallback shim works when missing (simulated @emnapi/core ${oldVersion})`, async (t) => {
    const root = await createStrippedEmnapiFixture(t, oldVersion)
    const cjsRuntime = createRequire(join(root, 'entry.cjs'))(
      join(root, 'runtime.cjs'),
    )
    const esmRuntime = await import(
      pathToFileURL(join(root, 'runtime.js')).href
    )
    const nodeEsmRuntime = await import(
      pathToFileURL(join(root, 'runtime-node.js')).href
    )
    for (const runtime of [cjsRuntime, esmRuntime, nodeEsmRuntime]) {
      for (const asyncMode of [false, true]) {
        for (const shared of [false, true]) {
          await runArrayBufferCopyAssertion({
            runtime,
            t,
            asyncMode,
            shared,
            expectShim: true,
          })
        }
      }
    }
  })
}

test('emnapi_create_arraybuffer_copy fallback calls options.getMemory strictly once and handles frozen env + caller override', async (t) => {
  const root = await createStrippedEmnapiFixture(t, '2.0.0-beta.3')
  const cjsRuntime = createRequire(join(root, 'entry.cjs'))(
    join(root, 'runtime.cjs'),
  )
  const esmRuntime = await import(pathToFileURL(join(root, 'runtime.js')).href)
  const nodeEsmRuntime = await import(
    pathToFileURL(join(root, 'runtime-node.js')).href
  )

  for (const runtime of [cjsRuntime, esmRuntime, nodeEsmRuntime]) {
    // 1. Stateful getMemory callback: returns real memory on 1st call, wrong empty
    //    memory on any subsequent call. Must be invoked strictly once!
    {
      const context = createTestContext(runtime, t)
      const memory = new WebAssembly.Memory({ initial: 1, maximum: 4 })
      const decoyMemory = new WebAssembly.Memory({ initial: 1, maximum: 1 })
      let getMemoryCalls = 0
      const { napiModule } = runtime.instantiateNapiModuleSync(
        abCopyModules.unshared,
        {
          context,
          asyncWorkPoolSize: 0,
          getMemory(exports) {
            getMemoryCalls += 1
            return getMemoryCalls === 1 ? exports.memory : decoyMemory
          },
          overwriteImports(importObject) {
            importObject.env = {
              ...importObject.env,
              ...importObject.napi,
              ...importObject.emnapi,
              memory,
            }
            return importObject
          },
        },
      )
      assert.equal(getMemoryCalls, 1)
      assert.ok(napiModule.exports.copied instanceof ArrayBuffer)
      assert.equal(
        new TextDecoder().decode(new Uint8Array(napiModule.exports.copied)),
        'hello-ab-copy',
      )
    }

    // 2. Frozen env + frozen importObject without `emnapi_create_arraybuffer_copy`:
    //    must clone cleanly without mutating the frozen objects.
    {
      const context = createTestContext(runtime, t)
      const memory = new WebAssembly.Memory({ initial: 1, maximum: 4 })
      let frozenEnv
      let frozenImportObject
      const { napiModule } = runtime.instantiateNapiModuleSync(
        abCopyModules.unshared,
        {
          context,
          asyncWorkPoolSize: 0,
          overwriteImports(importObject) {
            // Copy napi + emnapi_sync_memory explicitly, omitting emnapi_create_arraybuffer_copy
            frozenEnv = Object.freeze({
              memory,
              napi_create_string_utf8:
                importObject.napi.napi_create_string_utf8,
              napi_set_named_property:
                importObject.napi.napi_set_named_property,
              napi_get_and_clear_last_exception:
                importObject.napi.napi_get_and_clear_last_exception,
              napi_create_arraybuffer:
                importObject.napi.napi_create_arraybuffer,
              emnapi_sync_memory: importObject.emnapi.emnapi_sync_memory,
            })
            frozenImportObject = Object.freeze({
              ...importObject,
              env: frozenEnv,
            })
            return frozenImportObject
          },
        },
      )
      assert.equal('emnapi_create_arraybuffer_copy' in frozenEnv, false)
      assert.equal(frozenImportObject.env, frozenEnv)
      assert.ok(napiModule.exports.copied instanceof ArrayBuffer)
      assert.equal(
        new TextDecoder().decode(new Uint8Array(napiModule.exports.copied)),
        'hello-ab-copy',
      )
    }

    // 3. Explicit caller-provided `env.emnapi_create_arraybuffer_copy` is preserved untouched.
    {
      const context = createTestContext(runtime, t)
      const memory = new WebAssembly.Memory({ initial: 1, maximum: 4 })
      let customCalls = 0
      const { napiModule } = runtime.instantiateNapiModuleSync(
        abCopyModules.unshared,
        {
          context,
          asyncWorkPoolSize: 0,
          overwriteImports(importObject) {
            const fallback = importObject.emnapi.emnapi_create_arraybuffer_copy
            const customCopy = (env, data, byteLength, result) => {
              customCalls += 1
              return fallback(env, data, byteLength, result)
            }
            importObject.env = Object.freeze({
              ...importObject.env,
              ...importObject.napi,
              ...importObject.emnapi,
              emnapi_create_arraybuffer_copy: customCopy,
              memory,
            })
          },
        },
      )
      assert.equal(customCalls, 5)
      assert.equal(
        new TextDecoder().decode(new Uint8Array(napiModule.exports.copied)),
        'hello-ab-copy',
      )
    }

    // 4. Frozen options object (`Object.freeze({ overwriteImports, beforeInit, getMemory })`):
    //    must still install the compatibility shim, capture instance/memory,
    //    invoke `getMemory` strictly once, and preserve `this` binding.
    {
      const context = createTestContext(runtime, t)
      const memory = new WebAssembly.Memory({ initial: 1, maximum: 4 })
      const decoyMemory = new WebAssembly.Memory({ initial: 1, maximum: 1 })
      let getMemoryCalls = 0
      let beforeInitCalls = 0
      let overwriteReceiver
      const frozenOptions = Object.freeze({
        context,
        asyncWorkPoolSize: 0,
        getMemory(exports) {
          getMemoryCalls += 1
          return getMemoryCalls === 1 ? exports.memory : decoyMemory
        },
        beforeInit() {
          beforeInitCalls += 1
        },
        overwriteImports(importObject) {
          overwriteReceiver = this
          return Object.freeze({
            ...importObject,
            env: Object.freeze({
              ...importObject.env,
              ...importObject.napi,
              ...importObject.emnapi,
              memory,
            }),
          })
        },
      })
      const { napiModule } = runtime.instantiateNapiModuleSync(
        abCopyModules.unshared,
        frozenOptions,
      )
      assert.equal(overwriteReceiver, frozenOptions)
      assert.equal(getMemoryCalls, 1)
      assert.equal(beforeInitCalls, 1)
      assert.ok(napiModule.exports.copied instanceof ArrayBuffer)
      assert.equal(
        new TextDecoder().decode(new Uint8Array(napiModule.exports.copied)),
        'hello-ab-copy',
      )
    }

    // 5. Options object frozen mid-instantiation from a getter (`get getTable()`)
    //    plus a one-shot getter for `getMemory` (must not run on descriptor
    //    inspection or run twice through outer Proxies):
    {
      const context = createTestContext(runtime, t)
      const memory = new WebAssembly.Memory({ initial: 1, maximum: 4 })
      let getMemoryGetterReads = 0
      let getMemoryCalls = 0
      let beforeInitCalls = 0
      const dynamicOptions = {
        context,
        asyncWorkPoolSize: 0,
        get getTable() {
          Object.freeze(this)
          return undefined
        },
        get getMemory() {
          getMemoryGetterReads += 1
          if (getMemoryGetterReads > 1) {
            throw new Error('getMemory getter read more than once')
          }
          return (exports) => {
            getMemoryCalls += 1
            return exports.memory
          }
        },
        beforeInit() {
          beforeInitCalls += 1
        },
        overwriteImports(importObject) {
          return {
            ...importObject,
            env: {
              ...importObject.env,
              ...importObject.napi,
              ...importObject.emnapi,
              memory,
            },
          }
        },
      }
      const { napiModule } = runtime.instantiateNapiModuleSync(
        abCopyModules.unshared,
        dynamicOptions,
      )
      assert.equal(Object.isFrozen(dynamicOptions), true)
      assert.equal(getMemoryGetterReads, 1)
      assert.equal(getMemoryCalls, 1)
      assert.equal(beforeInitCalls, 1)
      assert.equal(
        new TextDecoder().decode(new Uint8Array(napiModule.exports.copied)),
        'hello-ab-copy',
      )
    }

    // 6. Inherited prototype `#privateField` `memory` getter on `env` (sync +
    //    async) must keep the original `env` instance as receiver when cloned
    //    for the fallback shim.
    for (const asyncMode of [false, true]) {
      const context = createTestContext(runtime, t)
      const memory = new WebAssembly.Memory({ initial: 1, maximum: 4 })
      let protoGetterReads = 0
      class ProtoPrivateEnv {
        #mem
        constructor(mem, funcs) {
          this.#mem = mem
          Object.assign(this, funcs)
        }
        get memory() {
          protoGetterReads += 1
          return this.#mem
        }
      }
      const options = {
        context,
        asyncWorkPoolSize: 0,
        overwriteImports(importObject) {
          const protoEnv = Object.freeze(
            new ProtoPrivateEnv(memory, {
              napi_create_string_utf8:
                importObject.napi.napi_create_string_utf8,
              napi_set_named_property:
                importObject.napi.napi_set_named_property,
              napi_get_and_clear_last_exception:
                importObject.napi.napi_get_and_clear_last_exception,
              napi_create_arraybuffer:
                importObject.napi.napi_create_arraybuffer,
              emnapi_sync_memory: importObject.emnapi.emnapi_sync_memory,
            }),
          )
          return Object.freeze({
            ...importObject,
            env: protoEnv,
          })
        },
      }
      const { napiModule } = asyncMode
        ? await runtime.instantiateNapiModule(
            abCopyModules.unsharedNoExport,
            options,
          )
        : runtime.instantiateNapiModuleSync(
            abCopyModules.unsharedNoExport,
            options,
          )
      assert.equal(protoGetterReads, 1)
      assert.equal(
        new TextDecoder().decode(new Uint8Array(napiModule.exports.copied)),
        'hello-ab-copy',
      )
    }

    // 7. Async instantiation with imported, non-exported memory and a stateful
    //    `env.memory` getter that switches from memoryA to memoryB on a 2nd read:
    //    must read `env.memory` strictly once so Wasm, `@emnapi/core`, and the
    //    fallback shim all share memoryA without trapping.
    for (const omitFallbackFromEnv of [false, true]) {
      const context = createTestContext(runtime, t)
      const memoryA = new WebAssembly.Memory({ initial: 1, maximum: 4 })
      const memoryB = new WebAssembly.Memory({ initial: 1, maximum: 4 })
      let memoryReads = 0
      const { napiModule } = await runtime.instantiateNapiModule(
        abCopyModules.unsharedNoExport,
        {
          context,
          asyncWorkPoolSize: 0,
          overwriteImports(importObject) {
            const env = omitFallbackFromEnv
              ? {
                  napi_create_string_utf8:
                    importObject.napi.napi_create_string_utf8,
                  napi_set_named_property:
                    importObject.napi.napi_set_named_property,
                  napi_get_and_clear_last_exception:
                    importObject.napi.napi_get_and_clear_last_exception,
                  napi_create_arraybuffer:
                    importObject.napi.napi_create_arraybuffer,
                  emnapi_sync_memory: importObject.emnapi.emnapi_sync_memory,
                }
              : {
                  ...importObject.env,
                  ...importObject.napi,
                  ...importObject.emnapi,
                }
            Object.defineProperty(env, 'memory', {
              get() {
                memoryReads += 1
                return memoryReads === 1 ? memoryA : memoryB
              },
              enumerable: true,
              configurable: false,
            })
            return {
              ...importObject,
              env,
            }
          },
        },
      )
      assert.equal(memoryReads, 1)
      assert.equal(
        new TextDecoder().decode(new Uint8Array(napiModule.exports.copied)),
        'hello-ab-copy',
      )
    }

    // 8. `overwriteImports(importObject)` calling `Object.freeze(importObject)`
    //    or `Object.defineProperty(importObject, 'extra', { configurable: false, value: {} })`
    //    directly on the object passed into the hook must work without Proxy
    //    invariant TypeErrors.
    {
      const context = createTestContext(runtime, t)
      const memory = new WebAssembly.Memory({ initial: 1, maximum: 4 })
      const { napiModule } = runtime.instantiateNapiModuleSync(
        abCopyModules.unshared,
        {
          context,
          asyncWorkPoolSize: 0,
          overwriteImports(importObject) {
            importObject.env = {
              ...importObject.env,
              ...importObject.napi,
              ...importObject.emnapi,
              memory,
            }
            return Object.freeze(importObject)
          },
        },
      )
      assert.equal(
        new TextDecoder().decode(new Uint8Array(napiModule.exports.copied)),
        'hello-ab-copy',
      )
    }
    {
      const context = createTestContext(runtime, t)
      const memory = new WebAssembly.Memory({ initial: 1, maximum: 4 })
      let capturedExtra
      const { napiModule } = runtime.instantiateNapiModuleSync(
        abCopyModules.unshared,
        {
          context,
          asyncWorkPoolSize: 0,
          overwriteImports(importObject) {
            importObject.env = {
              ...importObject.env,
              ...importObject.napi,
              ...importObject.emnapi,
              memory,
            }
            Object.defineProperty(importObject, 'extra', {
              configurable: false,
              enumerable: true,
              value: { tag: 'non-configurable' },
            })
            capturedExtra = importObject.extra
            return importObject
          },
        },
      )
      assert.deepEqual(capturedExtra, { tag: 'non-configurable' })
      assert.equal(
        new TextDecoder().decode(new Uint8Array(napiModule.exports.copied)),
        'hello-ab-copy',
      )
    }

    // 9. Proxy-backed `env` returned from `overwriteImports` that lazily
    //    supplies required Wasm host imports through its `get` trap:
    //    (a) when our fallback shim is installed (either omitted from `env`,
    //        spread from `importObject.emnapi`, or wrapped in a caller
    //        delegating tracer returned inside an `env`-only outer Proxy), and
    //    (b) when the caller supplies its own custom `emnapi_create_arraybuffer_copy`.
    for (const mode of [
      'fallback-omitted',
      'fallback-spread',
      'delegating-wrapper',
      'custom-copy',
    ]) {
      const context = createTestContext(runtime, t)
      const memory = new WebAssembly.Memory({ initial: 1, maximum: 4 })
      let lazyLookupCount = 0
      let customCopyCalls = 0
      let delegatingCalls = 0
      let customInstance
      const { napiModule } = await runtime.instantiateNapiModule(
        abCopyModules.unsharedNoExport,
        {
          context,
          asyncWorkPoolSize: 0,
          beforeInit({ instance }) {
            customInstance = instance
          },
          overwriteImports(importObject) {
            const backing = {
              memory,
              napi_set_named_property:
                importObject.napi.napi_set_named_property,
              napi_get_and_clear_last_exception:
                importObject.napi.napi_get_and_clear_last_exception,
              napi_create_arraybuffer:
                importObject.napi.napi_create_arraybuffer,
              emnapi_sync_memory: importObject.emnapi.emnapi_sync_memory,
            }
            if (mode === 'fallback-spread') {
              backing.emnapi_create_arraybuffer_copy =
                importObject.emnapi.emnapi_create_arraybuffer_copy
            } else if (mode === 'delegating-wrapper') {
              const origCopy =
                importObject.emnapi.emnapi_create_arraybuffer_copy
              backing.emnapi_create_arraybuffer_copy = (...args) => {
                delegatingCalls += 1
                return origCopy(...args)
              }
            } else if (mode === 'custom-copy') {
              backing.emnapi_create_arraybuffer_copy = (
                env,
                data,
                len,
                result,
              ) => {
                customCopyCalls += 1
                data >>>= 0
                len >>>= 0
                result >>>= 0
                if (!result) {
                  return importObject.napi.napi_create_arraybuffer(env, 0, 0, 0)
                }
                if (len === 0) {
                  return importObject.napi.napi_create_arraybuffer(
                    env,
                    0,
                    0,
                    result,
                  )
                }
                if (!data || data + len > memory.buffer.byteLength) {
                  return 1
                }
                const outPtr = customInstance.exports.malloc(4) >>> 0
                try {
                  const status = importObject.napi.napi_create_arraybuffer(
                    env,
                    len,
                    outPtr,
                    result,
                  )
                  if (status !== 0) return status
                  const dstPtr = new DataView(memory.buffer).getUint32(
                    outPtr,
                    true,
                  )
                  new Uint8Array(memory.buffer).copyWithin(
                    dstPtr,
                    data,
                    data + len,
                  )
                  return importObject.emnapi.emnapi_sync_memory(
                    env,
                    0,
                    result,
                    0,
                    len,
                  )
                } finally {
                  customInstance.exports.free(outPtr)
                }
              }
            }
            // Supply `napi_create_string_utf8` ONLY via the Proxy `get` trap
            // (absent from own properties on `backing`) so any clone that drops
            // Proxy traps throws `WebAssembly.LinkError`. For `delegating-wrapper`,
            // also supply `memory` lazily via `get` (absent from `backing` so
            // `Reflect.has(proxyEnv, 'memory')` is `false` until read).
            if (mode === 'delegating-wrapper') {
              delete backing.memory
            }
            let lazyMemory
            const proxyEnv = new Proxy(backing, {
              get(target, prop, receiver) {
                if (prop === 'napi_create_string_utf8') {
                  lazyLookupCount += 1
                  return importObject.napi.napi_create_string_utf8
                }
                if (mode === 'delegating-wrapper' && prop === 'memory') {
                  lazyMemory ??= memory
                  return lazyMemory
                }
                return Reflect.get(target, prop, receiver)
              },
            })
            if (mode === 'delegating-wrapper') {
              // Outer env-only Proxy that rejects reads of unused namespaces
              // (such as `emnapi`), ensuring post-hook logic only inspects `env`.
              return new Proxy(
                { env: proxyEnv },
                {
                  get(target, prop, receiver) {
                    if (prop !== 'env') {
                      throw new Error(
                        `Unexpected namespace read: ${String(prop)}`,
                      )
                    }
                    return Reflect.get(target, prop, receiver)
                  },
                },
              )
            }
            return {
              ...importObject,
              env: proxyEnv,
            }
          },
        },
      )
      assert.ok(
        lazyLookupCount >= 1,
        `${mode}: Proxy get trap must supply napi_create_string_utf8`,
      )
      if (mode === 'delegating-wrapper') {
        assert.ok(delegatingCalls >= 1)
      }
      if (mode === 'custom-copy') {
        assert.ok(customCopyCalls >= 1)
      }
      assert.equal(
        new TextDecoder().decode(new Uint8Array(napiModule.exports.copied)),
        'hello-ab-copy',
      )
    }
  }
})

test('prepareInstantiateOptions preserves lazy descriptors and read-only emnapi slots', async () => {
  const { prepareInstantiateOptions } = await import(
    pathToFileURL(join(runtimeDirectory, 'dist/emnapi-compat.js')).href
  )

  // Enumerating keys of a frozen options object must never invoke a getter.
  let getterInvoked = 0
  const frozenWithGetter = Object.freeze({
    get getMemory() {
      getterInvoked += 1
      return () => undefined
    },
    overwriteImports(imp) {
      return imp
    },
  })
  const { options: wrapped } = prepareInstantiateOptions(frozenWithGetter)
  assert.deepEqual(Object.keys(wrapped).sort(), [
    'getMemory',
    'overwriteImports',
  ])
  assert.equal(getterInvoked, 0)

  // Extensible `importObject.emnapi` with a read-only `emnapi_create_arraybuffer_copy: undefined`
  // must not throw when installing the fallback, and must still honor a caller's `env` override.
  const customCopy = () => 0
  const { options: roWrapped } = prepareInstantiateOptions(
    Object.freeze({
      overwriteImports(imp) {
        assert.equal(
          typeof imp.emnapi.emnapi_create_arraybuffer_copy,
          'function',
        )
        return {
          ...imp,
          env: {
            ...imp.env,
            emnapi_create_arraybuffer_copy: customCopy,
          },
        }
      },
    }),
  )
  const roEmnapi = { emnapi_sync_memory: () => 0 }
  Object.defineProperty(roEmnapi, 'emnapi_create_arraybuffer_copy', {
    value: undefined,
    writable: false,
    enumerable: true,
    configurable: false,
  })
  const out = roWrapped.overwriteImports({
    env: {},
    napi: { napi_create_arraybuffer: () => 0 },
    emnapi: roEmnapi,
  })
  assert.equal(roEmnapi.emnapi_create_arraybuffer_copy, undefined)
  assert.equal(out.env.emnapi_create_arraybuffer_copy, customCopy)

  // Reused sealed `importObject.emnapi` across two loads must never leak the
  // first load's instance-bound shim into the second load.
  const sharedSealedEmnapi = Object.seal({
    emnapi_sync_memory: () => 0,
    emnapi_create_arraybuffer_copy: undefined,
  })
  const firstSeen = []
  const { options: load1 } = prepareInstantiateOptions({
    overwriteImports(imp) {
      firstSeen.push(imp.emnapi.emnapi_create_arraybuffer_copy)
      // Void hook replacing `env` in place: edits must survive on the returned clone.
      imp.env = { ...imp.env, custom: 1 }
    },
  })
  const out1 = load1.overwriteImports({
    env: {},
    napi: { napi_create_arraybuffer: () => 0 },
    emnapi: sharedSealedEmnapi,
  })
  assert.equal(sharedSealedEmnapi.emnapi_create_arraybuffer_copy, undefined)
  assert.equal(out1.env.custom, 1)
  const { options: load2 } = prepareInstantiateOptions({
    overwriteImports(imp) {
      firstSeen.push(imp.emnapi.emnapi_create_arraybuffer_copy)
      return imp
    },
  })
  load2.overwriteImports({
    env: {},
    napi: { napi_create_arraybuffer: () => 0 },
    emnapi: sharedSealedEmnapi,
  })
  assert.equal(typeof firstSeen[0], 'function')
  assert.equal(typeof firstSeen[1], 'function')
  assert.notEqual(firstSeen[0], firstSeen[1])

  // Inherited read-only `emnapi_create_arraybuffer_copy` on prototype must not throw.
  const protoWithReadonlySlot = {}
  Object.defineProperty(
    protoWithReadonlySlot,
    'emnapi_create_arraybuffer_copy',
    {
      value: undefined,
      writable: false,
      enumerable: true,
      configurable: false,
    },
  )
  const inheritedEmnapi = Object.create(protoWithReadonlySlot)
  inheritedEmnapi.emnapi_sync_memory = () => 0
  const outInherited = prepareInstantiateOptions({}).options.overwriteImports({
    env: {},
    napi: { napi_create_arraybuffer: () => 0 },
    emnapi: inheritedEmnapi,
  })
  assert.equal(
    typeof outInherited.emnapi.emnapi_create_arraybuffer_copy,
    'function',
  )
  assert.equal(inheritedEmnapi.emnapi_create_arraybuffer_copy, undefined)

  // Non-enumerable own imports (such as `memory`) on a frozen `env` must survive cloning.
  const fakeMemory = new WebAssembly.Memory({ initial: 1, maximum: 1 })
  const nonEnumEnv = { emnapi_sync_memory: () => 0 }
  Object.defineProperty(nonEnumEnv, 'memory', {
    value: fakeMemory,
    writable: false,
    enumerable: false,
    configurable: false,
  })
  Object.defineProperty(nonEnumEnv, 'emnapi_create_arraybuffer_copy', {
    value: undefined,
    writable: false,
    enumerable: true,
    configurable: false,
  })
  Object.freeze(nonEnumEnv)
  const outNonEnum = prepareInstantiateOptions({
    overwriteImports(imp) {
      return Object.freeze({ ...imp, env: nonEnumEnv })
    },
  }).options.overwriteImports({
    env: {},
    napi: { napi_create_arraybuffer: () => 0 },
    emnapi: { emnapi_sync_memory: () => 0 },
  })
  assert.equal(outNonEnum.env.memory, fakeMemory)
  assert.equal(typeof outNonEnum.env.emnapi_create_arraybuffer_copy, 'function')

  // Accessor-backed imports relying on the original receiver (e.g. private fields)
  // must keep their receiver when cloned.
  const ownPrivateEnv = new (class {
    #mem = fakeMemory
    emnapi_sync_memory = () => 0
    get memory() {
      return this.#mem
    }
  })()
  Object.defineProperty(ownPrivateEnv, 'memory', {
    get: Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(ownPrivateEnv),
      'memory',
    ).get,
    enumerable: true,
    configurable: false,
  })
  Object.freeze(ownPrivateEnv)
  const outPrivate = prepareInstantiateOptions({
    overwriteImports(imp) {
      return Object.freeze({ ...imp, env: ownPrivateEnv })
    },
  }).options.overwriteImports({
    env: {},
    napi: { napi_create_arraybuffer: () => 0 },
    emnapi: { emnapi_sync_memory: () => 0 },
  })
  assert.equal(outPrivate.env.memory, fakeMemory)
  assert.equal(typeof outPrivate.env.emnapi_create_arraybuffer_copy, 'function')

  // Inherited prototype `#privateField` getter must stay out of own-key
  // enumeration while keeping `target` as receiver and running at most once,
  // and own symbols + non-enumerable properties must survive intact.
  const ownSym = Symbol('envTag')
  let inheritedReads = 0
  class InheritedPrivateEnv {
    #mem
    #tag = 'private-proto-getter'
    constructor(mem) {
      this.#mem = mem
      this.emnapi_sync_memory = () => 0
      this[ownSym] = 'kept'
      Object.defineProperty(this, 'hidden', {
        value: 42,
        enumerable: false,
        writable: false,
        configurable: false,
      })
    }
    get memory() {
      inheritedReads += 1
      return this.#mem
    }
    get tag() {
      return this.#tag
    }
  }
  const protoPrivateEnv = Object.freeze(new InheritedPrivateEnv(fakeMemory))
  const outProtoPrivate = prepareInstantiateOptions({
    overwriteImports(imp) {
      Object.defineProperty(imp, 'extra', {
        configurable: false,
        value: { ok: true },
      })
      return Object.freeze({ ...imp, env: protoPrivateEnv })
    },
  }).options.overwriteImports({
    env: {},
    napi: { napi_create_arraybuffer: () => 0 },
    emnapi: { emnapi_sync_memory: () => 0 },
  })
  assert.equal(outProtoPrivate.env instanceof InheritedPrivateEnv, true)
  assert.equal('memory' in outProtoPrivate.env, true)
  assert.equal(outProtoPrivate.env.memory, fakeMemory)
  assert.equal(outProtoPrivate.env.memory, fakeMemory)
  assert.equal(inheritedReads, 1)
  assert.equal(outProtoPrivate.env.tag, 'private-proto-getter')
  assert.equal(outProtoPrivate.env[ownSym], 'kept')
  assert.equal(outProtoPrivate.env.hidden, 42)
  assert.equal(Object.keys(outProtoPrivate.env).includes('memory'), false)
  assert.equal(Object.keys(outProtoPrivate.env).includes('tag'), false)
  assert.equal(Object.keys(outProtoPrivate.env).includes('hidden'), false)
  assert.equal(
    Object.getOwnPropertyNames(outProtoPrivate.env).includes('memory'),
    false,
  )
  assert.equal(
    Object.getOwnPropertyNames(outProtoPrivate.env).includes('tag'),
    false,
  )
  assert.equal(
    Object.getOwnPropertyNames(outProtoPrivate.env).includes('hidden'),
    true,
  )
  assert.deepEqual(Object.getOwnPropertySymbols(outProtoPrivate.env), [ownSym])
  assert.equal(Reflect.ownKeys(outProtoPrivate.env).includes('memory'), false)
  assert.equal(Reflect.ownKeys(outProtoPrivate.env).includes('tag'), false)
  assert.equal(
    typeof outProtoPrivate.env.emnapi_create_arraybuffer_copy,
    'function',
  )
  // Pre-hook `importObject` passed to `overwriteImports` must be a real object
  // supporting `Object.freeze` and non-configurable `defineProperty`.
  assert.doesNotThrow(() =>
    prepareInstantiateOptions({
      overwriteImports(imp) {
        return Object.freeze(imp)
      },
    }).options.overwriteImports({
      env: {},
      napi: { napi_create_arraybuffer: () => 0 },
      emnapi: { emnapi_sync_memory: () => 0 },
    }),
  )

  // Caller supplying a custom/delegating `emnapi_create_arraybuffer_copy` on `env`
  // keeps its exact function while reading `env.memory` at most once (pinned).
  const customEnvCopy = () => 0
  let customEnvMemoryReads = 0
  const customEnv = {
    emnapi_create_arraybuffer_copy: customEnvCopy,
    get memory() {
      customEnvMemoryReads += 1
      return fakeMemory
    },
  }
  const envOnlyOuterProxy = new Proxy(
    { env: customEnv },
    {
      get(target, prop, receiver) {
        if (prop !== 'env') {
          throw new Error(`Unexpected namespace access: ${String(prop)}`)
        }
        return Reflect.get(target, prop, receiver)
      },
    },
  )
  const outCustom = prepareInstantiateOptions({
    overwriteImports() {
      return envOnlyOuterProxy
    },
  }).options.overwriteImports({
    env: {},
    napi: { napi_create_arraybuffer: () => 0 },
    emnapi: { emnapi_sync_memory: () => 0 },
  })
  assert.equal(outCustom.env.emnapi_create_arraybuffer_copy, customEnvCopy)
  assert.equal(outCustom.env.memory, fakeMemory)
  assert.equal(outCustom.env.memory, fakeMemory)
  assert.equal(customEnvMemoryReads, 1)

  // Plugin supplying lazy imports via a Proxy-backed `importObject.emnapi`
  // must keep Proxy `get` lookups working for BOTH virtual keys AND existing
  // own placeholder keys (e.g. `{ placeholder_fn: undefined }`) when spread
  // into `env`, while still letting hooks freeze the cloned table.
  let lazyEmnapiLookups = 0
  const lazyHostFn = () => 77
  const placeholderHostFn = () => 88
  const proxyEmnapi = new Proxy(
    { emnapi_sync_memory: () => 0, placeholder_fn: undefined },
    {
      get(target, prop, receiver) {
        if (prop === 'lazy_plugin_import') {
          lazyEmnapiLookups += 1
          return lazyHostFn
        }
        if (prop === 'placeholder_fn') {
          return placeholderHostFn
        }
        return Reflect.get(target, prop, receiver)
      },
    },
  )
  let spreadPlaceholder
  const outProxyEmnapi = prepareInstantiateOptions({
    overwriteImports(imp) {
      assert.equal(imp.emnapi.lazy_plugin_import, lazyHostFn)
      assert.equal(typeof imp.emnapi.emnapi_create_arraybuffer_copy, 'function')
      spreadPlaceholder = { ...imp.emnapi }.placeholder_fn
      return Object.freeze(imp)
    },
  }).options.overwriteImports({
    env: {},
    napi: { napi_create_arraybuffer: () => 0 },
    emnapi: proxyEmnapi,
  })
  assert.equal(spreadPlaceholder, placeholderHostFn)
  assert.equal(outProxyEmnapi.emnapi.lazy_plugin_import, lazyHostFn)
  assert.equal(outProxyEmnapi.emnapi.placeholder_fn, placeholderHostFn)
  assert.ok(lazyEmnapiLookups >= 2)

  // When `env` does not provide `memory` (e.g. Wasm exports its own memory),
  // cloning `env` for the fallback must not inject a synthetic `memory: undefined`.
  const noMemoryEnv = Object.freeze({ emnapi_sync_memory: () => 0 })
  const outNoMemory = prepareInstantiateOptions({
    overwriteImports(imp) {
      return Object.freeze({ ...imp, env: noMemoryEnv })
    },
  }).options.overwriteImports({
    env: {},
    napi: { napi_create_arraybuffer: () => 0 },
    emnapi: { emnapi_sync_memory: () => 0 },
  })
  assert.equal('memory' in outNoMemory.env, false)
  assert.equal(
    typeof outNoMemory.env.emnapi_create_arraybuffer_copy,
    'function',
  )
})
