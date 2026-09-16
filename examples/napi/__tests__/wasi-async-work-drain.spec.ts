import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import test from 'ava'

const __dirname = dirname(fileURLToPath(import.meta.url))
const script = join(__dirname, 'wasi-async-work-drain.js')
const packageDirectory = join(__dirname, '..')

/** Lanes that build a WASI artifact before running this suite. */
const inWasiLane = Boolean(
  process.env.WASI_TEST ?? process.env.NAPI_RS_TEST_THREADLESS_WASI_BUFFER,
)

/**
 * Both flavors strand `napi_async_work` on disposal, for different reasons, and
 * both are fixed by the same addon-side handshake — so both are worth asserting
 * wherever their artifact was built.
 *
 * The threadless archive (`emnapi-basic-napi-rs`) resolves `napi_*_async_work`
 * through the `@emnapi/core` JavaScript plugins; the threaded one
 * (`emnapi-napi-rs-mt`) links the C `async_work.c` on the uv threadpool and
 * imports none of those symbols. See `emnapi_link_library` in
 * `crates/build/src/wasi.rs`.
 */
const FLAVORS = [
  {
    name: 'threaded',
    loader: 'example.wasi.cjs',
    wasm: 'example.wasm32-wasi.wasm',
  },
  {
    name: 'threadless',
    loader: 'example.wasip1.cjs',
    wasm: 'example.wasm32-wasip1.wasm',
  },
] as const

function runMode(mode: string, loader: string) {
  return spawnSync(process.execPath, [script, mode, loader], {
    encoding: 'utf8',
    env: process.env,
    timeout: 60_000,
  })
}

for (const flavor of FLAVORS) {
  const built = () => existsSync(join(packageDirectory, flavor.wasm))
  const skip = !inWasiLane || !built()

  /**
   * The defect. `emnapiAsyncWorkPlugin` and the C implementation alike bracket
   * every queued work with the emnapi waiting-request counter, and only the
   * completion callback brings it back down. Disposal used to destroy the
   * context — and terminate the pool threads — with the work still outstanding,
   * so the callback could never run: the promise hung forever, the counter
   * stayed at one, and the referenced `MessagePort` it holds kept the process
   * alive. `dispose()` itself still resolved, which is what made it silent.
   */
  test.skipIf(skip)(
    `dispose() settles outstanding async work instead of stranding it: ${flavor.name}`,
    (t) => {
      const result = runMode('settles', flavor.loader)
      const output = `${result.stdout}\n${result.stderr}`
      t.is(result.error, undefined, result.error?.stack)
      // A stranded work shows up here: the process cannot exit, so the timeout
      // kills it.
      t.is(result.signal, null, output)
      t.is(result.status, 0, output)
      t.regex(result.stdout, /drain complete/)
      t.regex(result.stdout, /^ports 0$/m, output)
      // Either outcome is correct — what must never happen is neither.
      t.regex(result.stdout, /settled \["t0:(resolved|rejected:AbortError)"\]/)
    },
  )

  /**
   * Work that no thread has started is cancelled through napi's own contract:
   * the completion callback runs with `napi_cancelled`, which napi-rs turns
   * into an `AbortError` rejection. That is what bounds the wait — disposal
   * waits only for work already running, never for a whole queue.
   */
  test.skipIf(skip)(
    `queued async work is cancelled rather than waited for: ${flavor.name}`,
    (t) => {
      const result = runMode('cancel-queued', flavor.loader)
      const output = `${result.stdout}\n${result.stderr}`
      t.is(result.error, undefined, result.error?.stack)
      t.is(result.signal, null, output)
      t.is(result.status, 0, output)
      t.regex(result.stdout, /^ports 0$/m, output)
      const settled = JSON.parse(
        /settled (\[.*\])/.exec(result.stdout)?.[1] ?? '[]',
      ) as string[]
      t.is(settled.length, 16, output)
      t.true(
        settled.some((entry) => entry.endsWith(':rejected:AbortError')),
        `expected some task to be cancelled, got ${output}`,
      )
      // Whatever was not cancelled had already started, and must have run to
      // completion rather than been discarded.
      t.true(
        settled.every(
          (entry) =>
            entry.endsWith(':resolved') ||
            entry.endsWith(':rejected:AbortError'),
        ),
        output,
      )
    },
  )

  /**
   * The other half: work already executing refuses cancellation, so the drain
   * has to keep the pool threads and the environment alive until it finishes.
   *
   * Threaded only, because only there can a task be *observed* executing. The
   * threadless archive runs `compute` on the JavaScript thread itself, inside
   * the macrotask that dequeued it, so no JavaScript can run while a task is in
   * flight: it is either not started yet or already past `compute`. The same
   * property is still covered for that flavor by the cancellation test above —
   * the tasks that resolve there are exactly the ones whose cancel was refused
   * because they had already started, and the drain waited for them.
   */
  test.skipIf(skip || flavor.name !== 'threaded')(
    `executing async work is awaited, not cancelled: ${flavor.name}`,
    (t) => {
      const result = runMode('executing', flavor.loader)
      const output = `${result.stdout}\n${result.stderr}`
      t.is(result.error, undefined, result.error?.stack)
      t.is(result.signal, null, output)
      t.is(result.status, 0, output)
      t.regex(result.stdout, /^ports 0$/m, output)
      t.regex(result.stdout, /settled \["d0:resolved"\]/, output)
    },
  )

  /**
   * A work stops being outstanding when its completion callback finishes, not
   * when it starts. Settling a task runs addon code that can re-enter
   * JavaScript, and that JavaScript can call `dispose()` — from inside the very
   * callback that is still settling the promise. A drain that counted the work
   * as already gone would read zero there, destroy the environment mid-frame,
   * and leave the promise unsettled and `finally` unrun: the exact stranding
   * this whole change exists to prevent, reached from the other direction.
   */
  test.skipIf(skip)(
    `a dispose() started from a completion callback still settles it: ${flavor.name}`,
    (t) => {
      const result = runMode('dispose-from-completion', flavor.loader)
      const output = `${result.stdout}\n${result.stderr}`
      t.is(result.error, undefined, result.error?.stack)
      t.is(result.signal, null, output)
      t.is(result.status, 0, output)
      t.regex(result.stdout, /settled \["t0:resolved"\]/, output)
      t.regex(result.stdout, /^finally true$/m, output)
      t.regex(result.stdout, /^ports 0$/m, output)
      // `finally` is what unrefs the object the task holds.
      t.notRegex(result.stderr, /considered as a memory leak/)
    },
  )

  /**
   * Initialization rollback is the same hazard one step earlier: registration
   * runs with a live environment, so a module-init hook can start async work
   * and *then* fail the load. The rollback tears down exactly what that work's
   * completion needs, so it drains first too.
   */
  test.skipIf(skip)(
    `initialization rollback settles outstanding async work: ${flavor.name}`,
    (t) => {
      const result = runMode('rollback', flavor.loader)
      const output = `${result.stdout}\n${result.stderr}`
      t.is(result.error, undefined, result.error?.stack)
      t.is(result.signal, null, output)
      t.is(result.status, 0, output)
      t.regex(result.stdout, /caller survived the failed initialization/)
      t.regex(result.stdout, /^ports 0$/m, output)
      t.regex(result.stdout, /settled \["t0:(resolved|rejected:AbortError)"\]/)
      t.notRegex(result.stderr, /sent an error!/)
    },
  )
}

