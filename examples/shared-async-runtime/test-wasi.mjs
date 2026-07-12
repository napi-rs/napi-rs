// End-to-end threadless-WASI lane: the real `napi-async-runtime` adapter
// compiled into this example's wasm32-wasip1 artifact talking to the real
// `@napi-rs/async-runtime` JavaScript hosts through the generated loader.
//
// Run `yarn workspace @examples/shared-async-runtime build:wasi` first (the
// CI job does); this file only loads the generated artifacts.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'

import {
  CURRENT_THREAD_TASK_HOST_CONTRACT_VERSION,
  installCurrentThreadHosts,
} from '@napi-rs/async-runtime'

const require = createRequire(import.meta.url)

// The eleven host-neutral adapter exports every binding built with
// `napi-async-runtime` must surface, plus this example's own exports. The
// adapter functions are defined in the dependency crate, not this example's
// crate, so their presence proves cross-crate `#[napi]` export registration
// and type-definition collection survive linking.
const ADAPTER_FUNCTION_EXPORTS = [
  'configureAsyncRuntime',
  'getAsyncRuntimeConfig',
  'getAsyncRuntimeMetrics',
  'getCurrentThreadTaskHostContractVersion',
  'isCurrentThreadHostRegistrationActive',
  'registerCurrentThreadTaskHost',
  'registerTimerHost',
  'reserveCurrentThreadHostRegistration',
  'resetAsyncRuntimeMetrics',
  'unregisterCurrentThreadTaskHost',
  'unregisterTimerHost',
]
const EXAMPLE_FUNCTION_EXPORTS = [
  'blockingSum',
  'plus100',
  'raceSleeps',
  'sleepThenAdd',
]

const loaderPath = require.resolve('./shared_async_runtime.wasip1.cjs')
const loaderSource = readFileSync(loaderPath, 'utf8')
const declarations = readFileSync(
  new URL('./index.d.cts', import.meta.url),
  'utf8',
)

test('generated loader is threadless and lists every export', () => {
  // Threadless flavor: no workers, no shared memory, no async work pool.
  assert.doesNotMatch(loaderSource, /node:worker_threads/)
  assert.doesNotMatch(loaderSource, /SharedArrayBuffer/)
  assert.match(loaderSource, /asyncWorkPoolSize:\s*0/)

  const metadata = JSON.parse(
    loaderSource.slice(
      loaderSource.indexOf('napi-rs-artifact-metadata:') +
        'napi-rs-artifact-metadata:'.length,
      loaderSource.indexOf('\n'),
    ),
  )
  for (const name of [
    ...ADAPTER_FUNCTION_EXPORTS,
    ...EXAMPLE_FUNCTION_EXPORTS,
  ]) {
    assert.ok(
      metadata.exports.includes(name),
      `the loader metadata must list \`${name}\``,
    )
    assert.match(
      declarations,
      new RegExp(`^export declare function ${name}\\(`, 'm'),
      `the type declarations must cover \`${name}\``,
    )
  }
})

const binding = require('./shared_async_runtime.wasip1.cjs')

test('adapter exports surface through the loader', () => {
  for (const name of [
    ...ADAPTER_FUNCTION_EXPORTS,
    ...EXAMPLE_FUNCTION_EXPORTS,
  ]) {
    assert.equal(
      typeof binding[name],
      'function',
      `\`${name}\` must be a function export`,
    )
  }
  assert.equal(binding.getCurrentThreadTaskHostContractVersion(), 4)
  assert.equal(
    binding.getCurrentThreadTaskHostContractVersion(),
    CURRENT_THREAD_TASK_HOST_CONTRACT_VERSION,
  )
})

test('configureAsyncRuntime validates and reports before first use', () => {
  assert.throws(
    () => binding.configureAsyncRuntime({ workerThreads: 0.5 }),
    /positive integer/,
  )
  // Still pre-first-use: the module_init `install` only configured the
  // runtime; no async export has dispatched yet.
  binding.configureAsyncRuntime({ flavor: 'CurrentThread' })
  const config = binding.getAsyncRuntimeConfig()
  assert.equal(config.flavor, 'CurrentThread')
  assert.equal(config.workerThreads, 1)
})

let disposeHosts

test('installCurrentThreadHosts installs against the real binding', () => {
  disposeHosts = installCurrentThreadHosts(binding)
  assert.equal(typeof disposeHosts, 'function')
})

