import assert from 'node:assert/strict'
import { EventEmitter, once } from 'node:events'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
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
  // Contexts retain a one-shot beforeExit hook even after explicit destroy.
  // Remove only this test's hook once its context has been destroyed.
  const existingHooks = new Set(process.listeners('beforeExit'))
  const context = runtime.createContext()
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
  // v2 reports preload failures through the instantiation promise.
  if (coreVersion.startsWith('2.')) {
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
