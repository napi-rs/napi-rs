import { createRequire } from 'node:module'
import { parentPort, workerData } from 'node:worker_threads'

const require = createRequire(import.meta.url)
process.env.NAPI_RS_FORCE_WASI = 'true'
const lifecycle = require('../index.cjs')

await lifecycle.startTokioWakerAfterCleanupProbe(
  workerData.enteredPath,
  workerData.releasePath,
  workerData.completedPath,
)
parentPort.postMessage({ type: 'ready' })
Atomics.wait(new Int32Array(workerData.blocker), 0, 0)
