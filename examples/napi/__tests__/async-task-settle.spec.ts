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
    try {
      const deadline = Date.now() + 10_000
      while (!task.isExecuting()) {
        if (Date.now() > deadline) {
          t.fail('compute never started')
          return
        }
        await sleep(1)
      }
      // `compute` is running, and waits for `release()`, so the host refuses the cancellation.
      t.false(task.cancel())
    } finally {
      task.release()
    }
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
    const before = asyncTaskSettleCounters()
    let promise: Promise<number>
    globalThis.Promise = ReplacedPromise as PromiseConstructor
    try {
      promise = asyncTaskCounted()
    } finally {
      globalThis.Promise = OriginalPromise
    }
    t.is(Object.getPrototypeOf(promise), OriginalPromise.prototype)
    t.is(await settledWithin(promise), 0)
    // Built by the constructor cached at load, not by `napi_create_promise`: its resolving
    // functions were released when it settled.
    const after = asyncTaskSettleCounters()
    t.is(after.resolversReleased - before.resolversReleased, 1)
  },
)

// A wrapper installed before the addon loads (an instrumentation preload) builds promises with
// the intrinsic prototype, but hands the executor its own resolving functions. The addon must
// not cache it: no AsyncTask may call it, and a wrapper whose resolving functions throw must
// not leave the promise pending. Spawned, since the global must be replaced before the load.
for (const mode of ['proxy', 'throwing']) {
  test.skipIf(Boolean(process.env.WASI_TEST))(
    `AsyncTask promises ignore a ${mode} globalThis.Promise wrapper installed before load`,
    (t) => {
      const result = spawnSync(
        process.execPath,
        [join(__dirname, 'async-task-wrapped-promise.js'), mode],
        { encoding: 'utf8', env: process.env, timeout: 60_000 },
      )
      const output = `${result.stdout}\n${result.stderr}`
      t.is(result.error, undefined, result.error?.stack)
      t.is(result.signal, null, output)
      t.is(result.status, 0, output)
      t.regex(
        result.stdout,
        new RegExp(`AsyncTasks ignored the ${mode} Promise wrapper`),
      )
    },
  )
}

// Teardown runs every queued completion while JavaScript is disabled; each task must still be
// dropped and the process must not crash. Spawned so a crash is reported, not fatal to ava.
// WASI lanes dispose through the emnapi loader instead (wasi-worker-termination.spec.ts).
test.skipIf(Boolean(process.env.WASI_TEST))(
  'terminating a Worker with queued AsyncTasks drops every task and releases its resolvers',
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
    t.regex(
      result.stdout,
      /dropped every AsyncTask and released its resolving functions on worker terminate/,
    )
  },
)
