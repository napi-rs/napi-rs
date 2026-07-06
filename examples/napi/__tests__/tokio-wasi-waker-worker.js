import { createRequire } from 'node:module'
import { parentPort, workerData } from 'node:worker_threads'

import { requireLifecycleFixture } from './lifecycle-fixture.js'

const require = createRequire(import.meta.url)
const { fixture: lifecycle } = requireLifecycleFixture(require, '../index.cjs')

await lifecycle.startTokioWakerAfterCleanupProbe(
  workerData.enteredPath,
  workerData.releasePath,
  workerData.completedPath,
)
parentPort.postMessage({ type: 'ready' })
Atomics.wait(new Int32Array(workerData.blocker), 0, 0)
