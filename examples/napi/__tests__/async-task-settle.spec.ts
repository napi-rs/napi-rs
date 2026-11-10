import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import test from 'ava'

import {
  asyncFnSleep,
  asyncMultiTwo,
  asyncPlus100,
  asyncTaskCounted,
  asyncTaskPromiseSettleMode,
  asyncTaskSettleCounters,
  asyncTaskThrowInResolve,
  panicInAsync,
  spawnAsyncTask,
  throwAsyncError,
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
    t.is(after.promiseWrappersCompiled - before.promiseWrappersCompiled, 0)
    t.is(after.promiseWrapperFallbacks - before.promiseWrapperFallbacks, 0)
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
        // The env compiled its promise wrapper once, at its first task, and made every promise
        // with it. A second load is a second env, with a wrapper of its own.
        const again = load()
        const beforeAgain = native.asyncTaskSettleCounters()
        out.againValues = (
          await Promise.all(Array.from({ length: 10 }, () => again.asyncTaskCounted()))
        ).length
        const end = native.asyncTaskSettleCounters()
        out.wrappersCompiled =
          beforeAgain.promiseWrappersCompiled - before.promiseWrappersCompiled
        out.againWrappersCompiled =
          end.promiseWrappersCompiled - beforeAgain.promiseWrappersCompiled
        out.wrapperFallbacks =
          end.promiseWrapperFallbacks - before.promiseWrapperFallbacks
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
      againValues: 10,
      wrappersCompiled: 1,
      againWrappersCompiled: 1,
      wrapperFallbacks: 0,
      uncaught: [],
    })
  },
)

// `#[napi] async fn` promises (`JsDeferred`) follow the env's settle mode too: the main thread keeps
// `napi_create_promise`, so no promise state is created there.
test.serial(
  'the main thread makes async fn promises with napi_create_promise',
  async (t) => {
    t.is(asyncTaskPromiseSettleMode(), 'deferred')
    const CALLS = 100
    const before = asyncTaskSettleCounters()
    const values = await settledWithin(
      Promise.all(Array.from({ length: CALLS }, () => asyncFnSleep(1))),
    )
    t.true(values.every((value) => value === 1))
    const after = asyncTaskSettleCounters()
    t.is(after.jsDeferredThenableCreated - before.jsDeferredThenableCreated, 0)
    t.is(after.jsDeferredFallbacks - before.jsDeferredFallbacks, 0)
    t.is(after.promiseStatesFreed - before.promiseStatesFreed, 0)
    t.is(after.promiseWrappersCompiled - before.promiseWrappersCompiled, 0)
  },
)

