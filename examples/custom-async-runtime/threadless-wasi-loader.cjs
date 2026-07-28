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
let napiInstance
function prepareWasmEnvCleanup() {
  if (cleanupPrepared) return
  const prepare = napiInstance?.exports.napi_prepare_wasm_env_cleanup
  if (typeof prepare === 'function') {
    prepare()
  }
  cleanupPrepared = true
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
  async dispose() {
    process.removeListener('exit', destroyContextOnExit)
    await destroyContext()
  },
}
