import { instantiateNapiModuleSync, MessageHandler } from '@emnapi/core'
import { WASI } from '@tybys/wasm-util'
import { Volume, createFsFromVolume } from 'memfs-browser'

const fs = createFsFromVolume(
  Volume.fromJSON({
    '/': null,
  }),
)

const handler = new MessageHandler({
  onLoad({ wasmModule, wasmMemory }) {
    const wasi = new WASI({
      fs,
      print: function () {
        console.log.apply(console, arguments)
      },
    })
    return instantiateNapiModuleSync(wasmModule, {
      childThread: true,
      wasi,
      overwriteImports(importObject) {
        importObject.env = {
          ...importObject.env,
          ...importObject.napi,
          ...importObject.emnapi,
          memory: wasmMemory,
        }
      },
    })
  },
})

globalThis.onmessage = function (e) {
  handler.handle(e)
}
