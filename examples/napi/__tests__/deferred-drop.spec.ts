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
