// `#[napi] async fn` calls with `&T` arguments whose tasks are dropped unsettled. Before the fix
// each call kept a reference to every `&T` argument that only the settle deleted, so the values
// stayed alive until the env was torn down.
// Usage: node --expose-gc <this file> <addon> <case> <main|worker> <n>
// * case: shutdown | settle | conversion-error
// * main: run in the main thread, which must exit by itself (the parent checks the status).
// * worker: run in a worker, which must exit by itself within EXIT_WAIT_MS.
// Prints one line, `async-arg-refs <json>`.
import { writeSync } from 'node:fs'
import {
  Worker,
  isMainThread,
  parentPort,
  workerData,
} from 'node:worker_threads'

const EXIT_WAIT_MS = 20_000
const BYTES = 64 * 1024

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
  writeSync(1, `async-arg-refs ${JSON.stringify(result)}\n`)
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const turn = () => new Promise((resolve) => setImmediate(resolve))

async function until(done) {
  const deadline = Date.now() + 10_000
  while (!done()) {
    if (Date.now() > deadline) return false
    await sleep(1)
  }
  return true
}

// Runs gc until `done()` holds, or 10 s pass. Each round gives the loop a turn, so references
// deleted through the custom-GC handle and finalizers queued by the gc get to run.
async function gcUntil(done) {
  const deadline = Date.now() + 10_000
  while (!done()) {
    if (Date.now() > deadline) return false
    globalThis.gc()
    await turn()
  }
  return true
}

async function run(native) {
  const counters = () => native.argRefCounters()
  const before = counters()
  let buffersFreed = 0
  const registry = new FinalizationRegistry(() => {
    buffersFreed++
  })
  const buffer = () => {
    const data = Buffer.alloc(BYTES, 1)
    registry.register(data, undefined)
    return data
  }
  const caught = []
  let holders = 0
  let buffers = 0
  let results = []
  let promises = []
  switch (kase) {
    case 'shutdown':
      // `&ArgRefHolder` + `&[u8]`, and an async `&self` method. All stay pending.
      for (let i = 0; i < n; i++) {
        promises.push(
          native.argRefsPendingForever(new native.ArgRefHolder(), buffer()),
        )
        promises.push(new native.ArgRefHolder().pendingForever())
      }
      holders = 2 * n
      buffers = n
      await until(
        () => counters().futuresStarted - before.futuresStarted >= 2 * n,
      )
      native.shutdownAsyncRuntimeNow()
      await until(
        () => counters().futuresDropped - before.futuresDropped >= 2 * n,
      )
      break
    case 'settle':
      for (let i = 0; i < n; i++) {
        promises.push(
          native.argRefsResolveNow(new native.ArgRefHolder(), buffer()),
        )
        promises.push(new native.ArgRefHolder().resolveNow())
        // Only a typed slice: no class borrow roots anything for it.
        promises.push(native.argRefsSliceNow(buffer()))
      }
      holders = 2 * n
      buffers = 2 * n
      results = [...new Set(await Promise.all(promises))].sort((a, b) => a - b)
      break
    case 'conversion-error':
      // The second argument fails to convert after the first one was rooted.
      for (let i = 0; i < n; i++) {
        try {
          native.argRefsPendingForever(new native.ArgRefHolder(), 'not bytes')
        } catch (error) {
          caught.push(error.message)
        }
      }
      holders = n
      break
    default:
      throw new Error(`unknown case ${kase}`)
  }
  for (const promise of promises)
    promise.then(
      () => {},
      () => {},
    )
  promises = null
  await gcUntil(
    () =>
      counters().holdersDropped - before.holdersDropped >= holders &&
      buffersFreed >= buffers,
  )
  return {
    holdersFreedWhileAlive: counters().holdersDropped - before.holdersDropped,
    buffersFreedWhileAlive: buffersFreed,
    results,
    caught: caught.length === n && new Set(caught).size === 1 ? 1 : caught,
  }
}

if (!isMainThread) {
  parentPort.postMessage(await run(load()))
} else if (where === 'main') {
  report(await run(load()))
} else {
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
  const timer = setTimeout(() => worker.terminate(), EXIT_WAIT_MS)
  const code = await exited
  clearTimeout(timer)
  report({ ...message, exitedByItself: code === 0 })
}
