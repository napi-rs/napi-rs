// Drops `JsDeferred`s without settling them, then lets the thread end. Before napi-rs#3689 each
// one kept its threadsafe function (ref'd, thread count 1) for ever, so the thread never exited.
// Dropped on its JavaScript thread, a user deferred is cleaned up at once, inside the native call,
// and its promise stays pending. Dropped on another thread, or as an `async fn` task dropped by a
// runtime shutdown, its promise is rejected.
// Usage: node <this file> <addon> <case> <main|worker|terminate> <n>
// * case: drop | off-thread | create-then-fail | async-shutdown | env-teardown | late-drop-live
//   | late-drop-busy | exception-pending | kept-drop | late-handler | unhandled-async-shutdown
//   | trace | tls-exit | current-thread-shutdown | throwing-setter
//   - exception-pending: the native call throws a value, then drops a deferred, then returns.
//   - kept-drop: the deferreds are kept by the addon and dropped in a later call.
//   - late-handler: dropped on another thread; handlers attached only after the rejections ran.
//   - unhandled-async-shutdown: `async fn` promises with no handler, then a runtime shutdown. No
//     'unhandledRejection' listener: the host's own handling must show.
//   - trace: rejections made through a JavaScript function named `callerMarker`.
//   - throwing-setter: as `trace`, plus `async fn`s that return an error, with setters on
//     `Error.prototype` that throw. Building a rejection must not run them (the addon is built
//     with `deferred_trace`, which puts the message and the code on the trace error).
//   - tls-exit (main): the addon keeps deferreds in a thread local, then process.exit(0).
//   - current-thread-shutdown (main, NAPI_EXAMPLE_TOKIO_CURRENT_THREAD=1): `async fn` tasks never
//     polled, dropped on the JavaScript thread by the shutdown of a `current_thread` runtime.
// * main: run in the main thread, which must exit by itself (the parent checks the status).
// * worker: run in a worker, which must exit by itself within EXIT_WAIT_MS.
// * terminate: run in WORKERS workers that then block, and terminate each one.
//   late-drop-busy runs only in this mode, in one worker.
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
// late-drop-busy: the native thread drops the deferreds this long after the worker made them,
// so after the worker is terminated. The parent then waits LATE_DROP_WAIT_MS.
const LATE_DROP_DELAY_MS = 500
const LATE_DROP_WAIT_MS = 1_500
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

const unhandled = []
let rejectionHandled = 0
if (kase !== 'unhandled-async-shutdown') {
  process.on('unhandledRejection', (reason) => unhandled.push(String(reason)))
  process.on('rejectionHandled', () => rejectionHandled++)
}

// How the promises a case attached handlers to ended.
const outcome = { fulfilled: 0, rejected: 0, reasons: [], traced: 0 }
function onRejected(error) {
  outcome.rejected++
  const reason = { message: error?.message, code: error?.code }
  if (
    !outcome.reasons.some(
      (seen) => seen.message === reason.message && seen.code === reason.code,
    )
  )
    outcome.reasons = [...outcome.reasons, reason].sort((a, b) =>
      String(a.message).localeCompare(String(b.message)),
    )
  if (String(error?.stack).includes('callerMarker')) outcome.traced++
}
// Attaches the handlers at once, when the promise is created: a rejection must find them.
function handle(promise) {
  promise.then(() => outcome.fulfilled++, onRejected)
  return promise
}

// The `JsDeferred` abandon counters of the whole process.
const abandonCounters = (native) => {
  const counters = native.asyncTaskSettleCounters()
  return {
    sync: counters.jsDeferredAbandonedSync,
    queued: counters.jsDeferredAbandonedQueued,
    rejected: counters.jsDeferredAbandonRejected,
    freed: counters.promiseStatesFreed,
  }
}

// Runs `call` and returns what it returned and the counter deltas it made, read in one
// synchronous block: no microtask and no macrotask can run in between, so whatever moved was
// done inside the native call.
function syncDeltas(native, call) {
  const before = abandonCounters(native)
  let value
  let thrown
  try {
    value = call()
  } catch (error) {
    thrown = { error }
  }
  const after = abandonCounters(native)
  return {
    value,
    thrown,
    delta: {
      sync: after.sync - before.sync,
      queued: after.queued - before.queued,
      rejected: after.rejected - before.rejected,
      freed: after.freed - before.freed,
    },
  }
}

