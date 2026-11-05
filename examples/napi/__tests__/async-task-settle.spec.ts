import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import test from 'ava'

import {
  asyncTaskCounted,
  asyncTaskPromiseSettleMode,
  asyncTaskSettleCounters,
  asyncTaskThrowInResolve,
  spawnAsyncTask,
} from '../index.cjs'

import {
  LOAD_IN_WORKER,
  loadedAddon,
  runInWorker,
} from './multi-env-helpers.js'

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

// The main thread (and every WASI env) settles through the deferred, as before the thenable:
// no promise state is created, so the thenable counters stay put.
test.serial(
  'the main thread settles AsyncTask promises through the deferred',
  async (t) => {
    t.is(asyncTaskPromiseSettleMode(), 'deferred')
    const TASKS = 100
    const before = asyncTaskSettleCounters()
    const values = await settledWithin(
      Promise.all(Array.from({ length: TASKS }, () => asyncTaskCounted())),
    )
    t.true(values.every((value) => value === 0))
    const after = asyncTaskSettleCounters()
    t.is(after.promiseStatesFreed - before.promiseStatesFreed, 0)
    t.is(after.promiseResolversReleased - before.promiseResolversReleased, 0)
    t.is(after.created - before.created, TASKS)
    t.is(after.dropped - before.dropped, TASKS)
  },
)

