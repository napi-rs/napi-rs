import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import test from 'ava'

// Imported for its side effect: it loads the addon that `loadedAddon` finds.
import '../index.cjs'
import { loadedAddon } from './multi-env-helpers.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

// A `JsDeferred` dropped without being settled used to keep its threadsafe function (ref'd, one
// thread count) for ever: the thread that made it never exited. Now:
// * a user deferred dropped on its own JavaScript thread is cleaned up at once, inside the native
//   call (`inside.sync`), and its promise stays pending;
// * a user deferred dropped on another thread is rejected;
// * the promise of an `async fn` whose task is dropped (a runtime shutdown) is rejected.
// Each case runs in a child process, because a runtime shutdown stops the async runtime of the
// whole process.
function run(
  kase: string,
  where: string,
  n: number,
  env: NodeJS.ProcessEnv = process.env,
) {
  const result = spawnSync(
    process.execPath,
    [
      join(__dirname, 'deferred-drop.js'),
      loadedAddon(),
      kase,
      where,
      String(n),
    ],
    { encoding: 'utf8', env, timeout: 60_000 },
  )
  const output = `${result.stdout}\n${result.stderr}`
  const line = result.stdout
    .split('\n')
    .find((text) => text.startsWith('deferred-drop '))
  return {
    result,
    output,
    report: line ? JSON.parse(line.slice('deferred-drop '.length)) : undefined,
  }
}

const N = 100
const TASK = {
  message: 'task was cancelled before completion',
  code: 'GenericFailure',
}
const DROPPED = {
  message: 'JsDeferred was dropped without being settled',
  code: 'GenericFailure',
}

type Where = 'main' | 'worker'

// What a case reports, `fields` over the defaults: nothing settled, nothing counted.
function expected(where: Where, n: number, fields: Record<string, unknown>) {
  const report = {
    pending: 0,
    fulfilled: 0,
    rejected: 0,
    reasons: [],
    traced: 0,
    caught: [],
    unhandled: [],
    rejectionHandled: 0,
    inside: { sync: 0, queued: 0, rejected: 0, freed: 0 },
    total: { sync: 0, queued: 0, rejected: 0 },
    ...fields,
  }
  return where === 'main'
    ? { mode: 'deferred', code: 0, ...report }
    : {
        mode: 'thenable',
        // Each abandoned deferred freed its promise's slot while the worker was alive.
        freedWhileAlive: n,
        ...report,
        exitedByItself: true,
      }
}

// Cleaned up inside the native call: in a worker the slot is freed there too.
const cleanedInside = (where: Where, n: number) => ({
  inside: {
    sync: n,
    queued: 0,
    rejected: 0,
    freed: where === 'worker' ? n : 0,
  },
  total: { sync: n, queued: 0, rejected: 0 },
})
const rejectedLater = (n: number) => ({
  pending: 0,
  rejected: n,
  total: { sync: 0, queued: 0, rejected: n },
})

const CASES: Record<string, (where: Where) => Record<string, unknown>> = {
  // Made and dropped on the JavaScript thread, in the same call.
  drop: (where) => ({ pending: N, ...cleanedInside(where, N) }),
  // Dropped on another thread.
  'off-thread': () => ({ ...rejectedLater(N), reasons: [DROPPED] }),
  // An early `?` after `create_deferred`: the promise is never handed out.
  'create-then-fail': (where) => ({
    caught: 'failed after create_deferred',
    ...cleanedInside(where, N),
  }),
  // `#[napi] async fn` tasks dropped by an explicit runtime shutdown.
  'async-shutdown': () => ({ ...rejectedLater(N), reasons: [TASK] }),
  // Dropped with a JavaScript exception pending: the exception is the one JavaScript catches.
  // Deferred mode cannot clean up then (the env refuses JavaScript): it queues the cleanup.
  // Thenable mode needs no JavaScript: it cleans up at once.
  'exception-pending': (where) => ({
    caughtIdentical: N,
    ...(where === 'main'
      ? { total: { sync: 0, queued: N, rejected: 0 } }
      : cleanedInside(where, N)),
  }),
  // Dropped on the JavaScript thread in a later call, while JavaScript holds the promises: a
  // documented limit, cleaned up and left pending, never rejected.
  'kept-drop': (where) => ({
    pending: N,
    dropped: N,
    ...cleanedInside(where, N),
  }),
}

