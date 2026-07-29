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
// Mirrors the generated loaders. The barrier delivers every settlement it can
// reach from this thread, but a task cancelled on another thread can only
// *queue* its settlement, and @emnapi/core dispatches that queue from a
// macrotask two coalescing turns later. `context.destroy()` drains the queue
// with a null env and discards whatever is left, so a loader that can yield has
// to yield real turns in between rather than strand those.
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
  // How many settlements are still sitting in the threadsafe-function queue.
  // The barrier delivers everything it settles on this thread without going
  // through the queue at all, so right after it returns this reads zero and the
  // drain above has nothing to wait for.
  wasmEnvCleanupPending() {
    const pending = napiInstance?.exports.napi_wasm_env_cleanup_pending
    return typeof pending === 'function' ? pending() : undefined
  },
  // The teardown a host that cannot yield is stuck with: barrier and
  // `Context.destroy()` back to back, in one synchronous turn, with no chance
  // for @emnapi/core to dispatch anything in between. It is exactly what the
  // `process.on('exit')` handler above runs, and what a caller reaching for
  // `emnapiContext.destroy()` by hand gets.
  disposeSync() {
    process.removeListener('exit', destroyContextOnExit)
    return destroyContext()
  },
  async dispose() {
    process.removeListener('exit', destroyContextOnExit)
    prepareWasmEnvCleanup()
    await drainWasmEnvCleanup()
    await destroyContext()
  },
}