test.serial(
  'an exception left pending by Task::resolve rejects the promise and finally still runs',
  async (t) => {
    t.is(asyncTaskPromiseSettleMode(), 'deferred')
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
    t.is(asyncTaskPromiseSettleMode(), 'deferred')
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
  'AsyncTask promises settle after globalThis.Promise is replaced',
  async (t) => {
    t.is(asyncTaskPromiseSettleMode(), 'deferred')
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
    // emnapi's `napi_create_promise` builds the promise with the `globalThis.Promise` of the
    // moment (`Promise.withResolvers.call(Promise)`), so only Node keeps the intrinsic here.
    if (!process.env.WASI_TEST) {
      t.is(Object.getPrototypeOf(promise), OriginalPromise.prototype)
    }
    t.is(await settledWithin(promise), 0)
    const after = asyncTaskSettleCounters()
    t.is(after.promiseStatesFreed - before.promiseStatesFreed, 0)
  },
)

// A worker env can be torn down before the process exits, so it settles through the thenable.
// The same live-env cases as above, plus one cancellation the pool accepts.
test.serial.skipIf(Boolean(process.env.WASI_TEST))(
  'a worker settles AsyncTask promises through the thenable',
  async (t) => {
    const result = await runInWorker(`
      ${LOAD_IN_WORKER}
      const native = load()
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
      ;(async () => {
        const uncaught = []
        process.on('uncaughtException', (error) => uncaught.push(String(error)))
        const out = { mode: native.asyncTaskPromiseSettleMode() }
        const before = native.asyncTaskSettleCounters()
        const values = await Promise.all(
          Array.from({ length: 100 }, () => native.asyncTaskCounted()),
        )
        const mid = native.asyncTaskSettleCounters()
        out.values = values.length === 100 && values.every((value) => value === 0)
        out.statesFreed = mid.promiseStatesFreed - before.promiseStatesFreed
        out.resolversReleased =
          mid.promiseResolversReleased - before.promiseResolversReleased
        out.throwInResolve = await native
          .asyncTaskThrowInResolve()
          .then(() => 'fulfilled', (error) => error.message)
        out.finallyCalls = native.asyncTaskSettleCounters().finallyCalls - mid.finallyCalls
        // Refused: \`compute\` is running, so the work completes and settles normally.
        const refused = native.spawnAsyncTask(200)
        const deadline = Date.now() + 10_000
        while (!refused.task.isExecuting() && Date.now() < deadline) await sleep(1)
        out.cancelRefused = !refused.task.cancel()
        refused.task.release()
        out.cancelValue = await refused.promise
        // Accepted: every pool thread is held by a blocker queued first, and the pool takes
        // work in order, so the aborted task cannot have started.
        const poolSize = Number(process.env.UV_THREADPOOL_SIZE) || 4
        const blockers = Array.from({ length: poolSize }, () => native.spawnAsyncTask(1))
        const controller = new AbortController()
        const aborted = native.withAbortController(1, 2, controller.signal)
        controller.abort()
        blockers[0].task.release()
        out.accepted = await aborted.then(
          (value) => 'fulfilled with ' + value,
          (error) => error.name + ': ' + error.message,
        )
        out.blockers = (await Promise.all(blockers.map(({ promise }) => promise))).length
        out.uncaught = uncaught
        parentPort.postMessage(out)
      })()
    `)
    t.deepEqual(result, {
      mode: 'thenable',
      values: true,
      statesFreed: 100,
      resolversReleased: 100,
      throwInResolve: 'thrown inside resolve',
      finallyCalls: 1,
      cancelRefused: true,
      cancelValue: 200,
      accepted: 'AbortError: AbortError',
      blockers: Number(process.env.UV_THREADPOOL_SIZE) || 4,
      uncaught: [],
    })
  },
)

// The settle mode is picked from `process.versions` before the loop check: hosts that must use
// the thenable path (Electron, NW.js, Bun before 1.4.4, Bun on Windows), and a read that throws,
// give `thenable` on the main thread too. Without `versions.bun`, Node is still found by its
// exported symbol (`deleted-bun`). Spawned, since the versions must be faked before the load.
for (const [variant, expected] of [
  ['control', 'deferred'],
  ['deleted-bun', 'deferred'],
  ['electron', 'thenable'],
  ['nw', 'thenable'],
  ['bun-1.4.3', 'thenable'],
  ['bun-1.4.4', process.platform === 'win32' ? 'thenable' : 'deferred'],
  ['throwing-versions', 'thenable'],
] as const) {
  test.skipIf(Boolean(process.env.WASI_TEST))(
    `the main thread settle mode follows process.versions (${variant})`,
    (t) => {
      const result = spawnSync(
        process.execPath,
        [join(__dirname, 'async-task-settle-mode.js'), variant, loadedAddon()],
        { encoding: 'utf8', env: process.env, timeout: 60_000 },
      )
      const output = `${result.stdout}\n${result.stderr}`
      t.is(result.error, undefined, result.error?.stack)
      t.is(result.signal, null, output)
      t.is(result.status, 0, output)
      const line = result.stdout
        .split('\n')
        .find((text) => text.startsWith('settle-mode '))
      t.truthy(line, output)
      t.deepEqual(JSON.parse(line!.slice('settle-mode '.length)), {
        mode: expected,
        value: 0,
        versionsRead: variant !== 'control' && variant !== 'deleted-bun',
        uncaught: [],
      })
    },
  )
}

// Tampering installed before the addon loads (an instrumentation preload) or afterwards (a
// hostile script): wrappers around `globalThis.Promise`, one that also claims the intrinsic
// prototype's `constructor`, and throwing `Object.prototype.then` accessors with a replaced
// `Promise.prototype.then`. No AsyncTask may run any of it, and every promise must settle.
// Spawned, since the global must be replaced before the load.
// Run on the main thread (deferred) and in a worker (thenable).
for (const mode of ['proxy', 'throwing', 'constructor', 'then-accessors']) {
  for (const thread of ['main', 'worker']) {
    test.skipIf(Boolean(process.env.WASI_TEST))(
      `AsyncTask promises ignore ${mode} Promise tampering (${thread})`,
      (t) => {
        const result = spawnSync(
          process.execPath,
          [join(__dirname, 'async-task-wrapped-promise.js'), mode, thread],
          { encoding: 'utf8', env: process.env, timeout: 60_000 },
        )
        const output = `${result.stdout}\n${result.stderr}`
        t.is(result.error, undefined, result.error?.stack)
        t.is(result.signal, null, output)
        t.is(result.status, 0, output)
        t.regex(
          result.stdout,
          new RegExp(
            `AsyncTasks ignored the ${mode} Promise tampering \\(${thread}\\)`,
          ),
        )
      },
    )
  }
}

// Teardown runs every queued completion while JavaScript is disabled; each task must still be
// dropped and the process must not crash. Spawned so a crash is reported, not fatal to ava.
// WASI lanes dispose through the emnapi loader instead (wasi-worker-termination.spec.ts).
// `blocked`: no promise's `then` ran yet; `then-ran`: every promise holds its resolving
// functions, which must be released although teardown refuses to call them.
for (const mode of ['blocked', 'then-ran']) {
  test.skipIf(Boolean(process.env.WASI_TEST))(
    `terminating a Worker with queued AsyncTasks drops every task and frees its promise state (${mode})`,
    (t) => {
      const result = spawnSync(
        process.execPath,
        [join(__dirname, 'async-task-settle-terminate.js'), mode],
        { encoding: 'utf8', env: process.env, timeout: 120_000 },
      )
      const output = `${result.stdout}\n${result.stderr}`
      t.is(result.error, undefined, result.error?.stack)
      t.is(result.signal, null, output)
      t.is(result.status, 0, output)
      t.true(
        result.stdout.includes(
          `dropped every AsyncTask and freed its promise state on worker terminate (${mode})`,
        ),
        output,
      )
    },
  )
}
