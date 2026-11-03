import {
  Worker,
  isMainThread,
  parentPort,
  workerData,
} from 'node:worker_threads'
import { fileURLToPath } from 'node:url'

import native from '../index.cjs'

// Each worker queues tasks and blocks its event loop, so every completion runs during
// `terminate()`, while the env refuses to run JavaScript. The addon image is shared with the
// worker, so the counters below see the worker's tasks too.
//
// Modes (argv[2]):
// * `blocked`: the worker blocks before its microtasks drain, so no promise's `then` has run
//   and teardown frees settle states that never held resolving functions.
// * `then-ran`: the worker blocks inside a microtask queued after every promise's `then` job,
//   so each state holds the promise's resolving functions when teardown refuses to call them,
//   and they must be released anyway.
const TASKS_PER_WORKER = 2000
const WORKERS = 5

function block() {
  parentPort.postMessage('queued')
  const start = Date.now()
  while (Date.now() - start < 60_000) {}
}

if (!isMainThread) {
  for (let i = 0; i < TASKS_PER_WORKER; i++) {
    native.asyncTaskCounted().catch(() => {})
  }
  if (workerData.mode === 'then-ran') {
    queueMicrotask(block)
  } else {
    block()
  }
} else {
  const mode = process.argv[2] ?? 'blocked'
  if (mode !== 'blocked' && mode !== 'then-ran') {
    throw new Error(`unknown mode ${mode}`)
  }
  const before = native.asyncTaskSettleCounters()
  for (let i = 0; i < WORKERS; i++) {
    const worker = new Worker(fileURLToPath(import.meta.url), {
      env: process.env,
      workerData: { mode },
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
  const resolversReleased =
    after.promiseResolversReleased - before.promiseResolversReleased
  const expectedResolvers = mode === 'then-ran' ? created : 0
  if (
    created !== TASKS_PER_WORKER * WORKERS ||
    dropped !== created ||
    promiseStatesFreed !== created ||
    resolversReleased !== expectedResolvers
  ) {
    console.error({
      mode,
      created,
      dropped,
      promiseStatesFreed,
      resolversReleased,
    })
    process.exit(1)
  }
  console.log(
    `dropped every AsyncTask and freed its promise state on worker terminate (${mode})`,
  )
}
