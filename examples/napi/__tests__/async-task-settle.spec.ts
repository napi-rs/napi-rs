import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import test from 'ava'

import {
  asyncTaskCounted,
  asyncTaskSettleCounters,
  asyncTaskThrowInResolve,
  spawnAsyncTask,
} from '../index.cjs'

const __dirname = dirname(fileURLToPath(import.meta.url))

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// A promise that never settles must fail the test, not hang it until the ava timeout.
function settledWithin<T>(promise: Promise<T>, ms = 5000) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`promise still pending after ${ms} ms`)),
      ms,
    )
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

test.serial(
  'an exception left pending by Task::resolve rejects the promise and finally still runs',
  async (t) => {
    const before = asyncTaskSettleCounters()
    const uncaught: unknown[] = []
    const onUncaught = (error: unknown) => uncaught.push(error)
    process.on('uncaughtException', onUncaught)
    try {
      await t.throwsAsync(settledWithin(asyncTaskThrowInResolve()), {
        message: 'thrown inside resolve',
      })
    } finally {
      process.off('uncaughtException', onUncaught)
    }
    const after = asyncTaskSettleCounters()
    t.is(after.resolveCalls - before.resolveCalls, 1)
    t.is(after.finallyCalls - before.finallyCalls, 1)
    t.deepEqual(uncaught, [])
  },
)

test.serial(
  'a refused AsyncWorkPromise::cancel still settles the promise',
  async (t) => {
    const { promise, task } = spawnAsyncTask(200)
    const deadline = Date.now() + 10_000
    while (!task.isExecuting()) {
      if (Date.now() > deadline) {
        t.fail('compute never started')
        return
      }
      await sleep(1)
    }
    // `compute` is running, so the host refuses the cancellation.
    t.false(task.cancel())
    t.is(await settledWithin(promise), 200)
    // Cancelling a completed task is a no-op.
    t.true(task.cancel())
  },
)

test.serial(
  'AsyncTask promises keep the intrinsic Promise after globalThis.Promise is replaced',
  async (t) => {
    const OriginalPromise = globalThis.Promise
    class ReplacedPromise<T> extends OriginalPromise<T> {}
    let promise: Promise<number>
    globalThis.Promise = ReplacedPromise as PromiseConstructor
    try {
      promise = asyncTaskCounted()
    } finally {
      globalThis.Promise = OriginalPromise
    }
    t.is(Object.getPrototypeOf(promise), OriginalPromise.prototype)
    t.is(await settledWithin(promise), 0)
  },
)

// Teardown runs every queued completion while JavaScript is disabled; each task must still be
// dropped and the process must not crash. Spawned so a crash is reported, not fatal to ava.
// WASI lanes dispose through the emnapi loader instead (wasi-worker-termination.spec.ts).
test.skipIf(Boolean(process.env.WASI_TEST))(
  'terminating a Worker with queued AsyncTasks drops every task',
  (t) => {
    const result = spawnSync(
      process.execPath,
      [join(__dirname, 'async-task-settle-terminate.js')],
      { encoding: 'utf8', env: process.env, timeout: 120_000 },
    )
    const output = `${result.stdout}\n${result.stderr}`
    t.is(result.error, undefined, result.error?.stack)
    t.is(result.signal, null, output)
    t.is(result.status, 0, output)
    t.regex(result.stdout, /dropped every AsyncTask on worker terminate/)
  },
)