test('async exports resolve through the CurrentThread task host', async () => {
  assert.equal(await binding.plus100(41), 141)
  assert.deepEqual(
    await Promise.all([1, 2, 3, 4].map((value) => binding.plus100(value))),
    [101, 102, 103, 104],
  )
})

test('the sleeping export elapses through the JS timer relay', async () => {
  const started = performance.now()
  assert.equal(await binding.sleepThenAdd(20, 22, 150), 42)
  const elapsed = performance.now() - started
  assert.ok(
    elapsed >= 140,
    `the 150ms sleep must actually elapse (took ${elapsed}ms)`,
  )
})

test('the blocking export runs through the scheduler', async () => {
  assert.equal(
    await binding.blockingSum(Array.from({ length: 10 }, (_, i) => i + 1)),
    55,
  )
})

test('dropping a pending sleep drives the timer-host cancel path', async () => {
  // A second live timer host: every live host receives each timer, so this
  // instrumented one observes the relay protocol the package host also
  // speaks, without disturbing it.
  const registration = binding.reserveCurrentThreadHostRegistration()
  assert.ok(Number.isInteger(registration.high))
  assert.ok(Number.isInteger(registration.low))

  const relays = new Map()
  let scheduleCalls = 0
  let cancelCalls = 0
  binding.registerTimerHost(
    registration.high,
    registration.low,
    (relayId, ms) => {
      scheduleCalls += 1
      return new Promise((resolve) => {
        relays.set(relayId, {
          resolve,
          timer: setTimeout(() => {
            relays.delete(relayId)
            resolve()
          }, ms),
        })
      })
    },
    (relayId) => {
      cancelCalls += 1
      const relay = relays.get(relayId)
      if (relay) {
        relays.delete(relayId)
        clearTimeout(relay.timer)
        relay.resolve()
      }
    },
  )

  try {
    assert.equal(
      binding.isCurrentThreadHostRegistrationActive(
        registration.high,
        registration.low,
      ),
      true,
    )

    const started = performance.now()
    // The losing 5s sleep future is dropped as soon as the 30ms sleep wins;
    // the native relay must cancel it on every live host.
    assert.equal(await binding.raceSleeps(30, 5_000), 0)
    const elapsed = performance.now() - started
    assert.ok(
      elapsed < 4_000,
      `the abandoned 5s sleep must not delay the race (took ${elapsed}ms)`,
    )
    assert.ok(scheduleCalls >= 1, 'the instrumented host must see schedules')

    // Cancel delivery is asynchronous; wait for it.
    const deadline = Date.now() + 2_000
    while (cancelCalls === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    assert.ok(
      cancelCalls >= 1,
      'dropping the losing sleep must cancel its relay on this host',
    )
  } finally {
    binding.unregisterTimerHost(registration.high, registration.low)
    for (const relay of relays.values()) {
      clearTimeout(relay.timer)
      relay.resolve()
    }
    relays.clear()
  }
  assert.equal(
    binding.isCurrentThreadHostRegistrationActive(
      registration.high,
      registration.low,
    ),
    false,
  )
})

test('metrics observe the exercised runtime and reset cleanly', () => {
  const metrics = binding.getAsyncRuntimeMetrics()
  assert.equal(metrics.flavor, 'CurrentThread')
  assert.equal(metrics.workerThreads, 1)
  assert.ok(metrics.tasksSpawned >= 3)
  assert.ok(metrics.tasksCompleted >= 3)
  assert.ok(metrics.tasksCompleted <= metrics.tasksSpawned)
  assert.ok(metrics.blockingTasksStarted >= 1)
  assert.ok(metrics.blockingTasksCompleted >= 1)
  assert.equal(metrics.activeBlockingTasks, 0)

  binding.resetAsyncRuntimeMetrics()
  const reset = binding.getAsyncRuntimeMetrics()
  assert.equal(reset.tasksSpawned, 0)
  assert.equal(reset.tasksCompleted, 0)
  // High-water marks survive the reset.
  assert.equal(reset.maxActiveRunnables, metrics.maxActiveRunnables)
})

test('the disposer tears down and a reinstall recovers', async () => {
  assert.equal(await binding.plus100(0), 100)
  disposeHosts()
  // Idempotent.
  disposeHosts()
  const reinstall = installCurrentThreadHosts(binding)
  assert.equal(typeof reinstall, 'function')
  assert.equal(await binding.plus100(1), 101)
})
