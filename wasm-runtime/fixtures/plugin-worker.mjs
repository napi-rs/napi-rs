import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parentPort, workerData } from 'node:worker_threads'

const runtime =
  workerData.format === 'cjs'
    ? createRequire(import.meta.url)(
        join(workerData.runtimeDirectory, 'runtime.cjs'),
      )
    : await import(
        pathToFileURL(join(workerData.runtimeDirectory, 'runtime.js')).href
      )
const postMessage = (message) => parentPort.postMessage(message)
// emnapi's TSFN worker wakeup uses the Web Worker global, as generated
// napi-rs Node workers do.
globalThis.postMessage = postMessage
let instance
const handler = new runtime.MessageHandler({
  postMessage,
  onLoad({ wasmModule, wasmMemory }) {
    if (workerData.failLoad) throw new Error('fixture worker load failure')
    const source = runtime.instantiateNapiModuleSync(wasmModule, {
      childThread: true,
      postMessage,
      plugins: [runtime.emnapiAsyncWorkPlugin, runtime.emnapiTSFNPlugin],
      overwriteImports(imports) {
        imports.env.memory = wasmMemory
        imports.test = {
          workerMode: () => 1,
          event: (...event) => postMessage({ event }),
        }
      },
    })
    instance = source.instance
    return source
  },
})
parentPort.on('message', (message) => {
  if (message.callTSFN) {
    instance.exports.callTSFN(message.callTSFN, 43)
  } else {
    handler.handle({ data: message })
  }
})