// Starts the case. Returns the promises handed out, the errors thrown at once, the counter deltas
// made inside the native calls and, for the callback cases, a function that reads the callback
// counters since the start.
async function start(native) {
  const caught = []
  let promises = []
  let callbacks
  let extra
  const inside = { sync: 0, queued: 0, rejected: 0, freed: 0 }
  const run = (call) => {
    const { value, thrown, delta } = syncDeltas(native, call)
    for (const key of Object.keys(inside)) inside[key] += delta[key]
    if (thrown) throw thrown.error
    return value
  }
  switch (kase) {
    case 'drop':
      promises = run(() => native.dropDeferredUnsettled(n))
      break
    case 'off-thread': {
      const before = native.deferredDropCounters().offThreadDropped
      promises = run(() => native.dropDeferredOffThread(n, 0)).map(handle)
      await until(
        () => native.deferredDropCounters().offThreadDropped - before >= n,
      )
      break
    }
    case 'create-then-fail':
      for (let i = 0; i < n; i++) {
        try {
          run(() => native.createDeferredThenFail())
        } catch (error) {
          caught.push(error.message)
        }
      }
      break
    case 'async-shutdown': {
      const before = native.deferredDropCounters().pendingFuturesStarted
      for (let i = 0; i < n; i++)
        promises.push(handle(native.asyncFnPendingForever()))
      await until(
        () => native.deferredDropCounters().pendingFuturesStarted - before >= n,
      )
      run(() => native.shutdownAsyncRuntimeNow())
      break
    }
    case 'env-teardown':
      promises = native.dropDeferredAtEnvTeardown(n)
      break
    case 'late-drop-live': {
      // The env is alive when the native thread drops the deferreds. The settle-time callback
      // must be dropped there, unrun, also when the drop rejects the promise; before the fix it
      // ran on this thread.
      const before = native.deferredDropCounters()
      promises = native.dropDeferredOffThreadWithCallback(n, 0).map(handle)
      await until(
        () =>
          native.deferredDropCounters().offThreadDropped -
            before.offThreadDropped >=
          n,
      )
      callbacks = () => {
        const after = native.deferredDropCounters()
        return {
          callbackCapturesDropped:
            after.callbackCapturesDropped - before.callbackCapturesDropped,
          callbacksInvoked: after.callbacksInvoked - before.callbacksInvoked,
        }
      }
      break
    }
    case 'late-drop-busy':
      promises = native.dropDeferredOffThreadWithCallback(n, LATE_DROP_DELAY_MS)
      break
    case 'exception-pending': {
      let identical = 0
      for (let i = 0; i < n; i++) {
        const thrown = new Error(`thrown ${i}`)
        try {
          run(() => native.dropDeferredWithExceptionPending(thrown))
        } catch (error) {
          if (error === thrown) identical++
        }
      }
      extra = { caughtIdentical: identical }
      break
    }
    case 'kept-drop': {
      promises = native.keepDeferreds(n).map(handle)
      // A later call, after JavaScript had the promises for a while.
      await sleep(10)
      extra = { dropped: run(() => native.dropKeptDeferreds()) }
      break
    }
    case 'late-handler': {
      const before = abandonCounters(native).rejected
      promises = run(() => native.dropDeferredOffThread(n, 0))
      await until(() => abandonCounters(native).rejected - before >= n)
      // Let the host report the unhandled rejections first.
      await sleep(20)
      promises.forEach(handle)
      break
    }
    case 'unhandled-async-shutdown': {
      const before = native.deferredDropCounters().pendingFuturesStarted
      for (let i = 0; i < n; i++) promises.push(native.asyncFnPendingForever())
      await until(
        () => native.deferredDropCounters().pendingFuturesStarted - before >= n,
      )
      run(() => native.shutdownAsyncRuntimeNow())
      break
    }
    case 'throwing-setter':
      for (const key of ['code', 'message'])
        Object.defineProperty(Error.prototype, key, {
          configurable: true,
          get() {
            return undefined
          },
          set() {
            throw new Error(`thrown by the ${key} setter`)
          },
        })
    // falls through
    case 'trace': {
      // Normal rejections: `async fn`s that return an error.
      const failing = []
      function callerMarker() {
        const tasks = []
        for (let i = 0; i < n; i++) tasks.push(native.asyncFnPendingForever())
        if (kase === 'throwing-setter')
          for (let i = 0; i < n; i++) failing.push(native.throwAsyncError())
        return [...tasks, ...failing, ...native.dropDeferredOffThread(n, 0)]
      }
      const before = native.deferredDropCounters().pendingFuturesStarted
      promises = callerMarker().map(handle)
      // The failing tasks must end by themselves: one still queued at the shutdown below is
      // dropped by it, and rejected as a cancelled task.
      let failed = 0
      for (const promise of failing)
        promise.then(
          () => failed++,
          () => failed++,
        )
      await until(
        () =>
          failed >= failing.length &&
          native.deferredDropCounters().pendingFuturesStarted - before >= n,
      )
      run(() => native.shutdownAsyncRuntimeNow())
      break
    }
    case 'tls-exit':
      promises = native.keepDeferreds(n).map(handle)
      break
    case 'current-thread-shutdown':
      // Never polled: a `current_thread` runtime runs a task only inside `block_on`.
      for (let i = 0; i < n; i++)
        promises.push(handle(native.asyncFnPendingForever()))
      run(() => native.shutdownAsyncRuntimeNow())
      break
    default:
      throw new Error(`unknown case ${kase}`)
  }
  return {
    promises,
    caught:
      caught.length === n && new Set(caught).size === 1 ? caught[0] : caught,
    callbacks,
    inside,
    extra,
  }
}