/**
 * The deferred (workerd) loader is a WASI loader too, with its own per-instance
 * lifecycle rather than the shared prelude — and the same hole: it instantiates
 * the same `emnapiAsyncWorkPlugin`, but its disposal only drained
 * environment-cleanup settlements before destroying the context, so an
 * `AsyncTask` still outstanding was silently stranded.
 *
 * Threadless, so `compute` runs on the JavaScript thread: outstanding work is
 * always queued rather than executing while the test runs.
 */
const deferredBuilt = () =>
  existsSync(join(packageDirectory, 'example.wasm32-wasip1.wasm')) &&
  existsSync(join(packageDirectory, 'example.wasip1-deferred.js'))
const skipDeferred = !inWasiLane || !deferredBuilt()
const DEFERRED_LOADER = 'example.wasip1-deferred.js'

test.skipIf(skipDeferred)(
  'the deferred loader settles outstanding async work on dispose',
  (t) => {
    const result = runMode('deferred-settles', DEFERRED_LOADER)
    const output = `${result.stdout}\n${result.stderr}`
    t.is(result.error, undefined, result.error?.stack)
    t.is(result.signal, null, output)
    t.is(result.status, 0, output)
    t.regex(result.stdout, /^disposed true$/m, output)
    t.regex(result.stdout, /settled \["t0:resolved"\]/, output)
    t.regex(result.stdout, /^ports 0$/m, output)
  },
)

test.skipIf(skipDeferred)(
  'the deferred loader cancels queued async work rather than waiting for it',
  (t) => {
    const result = runMode('deferred-cancel-queued', DEFERRED_LOADER)
    const output = `${result.stdout}\n${result.stderr}`
    t.is(result.error, undefined, result.error?.stack)
    t.is(result.signal, null, output)
    t.is(result.status, 0, output)
    const settled = JSON.parse(
      /settled (\[.*\])/.exec(result.stdout)?.[1] ?? '[]',
    ) as string[]
    t.is(settled.length, 16, output)
    t.true(
      settled.some((entry) => entry.endsWith(':rejected:AbortError')),
      output,
    )
    t.true(
      settled.every(
        (entry) =>
          entry.endsWith(':resolved') || entry.endsWith(':rejected:AbortError'),
      ),
      output,
    )
  },
)

/**
 * Its initialization-failure path destroys the same environment those
 * completions need, so it drains too. Reproduced in the one state that path
 * exists for: registration has run, a module-init hook started async work whose
 * promise already escaped into JavaScript, and only then did the load fail.
 */
test.skipIf(skipDeferred)(
  'the deferred loader settles outstanding async work on initialization rollback',
  (t) => {
    const result = runMode('deferred-rollback', DEFERRED_LOADER)
    const output = `${result.stdout}\n${result.stderr}`
    t.is(result.error, undefined, result.error?.stack)
    t.is(result.signal, null, output)
    t.is(result.status, 0, output)
    t.regex(result.stdout, /caller survived the failed initialization/)
    t.regex(result.stdout, /settled \["t0:(resolved|rejected:AbortError)"\]/)
    t.regex(result.stdout, /^ports 0$/m, output)
  },
)
