import { createRequire } from 'node:module'
import { workerData } from 'node:worker_threads'

const require = createRequire(import.meta.url)
const fixture = require('../index.cjs')

switch (workerData.mode) {
  case 'sync':
    fixture.registerSelfRemovingSyncCleanupHook(workerData.resultPath)
    break
  case 'async':
    fixture.registerSelfDroppingAsyncCleanupHook(workerData.resultPath)
    break
  default:
    throw new Error(`unknown cleanup hook ownership mode: ${workerData.mode}`)
}