for (const [kase, fields] of Object.entries(CASES)) {
  for (const where of ['main', 'worker'] as const) {
    test.skipIf(Boolean(process.env.WASI_TEST))(
      `a dropped deferred is cleaned up or rejected, and its thread exits by itself: ${kase} (${where})`,
      (t) => {
        const { result, output, report } = run(kase, where, N)
        t.is(result.error, undefined, result.error?.stack)
        t.is(result.signal, null, output)
        t.is(result.status, 0, output)
        t.deepEqual(report, expected(where, N, fields(where)), output)
      },
    )
  }
}

// The rejection of a deferred dropped on another thread is an ordinary rejection: with no handler
// it is reported as unhandled, and a handler attached later still gets it.
for (const where of ['main', 'worker'] as const) {
  test.skipIf(Boolean(process.env.WASI_TEST))(
    `a handler attached after the rejection of a dropped deferred gets it (${where})`,
    (t) => {
      const n = 12
      const { result, output, report } = run('late-handler', where, n)
      t.is(result.status, 0, output)
      t.deepEqual(
        report,
        expected(where, n, {
          ...rejectedLater(n),
          reasons: [DROPPED],
          unhandled: Array(n).fill(`Error: ${DROPPED.message}`),
          rejectionHandled: n,
        }),
        output,
      )
    },
  )
}

// The rejection's stack is the JavaScript caller that made the promise (`deferred_trace`): in
// deferred mode from the trace reference, in thenable mode from the promise's slot.
for (const where of ['main', 'worker'] as const) {
  test.skipIf(Boolean(process.env.WASI_TEST))(
    `the rejection of a dropped deferred has the stack of its caller (${where})`,
    (t) => {
      const n = 12
      const { result, output, report } = run('trace', where, n)
      t.is(result.status, 0, output)
      t.deepEqual(
        report,
        {
          ...expected(where, 2 * n, {
            ...rejectedLater(2 * n),
            reasons: [DROPPED, TASK],
            traced: 2 * n,
          }),
        },
        output,
      )
    },
  )
}

// Building the rejection can throw: with `deferred_trace` the message and the code are set on
// the trace error, and a setter on `Error.prototype` runs. The promise must still be rejected,
// with what was thrown, and nothing may reach the host as an uncaught exception (status 0).
for (const where of ['main', 'worker'] as const) {
  test.skipIf(Boolean(process.env.WASI_TEST))(
    `a dropped deferred is rejected when building its rejection throws (${where})`,
    (t) => {
      const n = 12
      const { result, output, report } = run('throwing-setter', where, n)
      t.is(result.signal, null, output)
      t.is(result.status, 0, output)
      t.deepEqual(
        report,
        {
          ...expected(where, 2 * n, {
            ...rejectedLater(2 * n),
            reasons: [{ message: 'thrown by the code setter' }],
          }),
        },
        output,
      )
    },
  )
}

// An `async fn` promise rejected by a runtime shutdown with no handler is an unhandled rejection,
// handled by the host as any other: Node ends the process with exit code 1 on the main thread,
// and a worker emits 'error' and exits with code 1. (Bun 1.4.4 does the same: status 1 on the
// main thread, 'error' and exit code 1 on a worker; the spec runs on Node only.)
test.skipIf(Boolean(process.env.WASI_TEST))(
  'an unhandled rejection of an async fn dropped by a shutdown ends the main thread with 1',
  (t) => {
    const n = 3
    const { result, output, report } = run(
      'unhandled-async-shutdown',
      'main',
      n,
    )
    t.is(result.signal, null, output)
    t.is(result.status, 1, output)
    t.true(result.stderr.includes(TASK.message), output)
    t.is(report?.code, 1, output)
  },
)

test.skipIf(Boolean(process.env.WASI_TEST))(
  'an unhandled rejection of an async fn dropped by a shutdown emits error on a worker',
  (t) => {
    const n = 3
    const { result, output, report } = run(
      'unhandled-async-shutdown',
      'worker',
      n,
    )
    t.is(result.status, 0, output)
    t.deepEqual(
      report,
      { exitedByItself: false, workerError: TASK, exitCode: 1 },
      output,
    )
  },
)

