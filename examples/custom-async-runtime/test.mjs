import assert from 'node:assert/strict'
import { once } from 'node:events'
import { writeFileSync } from 'node:fs'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { Worker } from 'node:worker_threads'

const mode = process.argv[2] ?? 'native'
assert.ok(
  mode === 'native' ||
    mode === 'wasi' ||
    mode === 'wasi-threads' ||
    mode === 'wasi-threadless',
  `Unknown test mode: ${mode}`,
)

const require = createRequire(import.meta.url)
const isManualThreadlessWasi = mode === 'wasi-threadless'
const isThreadlessWasi = mode === 'wasi' || isManualThreadlessWasi
const isThreadedWasi = mode === 'wasi-threads'
const isWasi = isThreadlessWasi || isThreadedWasi
const bindingFile = isManualThreadlessWasi
  ? './threadless-wasi-loader.cjs'
  : isThreadlessWasi
    ? './custom_async_runtime.wasip1.cjs'
    : isThreadedWasi
      ? './custom_async_runtime.wasi.cjs'
      : './index.cjs'
const resolvedBindingFile = require.resolve(bindingFile)
const declarationFile = isManualThreadlessWasi
  ? process.env.NAPI_RS_TEST_THREADLESS_WASI_DECLARATION
  : new URL('./index.d.cts', import.meta.url)

if (isManualThreadlessWasi && !declarationFile) {
  throw new Error(
    'NAPI_RS_TEST_THREADLESS_WASI_DECLARATION is required for wasi-threadless',
  )
}

if (isWasi) {
  const [source, declarations] = await Promise.all([
    readFile(new URL(bindingFile, import.meta.url), 'utf8'),
    readFile(declarationFile, 'utf8'),
  ])
  if (isThreadlessWasi) {
    assert.doesNotMatch(source, /node:worker_threads/)
    assert.doesNotMatch(source, /\bWorker\b/)
    assert.doesNotMatch(source, /SharedArrayBuffer/)
    assert.match(source, /asyncWorkPoolSize:\s*0/)
  } else {
    assert.match(source, /node:worker_threads/)
    assert.match(source, /\bWorker\b/)
    assert.match(source, /shared:\s*true/)
    assert.match(source, /onCreateWorker/)
  }
  assert.doesNotMatch(source, /retainTaskWaker/)
  assert.doesNotMatch(declarations, /retainTaskWaker/)
}

const loadedBinding = require(bindingFile)
const binding = isManualThreadlessWasi ? loadedBinding.binding : loadedBinding
const disposeBinding = isManualThreadlessWasi
  ? loadedBinding.dispose
  : undefined
const nativeBindingFile =
  mode === 'native'
    ? Object.keys(require.cache).find(
        (filename) =>
          filename.endsWith('.node') &&
          filename.includes('custom_async_runtime'),
      )
    : undefined

