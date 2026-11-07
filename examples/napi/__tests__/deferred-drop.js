// Drops `JsDeferred`s without settling them, then lets the thread end. Before napi-rs#3689 each
// one kept its threadsafe function (ref'd, thread count 1) for ever, so the thread never exited.
// Usage: node <this file> <addon> <case> <main|worker|terminate> <n>
// * case: drop | off-thread | create-then-fail | async-shutdown | env-teardown
// * main: run in the main thread, which must exit by itself (the parent checks the status).
// * worker: run in a worker, which must exit by itself within EXIT_WAIT_MS.
// * terminate: run in WORKERS workers that then block, and terminate each one.
// Prints one line, `deferred-drop <json>`.
import { writeSync } from 'node:fs'
import { inspect } from 'node:util'
import {
  Worker,
  isMainThread,
  parentPort,
  workerData,
} from 'node:worker_threads'

const EXIT_WAIT_MS = 20_000
const WORKERS = 2

const [addon, kase, where, nArg] = isMainThread
  ? process.argv.slice(2, 6)
  : workerData.args
const n = Number(nArg)

function load() {
  const module = { exports: {} }
  process.dlopen(module, addon)
  return module.exports
}

function report(result) {
  writeSync(1, `deferred-drop ${JSON.stringify(result)}\n`)
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function until(done) {
  const deadline = Date.now() + 10_000
  while (!done()) {
    if (Date.now() > deadline) return false
    await sleep(1)
  }
  return true
}

const pendingCount = (promises) =>
  promises.filter((promise) => inspect(promise).includes('<pending>')).length

// Starts the case. Returns the promises handed out and the errors thrown at once.
async function start(native) {
  const caught = []
  let promises = []
  switch (kase) {
    case 'drop':
      promises = native.dropDeferredUnsettled(n)
      break
    case 'off-thread': {
      const before = native.deferredDropCounters().offThreadDropped
      promises = native.dropDeferredOffThread(n, 0)
      await until(
        () => native.deferredDropCounters().offThreadDropped - before >= n,
      )
      break
    }
    case 'create-then-fail':
      for (let i = 0; i < n; i++) {
        try {
          native.createDeferredThenFail()
        } catch (error) {
          caught.push(error.message)
        }
      }
      break
    case 'async-shutdown': {
      const before = native.deferredDropCounters().pendingFuturesStarted
      for (let i = 0; i < n; i++) promises.push(native.asyncFnPendingForever())
      await until(
        () => native.deferredDropCounters().pendingFuturesStarted - before >= n,
      )
      native.shutdownAsyncRuntimeNow()
      break
    }
    case 'env-teardown':
      promises = native.dropDeferredAtEnvTeardown(n)
      break
    default:
      throw new Error(`unknown case ${kase}`)
  }
  for (const promise of promises)
    promise.then(
      () => {},
      () => {},
    )
  return {
    promises,
    caught:
      caught.length === n && new Set(caught).size === 1 ? caught[0] : caught,
  }
}

const unhandled = []
process.on('unhandledRejection', (reason) => unhandled.push(String(reason)))

if (!isMainThread) {
  const native = load()
  const freed = () => native.asyncTaskSettleCounters().promiseStatesFreed
  const before = freed()
  const { promises, caught } = await start(native)
  if (where === 'terminate') {
    parentPort.postMessage({ mode: native.asyncTaskPromiseSettleMode() })
    const t0 = Date.now()
    while (Date.now() - t0 < 60_000) {}
  } else {
    // Each abandoned deferred frees its promise's slot on this thread, while the env is alive.
    await until(() => freed() - before >= n)
    parentPort.postMessage({
      mode: native.asyncTaskPromiseSettleMode(),
      freedWhileAlive: freed() - before,
      pending: pendingCount(promises),
      caught,
      unhandled,
    })
  }
} else if (where === 'main') {
  const native = load()
  const { promises, caught } = await start(native)
  const mode = native.asyncTaskPromiseSettleMode()
  process.on('exit', (code) => {
    report({ mode, code, pending: pendingCount(promises), caught, unhandled })
  })
} else {
  const workers = where === 'terminate' ? WORKERS : 1
  const results = []
  // `terminate` reads the process-wide counter around the workers. The other cases do not load
  // the addon here, so the worker's env is its last one.
  const native = where === 'terminate' ? load() : undefined
  const freedBefore = native?.asyncTaskSettleCounters().promiseStatesFreed
  for (let i = 0; i < workers; i++) {
    const worker = new Worker(new URL(import.meta.url), {
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
    if (where === 'terminate') {
      await new Promise((resolve) => worker.once('message', resolve))
      await worker.terminate()
      await exited
      results.push(message)
    } else {
      const timer = setTimeout(() => worker.terminate(), EXIT_WAIT_MS)
      const code = await exited
      clearTimeout(timer)
      results.push({ ...message, exitedByItself: code === 0 })
    }
  }
  if (native) {
    // Every worker env is gone by now.
    report({
      results,
      statesFreed:
        native.asyncTaskSettleCounters().promiseStatesFreed - freedBefore,
    })
  } else {
    report(results[0])
  }
}
