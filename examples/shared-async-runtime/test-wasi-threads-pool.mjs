// Threaded WASI lane: the generated loader keeps emnapi's idle Worker pool at
// the count the addon's `napi_wasm_runtime_pool_workers` export reports, after
// the load and after every successful `configureAsyncRuntime`. See the cli's
// docs/wasi.md, "Thread pool preload".
//
// Run `yarn workspace @examples/shared-async-runtime build:wasi-threads` first
// (the CI job does); this file only runs the generated artifacts. Each case is
// a fresh process, because the binding and its runtime are process-wide.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const directory = fileURLToPath(new URL('.', import.meta.url))

function runChild(mode) {
  const result = spawnSync(
    process.execPath,
    ['./wasi-threads-pool-child.cjs', mode],
    {
      cwd: directory,
      encoding: 'utf8',
      timeout: 30_000,
      killSignal: 'SIGKILL',
    },
  )
  const output = `${result.stdout}\n${result.stderr}`
  assert.equal(result.error, undefined, output)
  assert.equal(result.signal, null, output)
  assert.equal(result.status, 0, output)
  const line = /^RESULT (.*)$/m.exec(result.stdout)
  assert.ok(line, output)
  // emnapi's report for a message from a Worker it already terminated.
  assert.doesNotMatch(output, /terminated worker/)
  return { ...JSON.parse(line[1]), output }
}

const nothing = { created: 0, loaded: 0, exited: 0 }

test('the loader publishes the reconcile and wraps configureAsyncRuntime', () => {
  const result = runChild('default')
  assert.deepEqual(result.reconcile, {
    type: 'function',
    enumerable: false,
    writable: false,
  })
  assert.equal(result.configureName, 'configureAsyncRuntime')
  // The wasm default is CurrentThread: no pool Worker.
  assert.deepEqual(result.afterLoad, { poolWorkers: 0, ...nothing })
  assert.equal(result.disposed, true)
})

test('a MultiThread configure preloads one Worker per worker thread', () => {
  const result = runChild('multi-thread')
  assert.deepEqual(result.afterConfigure, {
    poolWorkers: 3,
    created: 3,
    loaded: 0,
    exited: 0,
  })
  assert.equal(result.sum, 101)
  // The runtime's thread spawns took the preloaded Workers.
  assert.deepEqual(result.afterCall, { created: 3, loaded: 3, exited: 0 })
  assert.equal(result.disposed, true)
})

test('a configure back to CurrentThread terminates the idle Workers', () => {
  const result = runChild('shrink')
  assert.deepEqual(result.afterShrink, { poolWorkers: 0 })
  assert.equal(result.sum, 101)
  assert.deepEqual(result.afterCall, { created: 3, loaded: 3, exited: 3 })
  assert.equal(result.disposed, true)
})

test('terminating Workers whose loaded message is still queued reports nothing', () => {
  const result = runChild('shrink-queued')
  assert.deepEqual(result.afterShrink, { created: 3, loaded: 3, exited: 3 })
  assert.equal(result.disposed, true)
})

test('a configure to more workers preloads the missing ones', () => {
  const result = runChild('grow')
  assert.deepEqual(result.afterConfigure, {
    poolWorkers: 2,
    created: 2,
    loaded: 0,
    exited: 0,
  })
  assert.deepEqual(result.afterGrow, {
    poolWorkers: 4,
    created: 4,
    loaded: 0,
    exited: 0,
  })
  assert.equal(result.disposed, true)
})

test('a configure the frozen runtime refuses leaves the pool alone', () => {
  const result = runChild('frozen')
  assert.equal(result.sum, 101)
  assert.equal(
    result.frozenError,
    'the async runtime configuration is frozen; configure it before the first async call',
  )
  assert.deepEqual(result.afterFrozen, {
    poolWorkers: 2,
    created: 2,
    loaded: 2,
    exited: 0,
  })
  assert.equal(result.disposed, true)
})