async function readFileEventually(path, description) {
  const deadline = Date.now() + 5000
  let lastError
  while (Date.now() < deadline) {
    try {
      return await readFile(path, 'utf8')
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }
  throw new Error(`Timed out waiting for ${description}`, { cause: lastError })
}

const initial = binding.getRuntimeMetrics()

assert.equal(binding.isWasm(), isWasi)
assert.equal(initial.tokioRuntimeEnabled, !isThreadlessWasi)
assert.ok(initial.startCalls >= 1)
assert.equal(initial.activeGuards, 0)

// In combined builds the minimal SPI keeps `within_runtime_if_available`
// Tokio-backed; only pure async-runtime builds route it through the custom
// backend's `enter` guard.
const usesCustomEnterGuard = !initial.tokioRuntimeEnabled
assert.equal(binding.runtimeContextIsActive(), usesCustomEnterGuard)
assert.equal(binding.runtimeContextAdd(41), 42)
const afterEnter = binding.getRuntimeMetrics()
const expectedEnterDelta = usesCustomEnterGuard ? 2 : 0
assert.equal(afterEnter.enterCalls, initial.enterCalls + expectedEnterDelta)
assert.equal(afterEnter.exitCalls, initial.exitCalls + expectedEnterDelta)
assert.equal(afterEnter.activeGuards, 0)

assert.equal(binding.blockOnValue(41), 42)
const afterBlockOn = binding.getRuntimeMetrics()
assert.equal(afterBlockOn.blockOnCalls, initial.blockOnCalls + 1)
assert.ok(afterBlockOn.blockOnPolls >= initial.blockOnPolls + 2)

const beforeBlockingSpawn = binding.getRuntimeMetrics()
binding.rejectNextBlockingSpawn()
assert.throws(
  () => binding.spawnBlockingValue(41),
  (error) => {
    assert.equal(error.code, 'QueueFull')
    assert.equal(error.message, 'custom runtime rejected the blocking task')
    return true
  },
)
if (isThreadlessWasi) {
  assert.throws(
    () => binding.spawnBlockingValue(41),
    /blocking work is unsupported on threadless wasm32-wasip1/i,
  )
} else {
  assert.equal(binding.spawnBlockingValue(41), 42)
}
const afterBlockingSpawn = binding.getRuntimeMetrics()
assert.equal(
  afterBlockingSpawn.spawnBlockingCalls,
  beforeBlockingSpawn.spawnBlockingCalls + (isThreadlessWasi ? 0 : 1),
)

if (mode === 'native') {
  const probeDirectory = await mkdtemp(
    join(tmpdir(), 'napi-custom-runtime-blocking-thread-'),
  )
  const releasePath = join(probeDirectory, 'timer-fired')
  const timerRelease = new Promise((resolve, reject) => {
    setTimeout(() => {
      try {
        writeFileSync(releasePath, 'released')
        resolve()
      } catch (error) {
        reject(error)
      }
    }, 0)
  })
  try {
    const probe = await binding.probeBlockingThread(releasePath)
    await timerRelease
    assert.equal(
      probe.ranOffCallerThread,
      true,
      'native blocking work must run off the JavaScript thread',
    )
    assert.equal(
      probe.observedTimerRelease,
      true,
      'native blocking work must not stall the JavaScript timer that releases it',
    )
  } finally {
    await timerRelease.catch(() => {})
    await rm(probeDirectory, { recursive: true, force: true })
  }
}

const beforeAsync = binding.getRuntimeMetrics()
assert.deepEqual(
  await Promise.all([1, 2, 3, 4].map((value) => binding.asyncDouble(value))),
  [2, 4, 6, 8],
)
assert.equal(await binding.spawnFuture(41), 42)
await assert.rejects(binding.asyncError(), /custom runtime async error/)

if (mode === 'native') {
  await assert.rejects(binding.asyncPanic(), /custom runtime async panic/)
  // A `String` panic payload (here a formatted message) must survive to the
  // rejection instead of collapsing into the generic "Panic in async function".
  await assert.rejects(
    binding.asyncPanicString(7),
    /custom runtime async string panic: 7/,
  )
} else if (mode === 'wasi') {
  // Stable Rust ships wasm32-wasip1 with panic=abort. catch_unwind cannot
  // turn that trap into a Promise rejection, so isolate the public behavior.
  const panicResult = spawnSync(
    process.execPath,
    [
      '-e',
      `
        const binding = require(${JSON.stringify(resolvedBindingFile)})
        try {
          const promise = binding.asyncPanic()
          Promise.resolve(promise).then(
            () => {
              console.error('WASI_PANIC_UNEXPECTEDLY_RESOLVED')
              process.exit(41)
            },
            (error) => {
              console.error('WASI_PANIC_UNEXPECTEDLY_REJECTED', error)
              process.exit(42)
            },
          )
        } catch (error) {
          console.error('WASI_PANIC_ABORT_TRAP', error)
          process.exit(43)
        }
      `,
    ],
    { encoding: 'utf8' },
  )
  const panicOutput = `${panicResult.stdout}\n${panicResult.stderr}`
  assert.equal(panicResult.signal, null, panicOutput)
  assert.equal(panicResult.status, 43, panicOutput)
  assert.match(panicOutput, /WASI_PANIC_ABORT_TRAP/)
  assert.match(panicOutput, /RuntimeError: unreachable/)
  assert.doesNotMatch(panicOutput, /WASI_PANIC_UNEXPECTEDLY_REJECTED/)
}

const afterAsync = binding.getRuntimeMetrics()
const expectedAsyncTasks = mode === 'native' ? 8 : 6
assert.ok(afterAsync.spawnCalls >= beforeAsync.spawnCalls + expectedAsyncTasks)
assert.ok(
  afterAsync.synchronousSpawnCompletions >=
    beforeAsync.synchronousSpawnCompletions + expectedAsyncTasks,
)
assert.ok(
  afterAsync.completedTasks >= beforeAsync.completedTasks + expectedAsyncTasks,
)
assert.ok(
  afterAsync.taskPolls >= beforeAsync.taskPolls + expectedAsyncTasks * 2,
)
assert.ok(afterAsync.wakeCalls >= beforeAsync.wakeCalls + expectedAsyncTasks)

const runtimeIterator = new binding.RuntimeAsyncIterator(3)[
  Symbol.asyncIterator
]()
assert.deepEqual(
  await Promise.all([
    runtimeIterator.next(),
    runtimeIterator.next(),
    runtimeIterator.next(),
    runtimeIterator.next(),
  ]),
  [
    { done: false, value: 0 },
    { done: false, value: 1 },
    { done: false, value: 2 },
    { done: true, value: undefined },
  ],
)

binding.rejectNextSpawn()
await assert.rejects(binding.asyncDouble(1), (error) => {
  assert.equal(error.code, 'QueueFull')
  assert.equal(error.message, 'custom runtime rejected the async task')
  return true
})

const beforeLifecycle = binding.getRuntimeMetrics()
const cancelled = binding.asyncNever()
let cancelledIteratorCoercions = 0
const cancelledIterator = new binding.RuntimeAsyncIterator()[
  Symbol.asyncIterator
]()
const cancelledIteratorRequest = cancelledIterator.throw({
  [Symbol.toPrimitive]() {
    cancelledIteratorCoercions++
    return 'cancelled iterator throw'
  },
})
binding.shutdownRuntime()
await assert.rejects(cancelled, /cancel/i)
// On the minimal SPI there is no admission gate: the throw hook was already
// admitted (and its argument coerced) synchronously when `.throw()` ran on
// the JavaScript thread, so the request settles normally.
assert.deepEqual(await cancelledIteratorRequest, { value: null, done: false })
await new Promise((resolve) => setImmediate(resolve))
await new Promise((resolve) => setImmediate(resolve))
assert.equal(
  cancelledIteratorCoercions,
  1,
  'the async iterator throw hook is admitted before the explicit shutdown',
)
// Direct-executor surfaces observe the stopped runtime until the next napi
// dispatch restarts it.
assert.throws(() => binding.blockOnValue(1), /not running/i)
const afterShutdown = binding.getRuntimeMetrics()
assert.equal(afterShutdown.shutdownCalls, beforeLifecycle.shutdownCalls + 1)
// Combined builds drain the lazily-created Tokio runtime during shutdown, so
// Tokio-backed context entry is unavailable until a new environment
// registration refills it; asserting it here would abort the process.
// A napi-dispatched operation after an explicit shutdown self-heals: the
// registry re-claims the idle backend and runs start() before the spawn.
let restartedGeneratedPromise
assert.doesNotThrow(() => {
  restartedGeneratedPromise = binding.asyncDouble(21)
})
assert.ok(restartedGeneratedPromise instanceof Promise)
assert.equal(await restartedGeneratedPromise, 42)
assert.ok(
  binding.getRuntimeMetrics().startCalls > afterShutdown.startCalls,
  'a dispatch after explicit shutdown restarts the backend',
)
// Restarted: direct-executor surfaces accept work again.
assert.equal(binding.blockOnValue(41), 42)

if (mode === 'native') {
  assert.ok(
    nativeBindingFile,
    'native binding must be present in require.cache',
  )
  // On the minimal SPI every environment registration calls
  // start_async_runtime, so loading the addon in a new worker restarts the
  // explicitly stopped backend instead of observing a sticky shutdown.
  const worker = new Worker(
    `
      const { parentPort } = require('node:worker_threads')
      const binding = require(${JSON.stringify(nativeBindingFile)})
      binding.asyncDouble(21).then(
        (value) => parentPort.postMessage({ value, errors: [] }),
        (error) => parentPort.postMessage({ errors: [String(error)] }),
      )
    `,
    { eval: true },
  )
  const [result] = await once(worker, 'message')
  assert.deepEqual(result.errors, [])
  assert.equal(result.value, 42)
  await worker.terminate()
  assert.ok(
    binding.getRuntimeMetrics().startCalls > afterShutdown.startCalls,
    'a new worker environment must restart the runtime on the minimal SPI',
  )
}

binding.startRuntime()
const afterStart = binding.getRuntimeMetrics()
assert.ok(afterStart.startCalls > afterShutdown.startCalls)
assert.equal(await binding.asyncDouble(21), 42)
if (mode === 'native') {
  assert.equal(
    binding.spawnBlockingValue(21),
    22,
    'native blocking workers must restart with the runtime',
  )
}

if (mode === 'native') {
  assert.ok(
    nativeBindingFile,
    'native binding must be present in require.cache',
  )
  const restoredWorker = new Worker(
    `
      const { parentPort } = require('node:worker_threads')
      const binding = require(${JSON.stringify(nativeBindingFile)})
      binding.asyncDouble(21).then((value) => parentPort.postMessage(value))
    `,
    { eval: true },
  )
  assert.deepEqual(await once(restoredWorker, 'message'), [42])
  await restoredWorker.terminate()

  const missingResult = spawnSync(
    process.execPath,
    [
      '-e',
      `
        const binding = require(${JSON.stringify(nativeBindingFile)})
        const timeout = setTimeout(
          () => {
            console.error('timed out waiting for Tokio-backed async operation')
            process.exitCode = 1
          },
          5000,
        )
        ;(async () => {
          if (binding.getRuntimeMetrics().runtimeRegistrationCalls !== 0) {
            throw new Error('missing-registration fixture unexpectedly registered a custom backend')
          }
          const value = await binding.asyncDouble(21)
          if (value !== 42) {
            throw new Error(\`unexpected Tokio-backed result: \${value}\`)
          }
          console.log('combined missing registration used built-in Tokio')
        })().then(
          () => clearTimeout(timeout),
          (error) => {
            clearTimeout(timeout)
            console.error(error)
            process.exitCode = 1
          },
        )
      `,
    ],
    {
      encoding: 'utf8',
      env: { ...process.env, NAPI_CUSTOM_RUNTIME_TEST_MISSING: '1' },
    },
  )
  assert.equal(
    missingResult.signal,
    null,
    'missing runtime must not abort Node',
  )
  assert.equal(
    missingResult.status,
    0,
    `${missingResult.stdout}\n${missingResult.stderr}`,
  )
  assert.match(missingResult.stdout, /used built-in Tokio/)

  const probeDirectory = await mkdtemp(
    join(tmpdir(), 'napi-custom-runtime-registration-'),
  )
  try {
    // The minimal SPI never fails the module load: a duplicate registration is
    // deferred and rejects every runtime-backed operation, and a failing start
    // is rolled back through shutdown, leaving the backend stopped.
    for (const scenario of [
      {
        env: {
          NAPI_CUSTOM_RUNTIME_TEST_DUPLICATE: '1',
          NAPI_CUSTOM_RUNTIME_TEST_DUPLICATE_PROBE_STARTED: join(
            probeDirectory,
            'duplicate-started',
          ),
          NAPI_CUSTOM_RUNTIME_TEST_DUPLICATE_PROBE_STOPPED: join(
            probeDirectory,
            'duplicate-stopped',
          ),
        },
        pattern: /more than once/i,
        started: join(probeDirectory, 'duplicate-started'),
        stopped: join(probeDirectory, 'duplicate-stopped'),
      },
      {
        env: {
          NAPI_CUSTOM_RUNTIME_TEST_START_ERROR: '1',
          NAPI_CUSTOM_RUNTIME_TEST_START_PROBE_STARTED: join(
            probeDirectory,
            'start-error-started',
          ),
          NAPI_CUSTOM_RUNTIME_TEST_START_PROBE_STOPPED: join(
            probeDirectory,
            'start-error-stopped',
          ),
        },
        pattern: /not accepting/i,
        started: join(probeDirectory, 'start-error-started'),
        stopped: join(probeDirectory, 'start-error-stopped'),
      },
    ]) {
      const result = spawnSync(
        process.execPath,
        [
          '-e',
          `
            const binding = require(${JSON.stringify(nativeBindingFile)})
            binding.asyncDouble(1).then(
              () => {
                console.error('UNEXPECTED_RESOLVE')
                process.exit(41)
              },
              (error) => {
                console.error(String(error))
                process.exit(0)
              },
            )
          `,
        ],
        {
          encoding: 'utf8',
          env: { ...process.env, ...scenario.env },
          timeout: 20_000,
        },
      )
      const output = `${result.stdout}\n${result.stderr}`
      assert.equal(result.error, undefined, result.error?.stack)
      assert.equal(result.signal, null, output)
      assert.equal(result.status, 0, output)
      assert.doesNotMatch(output, /UNEXPECTED_RESOLVE/)
      assert.match(output, scenario.pattern)
      await access(scenario.started)
      await access(scenario.stopped)
    }
  } finally {
    await rm(probeDirectory, { recursive: true, force: true })
  }

  for (let index = 0; index < 20; index++) {
    const worker = new Worker(
      `
        const { parentPort } = require('node:worker_threads')
        const binding = require(${JSON.stringify(nativeBindingFile)})
        binding.asyncNever()
        parentPort.postMessage('pending')
      `,
      { eval: true },
    )
    assert.deepEqual(await once(worker, 'message'), ['pending'])
    await worker.terminate()
  }
  assert.equal(await binding.asyncDouble(11), 22)
}

if (disposeBinding) {
  // On the minimal SPI base the addon cannot settle still-pending promises
  // during context disposal: that requires the napi_prepare_wasm_env_cleanup
  // hook from the full lifecycle surface. Only verify that disposal completes
  // cleanly while work is in flight without trapping.
  binding.asyncNever().catch(() => {})
  await disposeBinding()
}