// What a case reports: how its promises ended, and the counters.
function summary(native, started, before) {
  const after = abandonCounters(native)
  return {
    pending: pendingCount(started.promises),
    ...outcome,
    caught: started.caught,
    unhandled,
    rejectionHandled,
    inside: started.inside,
    total: {
      sync: after.sync - before.sync,
      queued: after.queued - before.queued,
      rejected: after.rejected - before.rejected,
    },
    ...started.extra,
    ...started.callbacks?.(),
  }
}

if (!isMainThread) {
  const native = load()
  const freed = () => native.asyncTaskSettleCounters().promiseStatesFreed
  const before = abandonCounters(native)
  const started = await start(native)
  if (where === 'terminate') {
    parentPort.postMessage({ mode: native.asyncTaskPromiseSettleMode() })
    const t0 = Date.now()
    while (Date.now() - t0 < 60_000) {}
  } else {
    // Each abandoned deferred frees its promise's slot on this thread, while the env is alive.
    const slots =
      kase === 'trace' ? 2 * n : kase === 'throwing-setter' ? 3 * n : n
    await until(() => freed() - before.freed >= slots)
    // A few more turns, so a handler or a rejection that wrongly comes is seen.
    await sleep(20)
    parentPort.postMessage({
      mode: native.asyncTaskPromiseSettleMode(),
      freedWhileAlive: freed() - before.freed,
      ...summary(native, started, before),
    })
  }
} else if (where === 'main') {
  const native = load()
  const before = abandonCounters(native)
  const started = await start(native)
  const mode = native.asyncTaskPromiseSettleMode()
  process.on('exit', (code) => {
    // The abandon items were delivered: the loop could not end before they released the
    // threadsafe functions.
    report({ mode, code, ...summary(native, started, before) })
  })
  if (kase === 'tls-exit') process.exit(0)
} else {
  const lateDrop = kase === 'late-drop-busy'
  if (lateDrop && where !== 'terminate')
    throw new Error(`${kase} runs only in terminate mode`)
  const workers = where === 'terminate' && !lateDrop ? WORKERS : 1
  const results = []
  // `terminate` reads the process-wide counter around the workers. The other cases do not load
  // the addon here, so the worker's env is its last one.
  const native = where === 'terminate' ? load() : undefined
  const freedBefore = native?.asyncTaskSettleCounters().promiseStatesFreed
  // The counters are process-wide: the workers' deferreds count here too.
  const dropBefore = native?.deferredDropCounters()
  for (let i = 0; i < workers; i++) {
    const worker = new Worker(new URL(import.meta.url), {
      workerData: { args: [addon, kase, where, nArg] },
    })
    let message
    let workerError
    worker.on('message', (value) => {
      message = value
    })
    worker.on('error', (error) => {
      workerError = { message: error?.message, code: error?.code }
    })
    const exited = new Promise((resolve) => worker.once('exit', resolve))
    if (where === 'terminate') {
      await new Promise((resolve) => worker.once('message', resolve))
      await worker.terminate()
      await exited
      results.push(message)
    } else {
      const timer = setTimeout(() => worker.terminate(), EXIT_WAIT_MS)
      const code = await exited
      clearTimeout(timer)
      results.push({
        ...message,
        exitedByItself: code === 0,
        ...(workerError ? { workerError, exitCode: code } : {}),
      })
    }
  }
  if (lateDrop) {
    // The worker was busy when terminated. The native thread drops its deferreds after that.
    await sleep(LATE_DROP_WAIT_MS)
    const after = native.deferredDropCounters()
    report({
      results,
      offThreadDropped: after.offThreadDropped - dropBefore.offThreadDropped,
      callbackCapturesDropped:
        after.callbackCapturesDropped - dropBefore.callbackCapturesDropped,
      callbacksInvoked: after.callbacksInvoked - dropBefore.callbacksInvoked,
    })
  } else if (native) {
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
