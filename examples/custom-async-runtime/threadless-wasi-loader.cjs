const fs = require('node:fs')
const path = require('node:path')
const { WASI } = require('node:wasi')

const { instantiateNapiModuleSync } = require('@napi-rs/wasm-runtime')
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
function destroyContext() {
  if (disposed) return
  disposed = true
  return context.destroy()
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
  ;({ napiModule } = instantiateNapiModuleSync(
    fs.readFileSync(
      path.join(__dirname, 'custom_async_runtime.wasm32-wasip1.wasm'),
    ),
    {
      context,
      asyncWorkPoolSize: 0,
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
  async dispose() {
    process.removeListener('exit', destroyContextOnExit)
    await destroyContext()
  },
}
