const fs = require('node:fs')
const nodeWorkerThreads = require('node:worker_threads')

const emnapiCore = require('@emnapi/core')
const { WASI } = require('@tybys/wasm-util')

const parentPort = nodeWorkerThreads.parentPort

parentPort.on('message', (data) => {
  globalThis.onmessage({ data })
})


Object.assign(globalThis, {
  self: globalThis,
  require,
  Worker: nodeWorkerThreads.Worker,
  importScripts: function (f) {
    (0, eval)(fs.readFileSync(f, 'utf8') + '//# sourceURL=' + f)
  },
  postMessage: function (msg) {
    parentPort.postMessage(msg)
  }
})

const { instantiateNapiModuleSync, MessageHandler } = emnapiCore

const handler = new MessageHandler({
  onLoad ({ wasmModule, wasmMemory }) {
    const wasi = new WASI({ fs })

    return instantiateNapiModuleSync(wasmModule, {
      childThread: true,
      wasi,
      overwriteImports (importObject) {
        importObject.env = {
          ...importObject.env,
          ...importObject.napi,
          ...importObject.emnapi,
          memory: wasmMemory,
        }
      }
    })
  }
})

globalThis.onmessage = function (e) {
  handler.handle(e)
}
