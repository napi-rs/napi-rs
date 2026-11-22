// Drops `JsDeferred`s unsettled while JavaScript awaits their promises, then checks that nothing
// keeps those promises: each one, and what awaits it, must be collected. In deferred mode (the
// main thread of Node and Bun) the promise's `napi_deferred` used to pin it until the process
// exited. Dropped on the JavaScript thread, the promises stay pending: their awaiters must never
// resume or throw. Dropped on another thread, or as `async fn` tasks dropped by a runtime
// shutdown, they are rejected: each awaiter throws once.
// Usage: node --expose-gc <this file> <addon> <case> <main|worker|terminate|exit> <n>
// * case: drop | off-thread | async-shutdown | observe | polluted | late-handler
//   polluted: throwing getters on Object.prototype.then and .handle while the deferreds are
//   released. late-handler: handlers attached to half of the promises after their release.
// * main / worker: run there and wait until every promise was collected (or a deadline).
// * terminate: a worker attaches the awaiters, then blocks and is terminated.
// * exit: the main thread attaches the awaiters, then calls process.exit(0) at once.
// Prints one line, `deferred-abandon <json>`.
import { writeSync } from 'node:fs'
import {
  Worker,
  isMainThread,
  parentPort,
  workerData,
} from 'node:worker_threads'

const DEADLINE_MS = 20_000

const [addon, kase, where, nArg] = isMainThread
  ? process.argv.slice(2, 6)
  : workerData.args
const n = Number(nArg)

const gc = globalThis.gc ?? (() => globalThis.Bun.gc(true))

function load() {
  const module = { exports: {} }
  process.dlopen(module, addon)
  return module.exports
}

function report(result) {
  writeSync(1, `deferred-abandon ${JSON.stringify(result)}\n`)
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Polls `done` between gc passes. Counts, not time: the deadline only bounds a failure.
async function gcUntil(done) {
  const deadline = Date.now() + DEADLINE_MS
  while (!done()) {
    if (Date.now() > deadline) return false
    gc()
    await sleep(20)
  }
  return true
}

async function until(done) {
  const deadline = Date.now() + DEADLINE_MS
  while (!done()) {
    if (Date.now() > deadline) return false
    await sleep(1)
  }
  return true
}

const unhandled = []
process.on('unhandledRejection', (reason) => unhandled.push(String(reason)))

const counts = { collected: 0, resumed: 0, threw: 0, lateHandlerRuns: 0 }
const registry = new FinalizationRegistry(() => {
  counts.collected++
})

// One `then` reaction and one `await` per promise, as user code would.
function observe(promise) {
  registry.register(promise, 0)
  promise.then(
    () => counts.resumed++,
    () => counts.threw++,
  )
  ;(async () => {
    try {
      await promise
      counts.resumed++
    } catch {
      counts.threw++
    }
  })()
}

const getterCalls = { thenReads: 0, handleReads: 0 }
function pollute() {
  for (const key of ['then', 'handle']) {
    Object.defineProperty(Object.prototype, key, {
      configurable: true,
      get() {
        getterCalls[`${key}Reads`]++
        throw new Error(`Object.prototype.${key} was read`)
      },
    })
  }
}
function unpollute() {
  delete Object.prototype.then
  delete Object.prototype.handle
}

// The promises a case keeps strongly (late-handler only). The others are reachable only through
// their awaiters.
let kept = []

// Makes the n promises and hands each one to `observe`. Resolves with undefined: resolving with
// an object would read its `then`.
async function start(native) {
  switch (kase) {
    case 'drop':
      native.dropDeferredUnsettled(n).forEach(observe)
      return
    case 'polluted': {
      // The getters are installed first: each drop releases its deferred at once, inside the
      // native call, so that release runs with them.
      pollute()
      const promises = native.dropDeferredUnsettled(n)
      promises.forEach(observe)
      return
    }
    case 'observe':
      native.dropDeferredAfterObserve(n, observe)
      return
    case 'off-thread': {
      const before = native.deferredDropCounters().offThreadDropped
      native.dropDeferredOffThread(n, 0).forEach(observe)
      await until(
        () => native.deferredDropCounters().offThreadDropped - before >= n,
      )
      return
    }
    case 'async-shutdown': {
      const before = native.deferredDropCounters().pendingFuturesStarted
      for (let i = 0; i < n; i++) observe(native.asyncFnPendingForever())
      await until(
        () => native.deferredDropCounters().pendingFuturesStarted - before >= n,
      )
      native.shutdownAsyncRuntimeNow()
      return
    }
    case 'late-handler': {
      // Kept: the first half. Every deferred was released inside the native call, so once the
      // second half is collected the kept ones were released too.
      const promises = native.dropDeferredUnsettled(n)
      kept = promises.slice(0, n / 2)
      promises.slice(n / 2).forEach(observe)
      return
    }
    default:
      throw new Error(`unknown case ${kase}`)
  }
}

async function measure(native) {
  await start(native)
  const observed = kase === 'late-handler' ? n / 2 : n
  const allCollected = await gcUntil(() => counts.collected >= observed)
  if (kase === 'polluted') unpollute()
  for (const promise of kept)
    promise.then(
      () => counts.lateHandlerRuns++,
      () => counts.lateHandlerRuns++,
    )
  // A few more turns, so a handler or awaiter that wrongly runs is seen.
  for (let i = 0; i < 5; i++) {
    gc()
    await sleep(20)
  }
  return {
    mode: native.asyncTaskPromiseSettleMode(),
    allCollected,
    ...counts,
    ...(kase === 'polluted' ? { getterCalls } : {}),
    unhandled,
  }
}

if (!isMainThread) {
  const native = load()
  if (where === 'terminate') {
    await start(native)
    parentPort.postMessage({ mode: native.asyncTaskPromiseSettleMode() })
    const t0 = Date.now()
    while (Date.now() - t0 < 60_000) {}
  } else {
    parentPort.postMessage(await measure(native))
  }
} else if (where === 'main') {
  const native = load()
  const result = await measure(native)
  process.on('exit', (code) => report({ ...result, code }))
} else if (where === 'exit') {
  const native = load()
  await start(native)
  process.on('exit', (code) =>
    report({ mode: native.asyncTaskPromiseSettleMode(), code, unhandled }),
  )
  process.exit(0)
} else {
  const worker = new Worker(new URL(import.meta.url), {
    // `--expose-gc` is process-wide: the worker has `gc` too.
    workerData: { args: [addon, kase, where, nArg] },
  })
  let message
  worker.on('message', (value) => {
    message = value
  })
  const exited = new Promise((resolve, reject) => {
    worker.once('exit', resolve)
    worker.once('error', reject)
  })
  let exitedByItself
  if (where === 'terminate') {
    await new Promise((resolve) => worker.once('message', resolve))
    await worker.terminate()
    await exited
  } else {
    const timer = setTimeout(() => worker.terminate(), DEADLINE_MS * 2)
    exitedByItself = (await exited) === 0
    clearTimeout(timer)
  }
  report({ ...message, exitedByItself, unhandled })
}
