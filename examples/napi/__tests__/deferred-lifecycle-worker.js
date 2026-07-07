import { createRequire } from 'node:module'
import { parentPort, workerData } from 'node:worker_threads'

const require = createRequire(import.meta.url)
const fixture = require('../index.cjs')

if (workerData.mode === 'cleanup-order') {
  fixture.registerDeferredCleanupOrderProbe(workerData.resultPath)
} else if (workerData.mode === 'teardown-race') {
  fixture.startDeferredTeardownRace(
    workerData.readyPath,
    workerData.releasePath,
    workerData.donePath,
    workerData.count,
  )
} else {
  throw new Error(`unknown deferred lifecycle mode: ${workerData.mode}`)
}
parentPort.postMessage('ready')
