import { createRequire } from 'node:module'
import { parentPort, workerData } from 'node:worker_threads'

const require = createRequire(import.meta.url)
const addon = require(workerData.addonPath)

addon.startRetentionProbe(
  () => {},
  workerData.scenario,
  workerData.enteredPath,
  workerData.releasePath,
  workerData.completedPath,
)

parentPort.postMessage({ type: 'ready' })
Atomics.wait(new Int32Array(workerData.blocker), 0, 0)
