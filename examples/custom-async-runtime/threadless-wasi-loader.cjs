const fs = require('node:fs')
const path = require('node:path')
const { WASI } = require('node:wasi')

const {
  emnapiAsyncWorkPlugin,
  emnapiTSFNPlugin,
  instantiateNapiModuleSync,
} = require('@napi-rs/wasm-runtime')
const { createContext } = require('@emnapi/runtime')

const wasi = new WASI({
  version: 'preview1',
  env: process.env,
  preopens: {
    [path.parse(process.cwd()).root]: path.parse(process.cwd()).root,
  },
})
const context = createContext({ autoDestroy: false })
context.suppressDestroy()

let disposed = false
let cleanupPrepared = false
let cleanupRan = false
let cleanupDrained = false
let napiInstance
function prepareWasmEnvCleanup() {
  if (cleanupPrepared) return
  const prepare = napiInstance?.exports.napi_prepare_wasm_env_cleanup
  if (typeof prepare === 'function') {
    prepare()
    cleanupRan = true
  }
  cleanupPrepared = true
}
// Mirrors the generated loaders: the barrier only *queues* the settlements of
// the tasks it cancelled, and @emnapi/core dispatches that queue from a
// macrotask two coalescing turns later. `context.destroy()` drains the queue
// with a null env and discards whatever is left, so the loader has to yield
// real turns in between or it strands exactly the promises the barrier exists
// to settle.
async function drainWasmEnvCleanup() {
  if (cleanupDrained || !cleanupRan) return
  cleanupDrained = true
  const pending = napiInstance?.exports.napi_wasm_env_cleanup_pending
  const observable = typeof pending === 'function'
  const limit = observable ? 128 : 4
  for (let turn = 0; turn < limit; turn++) {
    if (observable && !pending()) return
    await new Promise((resolve) => setImmediate(resolve))
  }
}
function destroyContext() {
  if (disposed) return
  prepareWasmEnvCleanup()
  const result = context.destroy()
  disposed = true
  return result
}
function destroyContextOnExit() {
  try {
    destroyContext()
  } catch {}
}
process.once('exit', destroyContextOnExit)

const memory = new WebAssembly.Memory({
  initial: 4000,
  maximum: 65536,
})

let napiModule
try {
  ;({ instance: napiInstance, napiModule } = instantiateNapiModuleSync(
    fs.readFileSync(
      path.join(__dirname, 'custom_async_runtime.wasm32-wasip1.wasm'),
    ),
    {
      context,
      asyncWorkPoolSize: 0,
      plugins: [emnapiAsyncWorkPlugin, emnapiTSFNPlugin],
      wasi,
      overwriteImports(importObject) {
        importObject.env = {
          ...importObject.env,
          ...importObject.napi,
          ...importObject.emnapi,
          memory,
        }
        return importObject
      },
      beforeInit({ instance }) {
        for (const name of Object.keys(instance.exports)) {
          if (name.startsWith('__napi_register__')) {
            instance.exports[name]()
          }
        }
      },
    },
  ))
} catch (error) {
  process.removeListener('exit', destroyContextOnExit)
  try {
    destroyContext()
  } catch (cleanupError) {
    try {
      error.cause ??= cleanupError
    } catch {}
  }
  throw error
}

module.exports = {
  binding: napiModule.exports,
  // Exposed so the test can drive the pre-teardown barrier on its own and
  // observe that it ran *before* the context was destroyed. `dispose` still
  // calls it, and it is idempotent.
  prepareWasmEnvCleanup,
  hasWasmEnvCleanupExport:
    typeof napiInstance?.exports.napi_prepare_wasm_env_cleanup === 'function',
  hasWasmEnvCleanupPendingExport:
    typeof napiInstance?.exports.napi_wasm_env_cleanup_pending === 'function',
  async dispose() {
    process.removeListener('exit', destroyContextOnExit)
    prepareWasmEnvCleanup()
    await drainWasmEnvCleanup()
    await destroyContext()
  },
}
