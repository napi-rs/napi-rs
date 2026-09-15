import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import test from 'ava'

const __dirname = dirname(fileURLToPath(import.meta.url))
const script = join(__dirname, 'wasi-worker-termination.js')

/**
 * Only the threaded flavor has an async-work worker pool, so only it can hit
 * any of this. The threadless lanes pin `NAPI_RS_WASI_FLAVOR`.
 */
const isThreadedWasi =
  Boolean(process.env.WASI_TEST) &&
  process.env.NAPI_RS_WASI_FLAVOR !== 'wasm32-wasip1'

function runMode(mode: string) {
  return spawnSync(process.execPath, [script, mode], {
    encoding: 'utf8',
    env: process.env,
    timeout: 60_000,
  })
}

/**
 * `@emnapi/wasi-threads` records a worker exit as expected only when its own
 * thread manager terminated the worker. A bare `worker.terminate()` reaches the
 * manager's 'exit' listener instead, which reports the exit as a worker failure
 * and rethrows inside the emit — aborting the `once('exit')` that backs the
 * terminate promise. Disposal then waits on a promise that can no longer settle,
 * and the process dies with an uncaught exception.
 */
test.skipIf(!isThreadedWasi)(
  'disposing after async work settles instead of failing the pool workers',
  (t) => {
    const result = runMode('keep-alive')
    const output = `${result.stdout}\n${result.stderr}`
    t.is(result.error, undefined, result.error?.stack)
    t.is(result.signal, null, output)
    t.is(result.status, 0, output)
    t.regex(result.stdout, /wasi dispose settled/)
    t.notRegex(result.stderr, /sent an error!/)
  },
)

/**
 * The loader unreferences its pool workers, and stubs the very `ref` functions
 * Node's `Worker#terminate` uses to observe the exit that resolves its promise.
 * Without an undo, a `dispose()` with nothing else on the loop is left pending
 * forever: the process exits 0 and everything after the `await` is skipped.
 */
test.skipIf(!isThreadedWasi)(
  'dispose() resolves even as the last statement of a script',
  (t) => {
    const result = runMode('last-statement')
    const output = `${result.stdout}\n${result.stderr}`
    t.is(result.error, undefined, result.error?.stack)
    t.is(result.signal, null, output)
    t.is(result.status, 21, output)
    t.regex(result.stdout, /wasi dispose settled as the last statement/)
    t.notRegex(result.stderr, /sent an error!/)
  },
)

/**
 * …and the reason those stubs exist in the first place still holds.
 */
test.skipIf(!isThreadedWasi)(
  'an undisposed binding does not keep an idle process alive',
  (t) => {
    const result = runMode('no-dispose')
    const output = `${result.stdout}\n${result.stderr}`
    t.is(result.error, undefined, result.error?.stack)
    t.is(result.signal, null, output)
    t.is(result.status, 0, output)
    t.regex(result.stdout, /wasi binding left undisposed/)
  },
)

/**
 * The rollback is the one path where instantiation never returned, so the
 * destructuring that assigns `__napiModule` never ran — while the pool workers
 * a module-init hook already spawned are registered and loaded. Reading the
 * thread manager off `__napiModule` there leaves the rollback terminating
 * workers unmarked, and with their references restored the process now lives
 * long enough for the manager's unexpected-exit handler to turn a *caught*
 * initialization error into a fatal one.
 */
test.skipIf(!isThreadedWasi)(
  'a failed initialization tears its pool workers down without going fatal',
  (t) => {
    const result = spawnSync(
      process.execPath,
      [join(__dirname, 'wasi-init-rollback.js')],
      { encoding: 'utf8', env: process.env, timeout: 60_000 },
    )
    const output = `${result.stdout}\n${result.stderr}`
    t.is(result.error, undefined, result.error?.stack)
    t.is(result.signal, null, output)
    t.is(result.status, 0, output)
    t.regex(result.stdout, /caller survived the failed initialization/)
    t.notRegex(result.stderr, /sent an error!/)
    t.notRegex(result.stderr, /stopped with exit code/)
  },
)
