import { Worker, isMainThread, parentPort } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'

import native from '../index.cjs'

// Each worker queues tasks and blocks its event loop, so every completion runs during
// `terminate()`, while the env refuses to run JavaScript. The addon image is shared with the
// worker, so the counters below see the worker's tasks too.
const TASKS_PER_WORKER = 2000
const WORKERS = 5

if (!isMainThread) {
  for (let i = 0; i < TASKS_PER_WORKER; i++) {
    native.asyncTaskCounted().catch(() => {})
  }
  parentPort.postMessage('queued')
  const start = Date.now()
  while (Date.now() - start < 60_000) {}
} else {
  const before = native.asyncTaskSettleCounters()
  for (let i = 0; i < WORKERS; i++) {
    const worker = new Worker(fileURLToPath(import.meta.url), {
      env: process.env,
    })
    await new Promise((resolve, reject) => {
      worker.once('message', resolve)
      worker.once('error', reject)
    })
    await worker.terminate()
  }
  const after = native.asyncTaskSettleCounters()
  const created = after.created - before.created
  const dropped = after.dropped - before.dropped
  // Each promise's deferred was settled when the task was created, and its settle state was
  // freed even though teardown refused the settlement. A `napi_create_promise` deferred settled
  // only there is refused, and never freed.
  const promiseStatesFreed =
    after.promiseStatesFreed - before.promiseStatesFreed
  if (
    created !== TASKS_PER_WORKER * WORKERS ||
    dropped !== created ||
    promiseStatesFreed !== created
  ) {
    console.error({ created, dropped, promiseStatesFreed })
    process.exit(1)
  }
  console.log(
    'dropped every AsyncTask and freed its promise state on worker terminate',
  )
}
