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

async function assertIteratorSetupRejects(binding, pattern, phase) {
  for (const [method, argument] of [
    ['next', undefined],
    ['return', undefined],
    ['throw', new Error(`${phase} iterator throw`)],
  ]) {
    const iterator = new binding.RuntimeAsyncIterator()[Symbol.asyncIterator]()
    let promise
    assert.doesNotThrow(() => {
      promise = iterator[method](argument)
    }, `${method}() must not throw synchronously while the runtime is ${phase}`)
    assert.ok(
      promise instanceof Promise,
      `${method}() must return a Promise while the runtime is ${phase}`,
    )
    await assert.rejects(
      promise,
      pattern,
      `${method}() must reject while the runtime is ${phase}`,
    )
  }
}

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

async function captureTsfnThrownValue(thrown) {
  return binding
    .tsfnThrowFromJsCatchRecover(() => {
      throw thrown
    })
    .then(
      () => ({ rejected: false }),
      (value) => ({ rejected: true, value }),
    )
}

for (const thrown of [
  42,
  'primitive throw',
  true,
  null,
  undefined,
  42n,
  Symbol('primitive throw'),
]) {
  const result = await captureTsfnThrownValue(thrown)
  assert.equal(result.rejected, true)
  assert.strictEqual(result.value, thrown)
}

const nonErrorReads = {
  message: 0,
  stack: 0,
  cause: 0,
  coercion: 0,
}
const nonErrorThrownValue = Object.freeze(
  Object.defineProperties(
    {},
    {
      message: {
        get() {
          nonErrorReads.message++
          throw new Error('non-Error message must not be read')
        },
      },
      stack: {
        get() {
          nonErrorReads.stack++
          throw new Error('non-Error stack must not be read')
        },
      },
      cause: {
        get() {
          nonErrorReads.cause++
          throw new Error('non-Error cause must not be read')
        },
      },
      [Symbol.toPrimitive]: {
        value() {
          nonErrorReads.coercion++
          throw new Error('non-Error throw must not be coerced')
        },
      },
    },
  ),
)
const nonErrorResult = await captureTsfnThrownValue(nonErrorThrownValue)
assert.equal(nonErrorResult.rejected, true)
assert.strictEqual(nonErrorResult.value, nonErrorThrownValue)
assert.deepEqual(nonErrorReads, {
  message: 0,
  stack: 0,
  cause: 0,
  coercion: 0,
})

const hostileError = new Error('hostile diagnostics')
const diagnosticReads = {
  message: 0,
  stack: 0,
  cause: 0,
}
Object.defineProperties(hostileError, {
  message: {
    configurable: true,
    get() {
      diagnosticReads.message++
      throw new Error('hostile message getter')
    },
  },
  stack: {
    configurable: true,
    get() {
      diagnosticReads.stack++
      throw new Error('hostile stack getter')
    },
  },
  cause: {
    configurable: true,
    get() {
      diagnosticReads.cause++
      throw new Error('hostile cause getter')
    },
  },
})
const hostileResult = await captureTsfnThrownValue(hostileError)
assert.equal(hostileResult.rejected, true)
assert.strictEqual(hostileResult.value, hostileError)
assert.deepEqual(diagnosticReads, {
  message: 1,
  stack: 1,
  cause: 1,
})

const cause = Object.freeze({ kind: 'retained cause' })
const errorWithCause = new Error('error with cause', { cause })
const causeResult = await captureTsfnThrownValue(errorWithCause)
assert.equal(causeResult.rejected, true)
assert.strictEqual(causeResult.value, errorWithCause)
assert.strictEqual(causeResult.value.cause, cause)

const recovery = Object.freeze({ recovered: true })
const recoveryResult = await captureTsfnThrownValue(recovery)
assert.equal(recoveryResult.rejected, true)
assert.strictEqual(recoveryResult.value, recovery)

await binding.tsfnThrowFromJsCatchDrop(() => {
  throw new Error('drop retained TSFN exception')
})
await new Promise((resolve) => setImmediate(resolve))

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
const cancelledIteratorRejection = assert.rejects(
  cancelledIteratorRequest,
  /cancel/i,
)
binding.shutdownRuntime()
await assert.rejects(cancelled, /cancel/i)
await cancelledIteratorRejection
await new Promise((resolve) => setImmediate(resolve))
await new Promise((resolve) => setImmediate(resolve))
assert.equal(
  cancelledIteratorCoercions,
  0,
  'runtime cancellation must prevent queued async iterator hook admission',
)
let stoppedGeneratedPromise
assert.doesNotThrow(() => {
  stoppedGeneratedPromise = binding.asyncDouble(21)
})
assert.ok(stoppedGeneratedPromise instanceof Promise)
await assert.rejects(stoppedGeneratedPromise, /not accepting/i)
const afterShutdown = binding.getRuntimeMetrics()
assert.equal(afterShutdown.shutdownCalls, beforeLifecycle.shutdownCalls + 1)
// The minimal SPI has no lifecycle gate in napi itself: entering the runtime
// context still works after an explicit shutdown (Tokio-backed in combined
// builds, a bare custom guard in pure builds).
assert.equal(binding.runtimeContextAdd(1), 2)
assert.throws(() => binding.blockOnValue(1), /not running/i)
await assertIteratorSetupRejects(binding, /not accepting/i, 'stopped')

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
  const pending = assert.rejects(
    binding.asyncNever(),
    /task was cancelled before completion/,
  )
  await disposeBinding()
  await pending
}
