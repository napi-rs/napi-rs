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

const compileArrayBufferCopyModule = (shared) => {
  const module = wabt.parseWat(
    'ab-copy.wat',
    arrayBufferCopyWat.replace('MEMORY_SHARED', shared ? 'shared' : ''),
    { threads: true },
  )
  try {
    return new WebAssembly.Module(module.toBinary({}).buffer)
  } finally {
    module.destroy()
  }
}

const abCopyModules = {
  unshared: compileArrayBufferCopyModule(false),
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
  if (isV1 && typeof ctx.createEnv === 'function') {
    const realCreateEnv = ctx.createEnv
    ctx.createEnv = function (a, b, c, d, _e, _f) {
      return realCreateEnv.call(this, a, b, c, d)
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
export const { Context, createContext, getDefaultContext } = rt
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

for (const format of ['cjs', 'esm', 'node-esm']) {
  test(`${format}: emnapi_create_arraybuffer_copy works with native @emnapi/core ${coreVersion}`, async (t) => {
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
          expectShim: false,
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