// In a worker the promise is made by the env's promise wrapper, and settled through the
// resolving functions its `then` received; values, errors (with their code), panics, a Promise
// argument and the order against other microtasks are as on the main thread. Every promise
// state is freed once settled. The first async fn of the env compiles the wrapper.
test.serial.skipIf(Boolean(process.env.WASI_TEST))(
  'a worker makes async fn promises without a deferred, and settles them as before',
  async (t) => {
    const run = `
      const outcomes = []
      const record = async (name, start) => {
        try {
          outcomes.push(name + ': ' + JSON.stringify(await start()))
        } catch (error) {
          outcomes.push(name + ': ' + error.constructor.name + ' ' + error.message + ' ' + error.code)
        }
      }
      await record('value', () => native.asyncMultiTwo(21))
      await record('error', () => native.throwAsyncError())
      await record('panic', () => native.panicInAsync())
      await record('promise', () => native.asyncPlus100(Promise.resolve(1)))
      await record('rejected promise', () =>
        native.asyncPlus100(Promise.reject(new TypeError('boom'))),
      )
      const order = []
      const settled = native.asyncFnSleep(0).then(() => order.push('async fn'))
      Promise.resolve()
        .then(() => order.push('microtask 1'))
        .then(() => order.push('microtask 2'))
      await settled
      outcomes.push('order: ' + order.join(', '))
    `
    const main = await new Function(
      'native',
      `return (async () => { ${run}; return outcomes })()`,
    )({
      asyncFnSleep,
      asyncMultiTwo,
      asyncPlus100,
      panicInAsync,
      throwAsyncError,
    })
    const result = await runInWorker(`
      ${LOAD_IN_WORKER}
      const native = load()
      ;(async () => {
        const mode = native.asyncTaskPromiseSettleMode()
        const before = native.asyncTaskSettleCounters()
        ${run}
        const after = native.asyncTaskSettleCounters()
        parentPort.postMessage({
          mode,
          outcomes,
          created: after.jsDeferredThenableCreated - before.jsDeferredThenableCreated,
          fallbacks: after.jsDeferredFallbacks - before.jsDeferredFallbacks,
          statesFreed: after.promiseStatesFreed - before.promiseStatesFreed,
          resolversReleased: after.promiseResolversReleased - before.promiseResolversReleased,
          wrappersCompiled: after.promiseWrappersCompiled - before.promiseWrappersCompiled,
        })
      })()
    `)
    t.deepEqual(result, {
      mode: 'thenable',
      outcomes: main,
      created: 6,
      fallbacks: 0,
      statesFreed: 6,
      resolversReleased: 6,
      wrappersCompiled: 1,
    })
    t.deepEqual(main, [
      'value: 42',
      'error: Error Async Error InvalidArg',
      'panic: Error panic in async function GenericFailure',
      'promise: 101',
      'rejected promise: TypeError boom undefined',
      'order: microtask 1, microtask 2, async fn',
    ])
  },
)

// A thenable-mode promise is made by a call into JavaScript, which can throw near the stack limit
// where `napi_create_promise` does not. The wrapper must throw before its promise exists, and the
// promise is then made from a deferred: no call may return a promise already rejected with a
// `RangeError` while its task or future still runs. Each call is made at a stack depth found by
// recursing until the stack overflows and stepping back `pad` frames, with `k` extra arguments
// for a finer step. Both `AsyncTask` and `#[napi] async fn` (`JsDeferred`) promises.
for (const [kind, call] of [
  ['task', 'n.asyncTaskCounted()'],
  ['async fn', 'n.asyncFnSleep(0)'],
] as const) {
  test.serial.skipIf(Boolean(process.env.WASI_TEST))(
    `a worker ${kind} started near the stack limit gets a promise that settles with its value`,
    async (t) => {
      const result = (await runInWorker(`
        ${LOAD_IN_WORKER}
        const native = load()
        ;(async () => {
          const n = native
          await ${call}
          const callers = Array.from({ length: 40 }, (_, k) =>
            new Function('n', ...Array.from({ length: k }, (_, i) => 'a' + i), 'return ${call}'),
          )
          const before = native.asyncTaskSettleCounters()
          const promises = []
          let threw = 0
          for (let pad = 0; pad < 80; pad++) {
            for (let k = 0; k < 40; k += 2) {
              const probe = (depth) => {
                let up
                try {
                  up = probe(depth + 1)
                } catch {
                  return 0
                }
                if (up === pad) {
                  try {
                    promises.push(callers[k](native))
                  } catch {
                    threw++
                  }
                }
                return up + 1
              }
              probe(0)
            }
          }
          const outcomes = {}
          for (const promise of promises) {
            const outcome = await promise.then(
              (value) => 'fulfilled with ' + value,
              (error) => 'rejected with ' + (error && error.name),
            )
            outcomes[outcome] = (outcomes[outcome] || 0) + 1
          }
          const after = native.asyncTaskSettleCounters()
          parentPort.postMessage({
            outcomes,
            calls: promises.length + threw,
            threw,
            promises: promises.length,
            statesFreed: after.promiseStatesFreed - before.promiseStatesFreed,
            taskFallbacks: after.promiseWrapperFallbacks - before.promiseWrapperFallbacks,
            asyncFnCreated: after.jsDeferredThenableCreated - before.jsDeferredThenableCreated,
            asyncFnFallbacks: after.jsDeferredFallbacks - before.jsDeferredFallbacks,
          })
        })()
      `)) as {
        outcomes: Record<string, number>
        calls: number
        threw: number
        promises: number
        statesFreed: number
        taskFallbacks: number
        asyncFnCreated: number
        asyncFnFallbacks: number
      }
      const message = JSON.stringify(result)
      t.deepEqual(Object.keys(result.outcomes), ['fulfilled with 0'], message)
      t.is(result.calls, 80 * 20)
      if (kind === 'task') {
        // Some calls had stack enough for the task but not for the wrapper: they fell back.
        t.true(result.taskFallbacks > 0, message)
        t.is(result.asyncFnCreated + result.asyncFnFallbacks, 0, message)
        // Every promise has one state, and every state was freed. A wrapper call that threw had
        // one too (freed at once), and its promise then got another from the fallback. A call
        // that threw to JavaScript after its state was made (a later step ran out of stack)
        // freed that one.
        const extra =
          result.statesFreed - result.promises - result.taskFallbacks
        t.true(extra >= 0 && extra <= result.threw, message)
      } else {
        t.true(result.asyncFnFallbacks > 0, message)
        t.is(result.taskFallbacks, 0, message)
        // A fallback promise is a `napi_create_promise` one, with no state; the wrapper call that
        // threw before it had one, freed at once.
        t.is(
          result.statesFreed,
          result.asyncFnCreated + result.asyncFnFallbacks,
          message,
        )
        const made = result.asyncFnCreated + result.asyncFnFallbacks
        t.true(
          made >= result.promises && made <= result.promises + result.threw,
          message,
        )
      }
    },
  )
}

