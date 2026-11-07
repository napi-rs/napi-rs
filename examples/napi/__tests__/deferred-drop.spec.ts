import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import test from 'ava'

// Imported for its side effect: it loads the addon that `loadedAddon` finds.
import '../index.cjs'
import { loadedAddon } from './multi-env-helpers.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

// A `JsDeferred` dropped without being settled used to keep its threadsafe function (ref'd, one
// thread count) for ever: the thread that made it never exited. Its promise stays pending; it is
// never rejected. Each case runs in a child process, because `async-shutdown` stops the async
// runtime of the whole process.
function run(kase: string, where: string, n: number) {
  const result = spawnSync(
    process.execPath,
    [
      join(__dirname, 'deferred-drop.js'),
      loadedAddon(),
      kase,
      where,
      String(n),
    ],
    { encoding: 'utf8', env: process.env, timeout: 60_000 },
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
const CASES = [
  // Made and dropped on the JavaScript thread.
  ['drop', N],
  // Dropped on another thread.
  ['off-thread', N],
  // An early `?` after `create_deferred`: the promise is never handed out.
  ['create-then-fail', 0],
  // `#[napi] async fn` tasks dropped by an explicit runtime shutdown.
  ['async-shutdown', N],
] as const
const CAUGHT: Record<string, unknown> = {
  'create-then-fail': 'failed after create_deferred',
}

for (const [kase, pending] of CASES) {
  test.skipIf(Boolean(process.env.WASI_TEST))(
    `the main thread exits by itself after dropped deferreds: ${kase}`,
    (t) => {
      const { result, output, report } = run(kase, 'main', N)
      t.is(result.error, undefined, result.error?.stack)
      t.is(result.signal, null, output)
      t.is(result.status, 0, output)
      t.deepEqual(
        report,
        {
          mode: 'deferred',
          code: 0,
          pending,
          caught: CAUGHT[kase] ?? [],
          unhandled: [],
        },
        output,
      )
    },
  )

  test.skipIf(Boolean(process.env.WASI_TEST))(
    `a worker exits by itself after dropped deferreds: ${kase}`,
    (t) => {
      const { result, output, report } = run(kase, 'worker', N)
      t.is(result.status, 0, output)
      t.deepEqual(
        report,
        {
          mode: 'thenable',
          // Each abandoned deferred freed its promise's slot while the worker was alive.
          freedWhileAlive: N,
          pending,
          caught: CAUGHT[kase] ?? [],
          unhandled: [],
          exitedByItself: true,
        },
        output,
      )
    },
  )
}

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

// The settle-time callback of an abandoned deferred is dropped on the dropping thread, unrun. It
// never travels to the JavaScript thread: a host that lost its env (Deno 2.6.1 after a busy
// worker is terminated) accepts the threadsafe-function call but never runs it, and the callback
// and its captures would leak. With the env alive, this is what Node shows: before the fix the
// callback ran on the JavaScript thread (callbacksInvoked n).
for (const where of ['main', 'worker'] as const) {
  test.skipIf(Boolean(process.env.WASI_TEST))(
    `a deferred dropped off-thread with the env alive drops its callback unrun: ${where}`,
    (t) => {
      const n = 12
      const { result, output, report } = run('late-drop-live', where, n)
      t.is(result.error, undefined, result.error?.stack)
      t.is(result.signal, null, output)
      t.is(result.status, 0, output)
      const common = {
        pending: n,
        caught: [],
        unhandled: [],
        callbackCapturesDropped: n,
        callbacksInvoked: 0,
      }
      t.deepEqual(
        report,
        where === 'main'
          ? { mode: 'deferred', code: 0, ...common }
          : {
              mode: 'thenable',
              freedWhileAlive: n,
              ...common,
              exitedByItself: true,
            },
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