// Deferreds kept in a thread local of the main thread are dropped by its destructor when
// `process.exit()` ends the process: on the JavaScript thread, with no napi callback running and
// an env that can no longer run JavaScript. The cleanup must not crash the exit. Rust runs the
// main thread's thread-local destructors there on Linux (glibc) and macOS.
test.skipIf(Boolean(process.env.WASI_TEST))(
  'deferreds dropped by a thread-local destructor at process.exit() end the process cleanly',
  (t) => {
    const n = 12
    const { result, output, report } = run('tls-exit', 'main', n)
    t.is(result.signal, null, output)
    t.is(result.status, 0, output)
    t.deepEqual(report, expected('main', n, { pending: n }), output)
    if (process.platform === 'linux' || process.platform === 'darwin') {
      t.true(
        result.stderr.includes(
          `kept deferreds dropped by the thread-local destructor: ${n}, cleaned up at once: ${n}`,
        ),
        output,
      )
    }
  },
)

// A `current_thread` runtime shut down on the JavaScript thread drops its tasks (never polled)
// right there, after their promises were handed to JavaScript: they are rejected, not cleaned up
// silently.
test.skipIf(Boolean(process.env.WASI_TEST))(
  'async fn tasks dropped on the JavaScript thread by a current_thread shutdown are rejected',
  (t) => {
    const n = 12
    const { result, output, report } = run(
      'current-thread-shutdown',
      'main',
      n,
      { ...process.env, NAPI_EXAMPLE_TOKIO_CURRENT_THREAD: '1' },
    )
    t.is(result.signal, null, output)
    t.is(result.status, 0, output)
    t.deepEqual(
      report,
      expected('main', n, { ...rejectedLater(n), reasons: [TASK] }),
      output,
    )
  },
)

// Abandoned settles still queued, or made by an env cleanup hook, when `terminate()` tears the
// worker down: the teardown drain releases them.
for (const kase of ['drop', 'env-teardown']) {
  test.skipIf(Boolean(process.env.WASI_TEST))(
    `terminated workers free 1000 dropped deferreds each: ${kase}`,
    (t) => {
      const { result, output, report } = run(kase, 'terminate', 1000)
      t.is(result.status, 0, output)
      t.deepEqual(
        report,
        {
          results: [{ mode: 'thenable' }, { mode: 'thenable' }],
          statesFreed: 2000,
        },
        output,
      )
    },
  )
}

// The settle-time callback of an abandoned deferred is dropped on the dropping thread, unrun,
// also when the drop rejects the promise. It never travels to the JavaScript thread: a host that
// lost its env (Deno 2.6.1 after a busy worker is terminated) accepts the threadsafe-function
// call but never runs it, and the callback and its captures would leak. With the env alive, this
// is what Node shows: before the fix the callback ran on the JavaScript thread (callbacksInvoked
// n).
for (const where of ['main', 'worker'] as const) {
  test.skipIf(Boolean(process.env.WASI_TEST))(
    `a deferred dropped off-thread with the env alive drops its callback unrun: ${where}`,
    (t) => {
      const n = 12
      const { result, output, report } = run('late-drop-live', where, n)
      t.is(result.error, undefined, result.error?.stack)
      t.is(result.signal, null, output)
      t.is(result.status, 0, output)
      t.deepEqual(
        report,
        expected(where, n, {
          ...rejectedLater(n),
          reasons: [DROPPED],
          callbackCapturesDropped: n,
          callbacksInvoked: 0,
        }),
        output,
      )
    },
  )
}

// A busy worker is terminated while a native thread still holds its deferreds, and that thread
// drops them later. Deno 2.6.1 runs no env cleanup hook for such a worker, and then accepts a
// threadsafe-function call but never runs it. On Node the hooks run, so this case passes with or
// without the fix; the live-env case above is the one that catches it on Node.
test.skipIf(Boolean(process.env.WASI_TEST))(
  'a deferred dropped after its busy worker was terminated drops its callback',
  (t) => {
    const n = 12
    const { result, output, report } = run('late-drop-busy', 'terminate', n)
    t.is(result.error, undefined, result.error?.stack)
    t.is(result.signal, null, output)
    t.is(result.status, 0, output)
    t.deepEqual(
      report,
      {
        results: [{ mode: 'thenable' }],
        offThreadDropped: n,
        callbackCapturesDropped: n,
        callbacksInvoked: 0,
      },
      output,
    )
  },
)
