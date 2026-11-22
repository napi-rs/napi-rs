import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import test from 'ava'

// Imported for its side effect: it loads the addon that `loadedAddon` finds.
import '../index.cjs'
import { loadedAddon } from './multi-env-helpers.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Nothing may keep the promise of a `JsDeferred` dropped unsettled: on the main thread (deferred
// mode) its `napi_deferred` used to pin it, with every awaiter, until the process exited. Dropped
// on its JavaScript thread, the promise stays pending; dropped on another thread, or as an
// `async fn` task dropped by a runtime shutdown, it is rejected. Each case runs in a child
// process: `async-shutdown` stops the async runtime of the whole process, and the gc loop needs
// `--expose-gc`.
function run(kase: string, where: string, n: number) {
  const result = spawnSync(
    process.execPath,
    [
      '--expose-gc',
      join(__dirname, 'deferred-abandon-release.js'),
      loadedAddon(),
      kase,
      where,
      String(n),
    ],
    { encoding: 'utf8', env: process.env, timeout: 120_000 },
  )
  const output = `${result.stdout}\n${result.stderr}`
  const line = result.stdout
    .split('\n')
    .find((text) => text.startsWith('deferred-abandon '))
  return {
    result,
    output,
    report: line
      ? JSON.parse(line.slice('deferred-abandon '.length))
      : undefined,
  }
}

const N = 100
const settled = { resumed: 0, threw: 0, lateHandlerRuns: 0, unhandled: [] }
// Rejected: the `then` reaction and the `await` of each promise throw once.
const rejected = { ...settled, threw: 2 * N }

for (const [kase, outcome] of [
  // Made and dropped on the JavaScript thread, observed after the drop: pending.
  ['drop', settled],
  // Observed before the drop, on the JavaScript thread: still pending (a documented limit).
  ['observe', settled],
  // Dropped on another thread: rejected.
  ['off-thread', rejected],
  // `#[napi] async fn` tasks dropped by an explicit runtime shutdown: rejected.
  ['async-shutdown', rejected],
] as const) {
  for (const where of ['main', 'worker'] as const) {
    test.skipIf(Boolean(process.env.WASI_TEST))(
      `the promise of a dropped deferred is collected: ${kase}, ${where}`,
      (t) => {
        const { result, output, report } = run(kase, where, N)
        t.is(result.error, undefined, result.error?.stack)
        t.is(result.signal, null, output)
        t.is(result.status, 0, output)
        t.deepEqual(
          report,
          where === 'main'
            ? {
                mode: 'deferred',
                allCollected: true,
                collected: N,
                ...outcome,
                code: 0,
              }
            : {
                mode: 'thenable',
                allCollected: true,
                collected: N,
                ...outcome,
                exitedByItself: true,
              },
          output,
        )
      },
    )
  }
}

// The release runs no user code: no getter on the prototype chain is read.
test.skipIf(Boolean(process.env.WASI_TEST))(
  'releasing the promise of a dropped deferred reads no prototype property',
  (t) => {
    const { result, output, report } = run('polluted', 'main', N)
    t.is(result.status, 0, output)
    t.deepEqual(
      report,
      {
        mode: 'deferred',
        allCollected: true,
        collected: N,
        ...settled,
        getterCalls: { thenReads: 0, handleReads: 0 },
        code: 0,
      },
      output,
    )
  },
)

// A handler attached after the release never runs: the promise is still pending.
test.skipIf(Boolean(process.env.WASI_TEST))(
  'a handler attached after the release of a dropped deferred never runs',
  (t) => {
    const { result, output, report } = run('late-handler', 'main', N)
    t.is(result.status, 0, output)
    t.deepEqual(
      report,
      {
        mode: 'deferred',
        allCollected: true,
        collected: N / 2,
        ...settled,
        code: 0,
      },
      output,
    )
  },
)
