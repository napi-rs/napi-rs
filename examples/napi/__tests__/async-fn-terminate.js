import {
  Worker,
  isMainThread,
  parentPort,
  workerData,
} from 'node:worker_threads'
import { fileURLToPath } from 'node:url'

import native from '../index.cjs'

// `#[napi] async fn` promises (`JsDeferred`) in a worker are made without a `napi_deferred`, so a
// worker terminated before they settle leaves nothing behind: every promise's settle state is
// freed, settled or not. A `napi_create_promise` deferred that is never settled stays for ever
// (16 B each). The addon image is shared with the worker, so the counters below see the worker's
// calls too.
//
// Modes (argv[2]):
// * `settled`: every promise settles before the worker is terminated (control).
// * `inflight`: the futures are still sleeping when the worker is terminated; they finish later,
//   off the JS thread, and their settle finds the threadsafe function gone.
// * `queued`: the futures finish while the worker's JS thread is blocked, after every promise's
//   `then` ran, so each settle is queued and each state holds the promise's resolving functions
//   when teardown refuses to call them.
// * `blocked`: the same, but the JS thread blocks before any `then` ran.
const CALLS_PER_WORKER = 1000
const WORKERS = 5
const MODES = ['settled', 'inflight', 'queued', 'blocked']

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function block() {
  parentPort.postMessage('ready')
  const start = Date.now()
  while (Date.now() - start < 60_000) {}
}

if (!isMainThread) {
  const { mode } = workerData
  const settleMode = native.asyncTaskPromiseSettleMode()
  if (settleMode !== 'thenable') {
    throw new Error(`worker settle mode is ${settleMode}`)
  }
  const ms = mode === 'inflight' ? 1000 : 50
  const promises = []
  for (let i = 0; i < CALLS_PER_WORKER; i++) {
    promises.push(native.asyncFnSleep(ms))
  }
  if (mode === 'blocked') {
    block()
  } else if (mode === 'settled') {
    const values = await Promise.all(promises)
    if (values.some((value) => value !== ms)) {
      throw new Error('an async fn resolved with the wrong value')
    }
    parentPort.postMessage('ready')
    setInterval(() => {}, 1000)
  } else {
    // A macrotask: every promise's `then` job has run.
    await sleep(0)
    if (mode === 'queued') {
      block()
    } else {
      parentPort.postMessage('ready')
      setInterval(() => {}, 1000)
    }
  }
} else {
  const mode = process.argv[2] ?? 'inflight'
  if (!MODES.includes(mode)) {
    throw new Error(`unknown mode ${mode}`)
  }
  const before = native.asyncTaskSettleCounters()
  const total = CALLS_PER_WORKER * WORKERS
  const finished = () =>
    native.asyncTaskSettleCounters().asyncFnSleepsFinished -
    before.asyncFnSleepsFinished
  for (let i = 0; i < WORKERS; i++) {
    const worker = new Worker(fileURLToPath(import.meta.url), {
      env: process.env,
      workerData: { mode },
    })
    await new Promise((resolve, reject) => {
      worker.once('message', resolve)
      worker.once('error', reject)
    })
    if (mode === 'queued' || mode === 'blocked') {
      // Every future of this worker finished, so every settle is queued behind the blocked JS
      // thread (the settle is queued right after the future returns).
      const deadline = Date.now() + 30_000
      while (finished() < (i + 1) * CALLS_PER_WORKER && Date.now() < deadline) {
        await sleep(5)
      }
      await sleep(100)
    }
    await worker.terminate()
  }
  // `inflight`: the futures finish after their worker is gone, and nothing may crash then.
  const deadline = Date.now() + 30_000
  while (finished() < total && Date.now() < deadline) await sleep(10)
  await sleep(100)
  const after = native.asyncTaskSettleCounters()
  const result = {
    mode,
    started: after.asyncFnSleepsStarted - before.asyncFnSleepsStarted,
    finished: after.asyncFnSleepsFinished - before.asyncFnSleepsFinished,
    thenableCreated:
      after.jsDeferredThenableCreated - before.jsDeferredThenableCreated,
    fallbacks: after.jsDeferredFallbacks - before.jsDeferredFallbacks,
    statesFreed: after.promiseStatesFreed - before.promiseStatesFreed,
    resolversReleased:
      after.promiseResolversReleased - before.promiseResolversReleased,
    wrappersCompiled:
      after.promiseWrappersCompiled - before.promiseWrappersCompiled,
  }
  const expected = {
    mode,
    started: total,
    finished: total,
    // Every promise was made by its worker's promise wrapper, compiled once per worker.
    thenableCreated: total,
    fallbacks: 0,
    // Each settle state was freed, settled, refused or never settled.
    statesFreed: total,
    // Each state whose `then` ran held the promise's resolving functions.
    resolversReleased: mode === 'blocked' ? 0 : total,
    wrappersCompiled: WORKERS,
  }
  if (JSON.stringify(result) !== JSON.stringify(expected)) {
    console.error(JSON.stringify({ result, expected }))
    process.exit(1)
  }
  console.log(
    `freed every async fn promise state on worker terminate (${mode})`,
  )
  process.exit(0)
}