// The settle mode is picked at the env's first task, from `process.versions` before the loop
// check: Electron, NW.js and a read that throws give `thenable` on the main thread too. Without
// `versions.bun`, Node is still found by its exported symbol (`deleted-bun`). A faked
// `versions.bun` (any version) is placed by its OS thread, never by libuv: `deferred` on the main
// thread (`thenable` on Windows), and `thenable` in a Worker (`bun-worker`). A getter that loads
// another addon must not run while the addon registers, where Node holds its addon-loader lock,
// which is not re-entrant (`getter-dlopen`). Spawned, since the versions are faked before the load.
for (const [variant, expected] of [
  ['control', 'deferred'],
  ['deleted-bun', 'deferred'],
  ['electron', 'thenable'],
  ['nw', 'thenable'],
  ['bun', process.platform === 'win32' ? 'thenable' : 'deferred'],
  ['bun-worker', 'thenable'],
  ['throwing-versions', 'thenable'],
  ['getter-dlopen', 'deferred'],
] as const) {
  test.skipIf(Boolean(process.env.WASI_TEST))(
    `the settle mode follows process.versions (${variant})`,
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

// A worker terminated before its `#[napi] async fn` promises settle: their futures still run (or
// finish) off the JS thread, and their settle can never come back. Each promise's settle state
// must be freed at teardown anyway, where a `napi_create_promise` deferred would stay for ever.
// Spawned so a crash is reported, not fatal to ava. See async-fn-terminate.js for the modes.
for (const mode of ['settled', 'inflight', 'queued', 'blocked']) {
  test.skipIf(Boolean(process.env.WASI_TEST))(
    `terminating a Worker with async fns ${mode} frees every promise state`,
    (t) => {
      const result = spawnSync(
        process.execPath,
        [join(__dirname, 'async-fn-terminate.js'), mode],
        { encoding: 'utf8', env: process.env, timeout: 120_000 },
      )
      const output = `${result.stdout}\n${result.stderr}`
      t.is(result.error, undefined, result.error?.stack)
      t.is(result.signal, null, output)
      t.is(result.status, 0, output)
      t.true(
        result.stdout.includes(
          `freed every async fn promise state on worker terminate (${mode})`,
        ),
        output,
      )
    },
  )
}
