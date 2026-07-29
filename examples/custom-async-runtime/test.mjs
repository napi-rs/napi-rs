import assert from 'node:assert/strict'
import { once } from 'node:events'
import { writeFileSync } from 'node:fs'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
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

// Set by `build-threadless-wasi-test.mjs`: a directory holding a *combined*
// `async-runtime` + `tokio_rt` wasm32-wasip1 build of this addon, alongside its
// generated eager loader. Every other lane builds one runtime backend or the
// other; this is the only one where both exist at once.
const combinedWasiDirectory = process.env.NAPI_RS_TEST_COMBINED_WASI_DIR

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
const prepareWasmEnvCleanup = isManualThreadlessWasi
  ? loadedBinding.prepareWasmEnvCleanup
  : undefined
const nativeBindingFile =
  mode === 'native'
    ? Object.keys(require.cache).find(
        (filename) =>
          filename.endsWith('.node') &&
          filename.includes('custom_async_runtime'),
      )
    : undefined

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
// Tokio-backed context entry is unavailable until the next environment
// registration or dispatch-driven self-heal refills it; asserting it here —
// after shutdown but before any dispatch — would abort the process.
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
// The dispatch-driven self-heal restores the drained Tokio peer as well:
// a successful start leaves both halves live.
assert.equal(binding.runtimeContextAdd(1), 2)

if (mode === 'native') {
  assert.ok(
    nativeBindingFile,
    'native binding must be present in require.cache',
  )
  // On the minimal SPI every environment registration calls
  // start_async_runtime, so loading the addon in a new worker restarts the
  // explicitly stopped backend instead of observing a sticky shutdown.
  // Stop the backend again first: the self-heal above already grew
  // startCalls, so this scenario must be measured against a snapshot taken
  // immediately before the worker spawns.
  binding.shutdownRuntime()
  const beforeWorkerRestart = binding.getRuntimeMetrics()
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
    binding.getRuntimeMetrics().startCalls > beforeWorkerRestart.startCalls,
    'a new worker environment must restart the runtime on the minimal SPI',
  )
}

// Stop the backend again so the explicit start below is what restarts it,
// measured against a snapshot taken immediately before the call.
binding.shutdownRuntime()
const beforeExplicitStart = binding.getRuntimeMetrics()
binding.startRuntime()
const afterStart = binding.getRuntimeMetrics()
assert.ok(afterStart.startCalls > beforeExplicitStart.startCalls)
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
  // The barrier alone is NOT enough, and this is the part that is easy to get
  // wrong: `napi_prepare_wasm_env_cleanup` cancels the in-flight tasks and their
  // rejections reach `napi_call_threadsafe_function`, but that call only appends
  // to the threadsafe-function queue. @emnapi/core dispatches that queue from a
  // macrotask two coalescing turns later, and `context.destroy()` drains it with
  // a null env and discards whatever is left. A loader that runs the barrier and
  // `destroy()` back to back therefore strands exactly the promises the barrier
  // exists to settle.
  //
  // So the real disposal path is asserted end to end below, in its own process.
  // The hand-driven barrier here only proves the *ordering* — that the backend
  // is already down while the environment can still call into JavaScript — and
  // it must not be mistaken for coverage of `dispose()`: awaiting the rejection
  // in between is what makes this variant work.
  //
  // `napi-build` links both symbols with `--export-if-defined` and the loaders
  // guard the calls with `typeof`, so a binary without them loads and runs
  // exactly as if nothing were wrong. Fail loudly instead.
  assert.equal(
    loadedBinding.hasWasmEnvCleanupExport,
    true,
    'the wasm binary must export napi_prepare_wasm_env_cleanup, otherwise the loader silently skips the teardown barrier',
  )
  assert.equal(
    loadedBinding.hasWasmEnvCleanupPendingExport,
    true,
    'the wasm binary must export napi_wasm_env_cleanup_pending, otherwise the loader cannot tell when the queued settlements have been dispatched and falls back to guessing turns',
  )

  // The arbiter: the ordinary `dispose()` path, with no manual barrier call and
  // nothing awaited in between. Run it in its own process so a promise that
  // never settles shows up as a stranded promise here and not as a hang
  // somewhere else.
  const ordinaryDispose = spawnSync(
    process.execPath,
    [
      '-e',
      `
        const loaded = require(${JSON.stringify(resolvedBindingFile)})
        const timeout = setTimeout(() => {
          console.error('ORDINARY_DISPOSE_TIMEOUT')
          process.exit(46)
        }, 30_000)
        timeout.unref?.()
        let outcome = 'PENDING'
        const stranded = loaded.binding.asyncNever()
        stranded.then(
          () => { outcome = 'RESOLVED' },
          (error) => { outcome = 'REJECTED: ' + error.message },
        )
        loaded.dispose().then(
          async () => {
            // Well past the two turns @emnapi/core needs: if the settlement did
            // not land by now, it never will.
            for (let index = 0; index < 50; index++) {
              await new Promise((resolve) => setImmediate(resolve))
            }
            console.error('ORDINARY_DISPOSE_OUTCOME ' + outcome)
            process.exit(outcome.startsWith('REJECTED: ') ? 0 : 47)
          },
          (error) => {
            console.error('ORDINARY_DISPOSE_THREW', error)
            process.exit(48)
          },
        )
      `,
    ],
    { encoding: 'utf8', timeout: 60_000 },
  )
  const ordinaryDisposeOutput = `${ordinaryDispose.stdout}\n${ordinaryDispose.stderr}`
  assert.equal(ordinaryDispose.error, undefined, ordinaryDispose.error?.stack)
  assert.equal(ordinaryDispose.signal, null, ordinaryDisposeOutput)
  assert.equal(
    ordinaryDispose.status,
    0,
    `dispose() must settle the promise of a task its teardown barrier cancelled, without the caller driving the barrier by hand:\n${ordinaryDisposeOutput}`,
  )
  assert.match(ordinaryDisposeOutput, /ORDINARY_DISPOSE_OUTCOME REJECTED: /)

  // The other arbiter, and the one a drain can never satisfy: barrier and
  // `Context.destroy()` in a single synchronous turn, with nothing awaited in
  // between. A host may have no choice — `process.on('exit')` cannot yield, and
  // a caller holding the emnapi context can just call `destroy()` — so the
  // barrier has to *deliver* the settlements it produces on this thread rather
  // than leave them in a queue @emnapi/core would dispatch two macrotasks later
  // and `destroy()` would discard with a null env.
  const synchronousDispose = spawnSync(
    process.execPath,
    [
      '-e',
      `
        const loaded = require(${JSON.stringify(resolvedBindingFile)})
        const timeout = setTimeout(() => {
          console.error('SYNC_DISPOSE_TIMEOUT')
          process.exit(46)
        }, 30_000)
        timeout.unref?.()
        let outcome = 'PENDING'
        const stranded = loaded.binding.asyncNever()
        stranded.then(
          () => { outcome = 'RESOLVED' },
          (error) => { outcome = 'REJECTED: ' + error.message },
        )
        loaded.prepareWasmEnvCleanup()
        // Nothing may be left in the threadsafe-function queue: whatever the
        // barrier settled here never entered it, and the synchronous destroy
        // below is about to throw the queue away.
        const queued = loaded.wasmEnvCleanupPending()
        loaded.disposeSync()
        ;(async () => {
          // Well past the two turns @emnapi/core needs: if the settlement did
          // not land by now, it never will.
          for (let index = 0; index < 50; index++) {
            await new Promise((resolve) => setImmediate(resolve))
          }
          console.error('SYNC_DISPOSE_QUEUED ' + queued)
          console.error('SYNC_DISPOSE_OUTCOME ' + outcome)
          process.exit(outcome.startsWith('REJECTED: ') && queued === 0 ? 0 : 47)
        })()
      `,
    ],
    { encoding: 'utf8', timeout: 60_000 },
  )
  const synchronousDisposeOutput = `${synchronousDispose.stdout}\n${synchronousDispose.stderr}`
  assert.equal(
    synchronousDispose.error,
    undefined,
    synchronousDispose.error?.stack,
  )
  assert.equal(synchronousDispose.signal, null, synchronousDisposeOutput)
  assert.equal(
    synchronousDispose.status,
    0,
    `the barrier must deliver its settlements, not queue them: a barrier followed by a synchronous Context.destroy() in the same turn must still settle the promise of a task it cancelled:\n${synchronousDisposeOutput}`,
  )
  assert.match(synchronousDisposeOutput, /SYNC_DISPOSE_QUEUED 0/)
  assert.match(synchronousDisposeOutput, /SYNC_DISPOSE_OUTCOME REJECTED: /)

  const beforeDispose = binding.getRuntimeMetrics()
  const stranded = binding.asyncNever()
  let strandedOutcome = 'still pending'
  const strandedSettlement = stranded.then(
    () => (strandedOutcome = 'resolved'),
    (error) => (strandedOutcome = `rejected: ${error.message}`),
  )
  prepareWasmEnvCleanup()
  const afterBarrier = binding.getRuntimeMetrics()
  assert.equal(
    afterBarrier.shutdownCalls,
    beforeDispose.shutdownCalls + 1,
    'the barrier must shut the backend down before the environment is destroyed',
  )
  // The environment is still live at this point: reading metrics is a napi call
  // into a still-active env, and it would throw if the barrier had run too late.
  assert.equal(afterBarrier.backendIdentity, beforeDispose.backendIdentity)
  // Nothing was left for the drain to wait on: the rejection went straight into
  // the promise instead of onto the threadsafe-function queue.
  assert.equal(
    loadedBinding.wasmEnvCleanupPending(),
    0,
    'the barrier must leave nothing queued for a settlement it made on this thread',
  )
  // And it landed within a microtask of the barrier returning — no event-loop
  // turn, which is the whole difference between delivering and queueing.
  await Promise.resolve()
  assert.match(
    strandedOutcome,
    /^rejected: /,
    'the in-flight promise must be rejected by the barrier itself, not a later macrotask',
  )
  // The cancelled task settles its promise through the environment the barrier
  // deliberately kept alive.
  assert.match(
    await Promise.race([
      strandedSettlement,
      new Promise((resolve) =>
        setTimeout(() => resolve('still pending'), 5_000),
      ),
    ]),
    /^rejected: /,
    'the in-flight promise must be settled by the barrier, not stranded',
  )
  await disposeBinding()
}

if (isThreadlessWasi) {
  // The drain is an event loop, and that is the part that bites: between its
  // macrotask turns JavaScript runs, including the rejection handlers of the
  // very promises the barrier just cancelled. An addon export called from one of
  // those handlers used to walk straight back into the dispatch path, where
  // `ensure_started` found the `Idle` phase the teardown left behind and started
  // the backend again — after its `shutdown` had already reported quiescence.
  // Nothing in the threadsafe-function queue represents that restarted work, so
  // `napi_wasm_env_cleanup_pending` reads zero, the drain stops waiting, and
  // `Context.destroy()` runs with the work still live: its promise is stranded,
  // which is exactly the failure the barrier exists to prevent.
  //
  // So the barrier latches the runtime against restart for the rest of the
  // disposal, and a runtime-backed call made during it rejects with a defined
  // error instead of silently reviving the backend.
  //
  // Driven through the *generated* loader, because the generated drain is what
  // opens the window, and in its own process so a promise that never settles
  // shows up as a stranded promise here rather than a hang somewhere else.
  const generatedEagerLoader = join(
    dirname(fileURLToPath(import.meta.url)),
    'custom_async_runtime.wasip1.cjs',
  )
  await access(generatedEagerLoader)

  const restartDuringDrain = spawnSync(
    process.execPath,
    [
      '-e',
      `
        const binding = require(${JSON.stringify(generatedEagerLoader)})
        const dispose = binding[Symbol.for('napi.rs.wasi.dispose')]
        const timeout = setTimeout(() => {
          console.error('RESTART_DRAIN_TIMEOUT')
          process.exit(46)
        }, 30_000)
        timeout.unref?.()

        const before = binding.getRuntimeMetrics()
        let handler = 'HANDLER_DID_NOT_RUN'
        let reentrant = 'PENDING'
        let reentrantCode = 'NONE'
        let disposeSettled = false
        let settledBeforeDestroy = false

        // Cancelled by the barrier's shutdown; its rejection handler is the
        // reentrancy vector.
        binding.asyncNever().catch(() => {
          const promise = binding.asyncNever()
          promise.then(
            () => {
              reentrant = 'RESOLVED'
              settledBeforeDestroy = !disposeSettled
            },
            (error) => {
              reentrant = 'REJECTED: ' + error.message
              reentrantCode = String(error.code)
              settledBeforeDestroy = !disposeSettled
            },
          )
          const during = binding.getRuntimeMetrics()
          handler =
            'startCalls=' + during.startCalls +
            ' shutdownCalls=' + during.shutdownCalls +
            ' spawnCalls=' + during.spawnCalls
        })

        // Force a real drain: this settlement goes through the
        // threadsafe-function queue, so the barrier leaves a non-zero pending
        // count and the loader has to yield event-loop turns.
        binding.asyncDouble(21).catch(() => {})

        dispose().then(
          async () => {
            disposeSettled = true
            for (let index = 0; index < 60; index++) {
              await new Promise((resolve) => setImmediate(resolve))
            }
            console.error('RESTART_DRAIN_BEFORE startCalls=' + before.startCalls)
            console.error('RESTART_DRAIN_HANDLER ' + handler)
            console.error('RESTART_DRAIN_REENTRANT ' + reentrant)
            console.error('RESTART_DRAIN_CODE ' + reentrantCode)
            console.error('RESTART_DRAIN_BEFORE_DESTROY ' + settledBeforeDestroy)
            process.exit(0)
          },
          (error) => {
            console.error('RESTART_DRAIN_DISPOSE_THREW', error)
            process.exit(48)
          },
        )
      `,
    ],
    { encoding: 'utf8', timeout: 60_000 },
  )
  const restartDuringDrainOutput = `${restartDuringDrain.stdout}\n${restartDuringDrain.stderr}`
  assert.equal(
    restartDuringDrain.error,
    undefined,
    restartDuringDrain.error?.stack,
  )
  assert.equal(restartDuringDrain.signal, null, restartDuringDrainOutput)
  assert.equal(restartDuringDrain.status, 0, restartDuringDrainOutput)
  // The handler has to have run at all, otherwise everything below is vacuous.
  assert.match(
    restartDuringDrainOutput,
    /RESTART_DRAIN_HANDLER startCalls=/,
    `the barrier must reject the in-flight promise while the loader can still run its handler:\n${restartDuringDrainOutput}`,
  )
  // The latch: the backend must not have been started a second time.
  assert.match(
    restartDuringDrainOutput,
    /RESTART_DRAIN_BEFORE startCalls=1\b/,
    restartDuringDrainOutput,
  )
  assert.match(
    restartDuringDrainOutput,
    /RESTART_DRAIN_HANDLER startCalls=1 shutdownCalls=1\b/,
    `an addon export called during disposal must not restart the backend the cleanup barrier shut down:\n${restartDuringDrainOutput}`,
  )
  // …and the call it refused must still be answered, before the environment goes
  // away, rather than left pending forever.
  assert.match(
    restartDuringDrainOutput,
    /RESTART_DRAIN_REENTRANT REJECTED: the wasm environment is being disposed/,
    `a runtime-backed call made during disposal must reject with a defined error, not strand its promise:\n${restartDuringDrainOutput}`,
  )
  assert.match(restartDuringDrainOutput, /RESTART_DRAIN_CODE Cancelled/)
  assert.match(
    restartDuringDrainOutput,
    /RESTART_DRAIN_BEFORE_DESTROY true/,
    `the rejection must reach JavaScript before Context.destroy(), which is what the drain is for:\n${restartDuringDrainOutput}`,
  )
}

if (isThreadlessWasi) {
  // The drain is the one part of disposal that can fail on its own: it yields
  // real event-loop turns, and scheduling a macrotask is a host call. A
  // host-provided or patched `setImmediate` that throws makes the very first
  // turn reject, and the loaders keep disposal retryable after a rejection —
  // `__wasiDisposePromise` is cleared, `dispose()` can be called again.
  //
  // So the "already drained" flag may not be set before the wait has actually
  // finished. Set up front, the retry skips the drain entirely and destroys the
  // context with the barrier's settlements still in the threadsafe-function
  // queue, where `Context.destroy()`'s cleanup hook discards them with a null
  // env — the promises the barrier exists to settle hang forever, and this time
  // nothing is left that could ever settle them.
  //
  // Both generated loaders track the flag separately, so both are driven.
  const packageDirectory = dirname(fileURLToPath(import.meta.url))
  const eagerLoaderPath = join(
    packageDirectory,
    'custom_async_runtime.wasip1.cjs',
  )
  const deferredLoaderPath = join(
    packageDirectory,
    'custom_async_runtime.wasip1-deferred.js',
  )
  const wasmPath = join(
    packageDirectory,
    'custom_async_runtime.wasm32-wasip1.wasm',
  )
  await access(eagerLoaderPath)
  await access(deferredLoaderPath)

  for (const flavor of ['eager', 'deferred']) {
    const load =
      flavor === 'eager'
        ? `
        const require = createRequire(${JSON.stringify(import.meta.url)})
        const binding = require(${JSON.stringify(eagerLoaderPath)})
        const dispose = binding[Symbol.for('napi.rs.wasi.dispose')]
      `
        : `
        const { createInstance } = await import(
          pathToFileURL(${JSON.stringify(deferredLoaderPath)}).href
        )
        const wasmModule = await WebAssembly.compile(
          readFileSync(${JSON.stringify(wasmPath)}),
        )
        const instance = await createInstance(wasmModule)
        const binding = instance.exports
        const dispose = () => instance.dispose()
      `
    const poisonedDrain = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `
        import { readFileSync } from 'node:fs'
        import { createRequire } from 'node:module'
        import { pathToFileURL } from 'node:url'

        const realSetImmediate = globalThis.setImmediate
        const timeout = setTimeout(() => {
          console.error('POISONED_DRAIN_TIMEOUT')
          process.exit(46)
        }, 30_000)
        timeout.unref?.()

        ${load}

        // In flight when the barrier runs, so its cancellation settle goes
        // through the threadsafe-function queue and the drain has something to
        // wait for.
        let queued = 'PENDING'
        binding.asyncDouble(21).then(
          (value) => { queued = 'RESOLVED: ' + value },
          (error) => { queued = 'REJECTED: ' + error.message },
        )

        // Break only the drain's scheduling: the barrier itself must still run,
        // otherwise this proves nothing.
        let broken = true
        globalThis.setImmediate = function (...args) {
          if (broken) {
            throw new Error('host setImmediate is broken')
          }
          return realSetImmediate(...args)
        }

        let first = 'RESOLVED'
        try {
          await dispose()
        } catch (error) {
          first = 'REJECTED: ' + error.message
        }

        broken = false
        globalThis.setImmediate = realSetImmediate

        let second = 'RESOLVED'
        try {
          await dispose()
        } catch (error) {
          second = 'REJECTED: ' + error.message
        }

        // Well past the two turns @emnapi/core needs: if the settlement did not
        // land by now, it never will.
        for (let index = 0; index < 80; index++) {
          await new Promise((resolve) => realSetImmediate(resolve))
        }
        console.error('POISONED_DRAIN_FIRST ' + first)
        console.error('POISONED_DRAIN_SECOND ' + second)
        console.error('POISONED_DRAIN_QUEUED ' + queued)
        process.exit(0)
      `,
      ],
      { encoding: 'utf8', timeout: 60_000 },
    )
    const poisonedDrainOutput = `${poisonedDrain.stdout}\n${poisonedDrain.stderr}`
    assert.equal(poisonedDrain.error, undefined, poisonedDrain.error?.stack)
    assert.equal(poisonedDrain.signal, null, poisonedDrainOutput)
    assert.equal(poisonedDrain.status, 0, poisonedDrainOutput)
    // The first disposal has to have failed *in the drain*, otherwise the retry
    // below never exercises the flag and everything after it is vacuous.
    assert.match(
      poisonedDrainOutput,
      /POISONED_DRAIN_FIRST REJECTED: host setImmediate is broken/,
      `the ${flavor} loader's drain must surface a failed macrotask schedule:\n${poisonedDrainOutput}`,
    )
    assert.match(
      poisonedDrainOutput,
      /POISONED_DRAIN_SECOND RESOLVED/,
      `the ${flavor} loader's retried disposal must succeed:\n${poisonedDrainOutput}`,
    )
    assert.match(
      poisonedDrainOutput,
      /POISONED_DRAIN_QUEUED RESOLVED: 42/,
      `a drain that failed must not mark itself complete: the ${flavor} loader's retried disposal has to wait for the queued settlements again instead of destroying the environment out from under them:\n${poisonedDrainOutput}`,
    )
  }
}

if (combinedWasiDirectory) {
  // A combined `async-runtime` + `tokio_rt` build is the configuration in which
  // napi's Tokio compatibility helpers (`napi::spawn`, `napi::block_on`,
  // `napi::spawn_blocking`) are the most dangerous thing a synchronous export
  // can reach during the drain. A custom backend owns the runtime lifecycle, so
  // the built-in `RT` slot is never constructed and the barrier's
  // `shutdown_async_runtime` has nothing to drain — a helper called from a
  // disposal-time JavaScript callback would force `RT`'s `LazyLock` and get a
  // brand-new Tokio runtime, *after* the barrier declared the environment
  // quiescent. That work is in no threadsafe-function queue, so
  // `napi_wasm_env_cleanup_pending` reads zero, the drain stops, and
  // `Context.destroy()` arrives with it still live.
  //
  // The helpers hand back a `JoinHandle` or the future's own output, so unlike
  // an async export they cannot degrade to a rejection. They refuse loudly
  // instead — which is what they already did in every configuration whose
  // runtime the teardown actually drained.
  const combinedLoader = join(
    combinedWasiDirectory,
    'custom_async_runtime.wasip1.cjs',
  )
  await access(combinedLoader)

  // Before the barrier the helpers are ordinary working API. Its own process,
  // because merely calling one forces `RT`'s `LazyLock` — which is precisely
  // the state the `cold` runs below must not be in.
  const helperBeforeBarrier = spawnSync(
    process.execPath,
    [
      '-e',
      `
        const binding = require(${JSON.stringify(combinedLoader)})
        console.error('TOKIO_HELPER_BEFORE ' + binding.tokioHelperProbe('block_on'))
      `,
    ],
    { encoding: 'utf8', timeout: 60_000 },
  )
  const helperBeforeOutput = `${helperBeforeBarrier.stdout}\n${helperBeforeBarrier.stderr}`
  assert.equal(helperBeforeBarrier.status, 0, helperBeforeOutput)
  assert.match(
    helperBeforeOutput,
    /TOKIO_HELPER_BEFORE 2/,
    `napi::block_on must still work before the cleanup barrier, otherwise the refusals below prove nothing:\n${helperBeforeOutput}`,
  )

  for (const helper of ['spawn', 'block_on', 'spawn_blocking']) {
    // `cold` is the hole: nothing has forced `RT`, so the barrier's shutdown
    // had nothing to drain and there is no empty slot to fall over on — without
    // the latch the helper quietly builds a runtime and takes the work.
    // `warm` forced `RT` first, so the barrier drained it and the helper would
    // have panicked on the empty slot anyway; the latch has to reach that case
    // too, with the same diagnostic.
    for (const warmth of ['cold', 'warm']) {
      const helperDuringDrain = spawnSync(
        process.execPath,
        [
          '-e',
          `
        const binding = require(${JSON.stringify(combinedLoader)})
        const dispose = binding[Symbol.for('napi.rs.wasi.dispose')]
        const timeout = setTimeout(() => {
          console.error('TOKIO_HELPER_TIMEOUT')
          process.exit(46)
        }, 30_000)
        timeout.unref?.()

        if (${JSON.stringify(warmth)} === 'warm') {
          binding.tokioHelperProbe('block_on')
        }

        let outcome = 'HANDLER_DID_NOT_RUN'
        binding.asyncNever().catch(() => {
          try {
            outcome = 'RETURNED: ' + binding.tokioHelperProbe(${JSON.stringify(helper)})
          } catch (error) {
            outcome = 'REFUSED: ' + (error && error.message)
          }
        })
        // Force a real drain, so the callback above runs between its turns.
        binding.asyncDouble(21).catch(() => {})

        dispose().then(
          () => {
            console.error('TOKIO_HELPER_OUTCOME ' + outcome)
            process.exit(0)
          },
          (error) => {
            console.error('TOKIO_HELPER_DISPOSE_THREW ' + (error && error.message))
            console.error('TOKIO_HELPER_OUTCOME ' + outcome)
            process.exit(0)
          },
        )
      `,
        ],
        { encoding: 'utf8', timeout: 60_000 },
      )
      const helperOutput = `${helperDuringDrain.stdout}\n${helperDuringDrain.stderr}`
      assert.equal(
        helperDuringDrain.error,
        undefined,
        helperDuringDrain.error?.stack,
      )
      assert.equal(helperDuringDrain.signal, null, helperOutput)
      assert.equal(helperDuringDrain.status, 0, helperOutput)
      // The handler has to have run at all, otherwise everything below is
      // vacuous.
      assert.match(
        helperOutput,
        /TOKIO_HELPER_OUTCOME (RETURNED|REFUSED): /,
        `the barrier must reject the in-flight promise while the loader can still run its handler (${warmth}):\n${helperOutput}`,
      )
      assert.doesNotMatch(
        helperOutput,
        /TOKIO_HELPER_OUTCOME RETURNED: /,
        `napi::${helper} must not accept work after the cleanup barrier (${warmth}) — in this build it would construct a brand-new Tokio runtime the drain cannot see:\n${helperOutput}`,
      )
      // A wasm panic aborts to an `unreachable` trap, which JavaScript sees as
      // a thrown error from the offending call; the diagnostic itself goes to
      // stderr. Assert on the diagnostic, so a refusal for some *other* reason
      // (a drained slot, a failed worker-thread spawn) cannot pass for this
      // one.
      assert.match(
        helperOutput,
        new RegExp(
          `napi::${helper} cannot run: the wasm environment is being disposed`,
        ),
        `napi::${helper} must say why it refused (${warmth}):\n${helperOutput}`,
      )
    }
  }
}

if (isManualThreadlessWasi) {
  // Initialization rollback has to drain too, and it is easy to convince
  // yourself it does not need to. Registration runs with a *live* environment,
  // so a module-init hook can start a task and only then fail: the barrier
  // cancels that task and `napi_call_threadsafe_function` merely appends the
  // rejection to a queue @emnapi/core dispatches from a macrotask. A rollback
  // that destroys the context in the same turn drains that queue with a null env
  // and discards it — and the promise has already escaped into JavaScript, so it
  // hangs forever with nobody left to settle it.
  //
  // Both generated loaders are driven, because they roll back through different
  // code: the eager CJS loader through `__rollbackWasiInitialization`, the
  // deferred loader through `__createInstance`'s catch.
  const packageDirectory = dirname(fileURLToPath(import.meta.url))
  const eagerLoaderPath = join(
    packageDirectory,
    'custom_async_runtime.wasip1.cjs',
  )
  const deferredLoaderPath = join(
    packageDirectory,
    'custom_async_runtime.wasip1-deferred.js',
  )
  const wasmPath = join(
    packageDirectory,
    'custom_async_runtime.wasm32-wasip1.wasm',
  )
  await access(eagerLoaderPath)
  await access(deferredLoaderPath)

  for (const flavor of ['eager', 'deferred']) {
    const load =
      flavor === 'eager'
        ? `
        const require = createRequire(${JSON.stringify(import.meta.url)})
        try {
          require(${JSON.stringify(eagerLoaderPath)})
        } catch (error) {
          loadError = error
        }
      `
        : `
        const { createInstance } = await import(
          pathToFileURL(${JSON.stringify(deferredLoaderPath)}).href
        )
        const wasmModule = await WebAssembly.compile(
          readFileSync(${JSON.stringify(wasmPath)}),
        )
        try {
          await createInstance(wasmModule)
        } catch (error) {
          loadError = error
        }
      `
    const rollbackDrain = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `
        import { readFileSync } from 'node:fs'
        import { createRequire } from 'node:module'
        import { pathToFileURL } from 'node:url'

        globalThis.__napiCustomRuntimeFailRegistrationAfterSpawn = true
        let outcome = 'PENDING'
        // Attach the settlement handlers the instant registration stashes the
        // promise: the deferred loader drains inside its catch, so the
        // settlement lands before createInstance() ever rejects.
        Object.defineProperty(globalThis, '__napiRegistrationSpawnedPromise', {
          configurable: true,
          get() {
            return undefined
          },
          set(promise) {
            Object.defineProperty(globalThis, '__napiRegistrationSpawnedPromise', {
              configurable: true,
              writable: true,
              value: promise,
            })
            promise.then(
              () => { outcome = 'RESOLVED' },
              (error) => { outcome = 'REJECTED: ' + error.message },
            )
          },
        })
        const timeout = setTimeout(() => {
          console.error('ROLLBACK_DRAIN_TIMEOUT')
          process.exit(46)
        }, 30_000)
        timeout.unref?.()
        let loadError
        ${load}
        if (!loadError) {
          console.error('ROLLBACK_DRAIN_DID_NOT_FAIL')
          process.exit(47)
        }
        // Well past the two turns @emnapi/core needs: if the settlement did not
        // land by now, it never will.
        for (let index = 0; index < 80; index++) {
          await new Promise((resolve) => setImmediate(resolve))
        }
        console.error('ROLLBACK_DRAIN_OUTCOME ' + outcome)
        process.exit(outcome.startsWith('REJECTED: ') ? 0 : 48)
      `,
      ],
      { encoding: 'utf8', timeout: 60_000 },
    )
    const rollbackDrainOutput = `${rollbackDrain.stdout}\n${rollbackDrain.stderr}`
    assert.equal(rollbackDrain.error, undefined, rollbackDrain.error?.stack)
    assert.equal(rollbackDrain.signal, null, rollbackDrainOutput)
    assert.equal(
      rollbackDrain.status,
      0,
      `the ${flavor} loader's initialization rollback must settle the promise of a task its teardown barrier cancelled, not destroy the environment out from under it:\n${rollbackDrainOutput}`,
    )
    assert.match(rollbackDrainOutput, /ROLLBACK_DRAIN_OUTCOME REJECTED: /)
  }

  // …and the rollback's drain can fail on its own, exactly like the drain in
  // `dispose()`: it yields real event-loop turns, and scheduling a macrotask is
  // a host call that a host-provided or patched `setImmediate` can make throw.
  //
  // `dispose()` answers that by not destroying — a rejected drain never reaches
  // `__continueWasiDisposal` — which leaves the queued settlements where they
  // are and keeps the disposal retryable. The rollback has to answer the same
  // way. Destroying anyway cannot deliver those settlements: `Context.destroy()`
  // runs the threadsafe function's cleanup hook, which drains the queue with a
  // null env and discards it, so a promise that already escaped into JavaScript
  // hangs forever with nothing left that could ever settle it. And it buys very
  // little — `Context.destroy()` does not free the wasm instance or its Memory,
  // which the loader's module scope holds either way.
  //
  // So the assertion is in two halves, and both matter: the escaped promise must
  // still settle, *and* the context the rollback declined to destroy must still
  // be reclaimable — through the process-wide registry replay for the eager CJS
  // loader, through the managed destroyer `dispose()` drains for the deferred
  // one. Otherwise this would trade a visible stranding for an invisible leak.
  //
  // The poison is installed from the registration hook, after emnapi's
  // `createContext()` has bound `features.setImmediate` to the real global.
  // Breaking it any earlier would break @emnapi/core's own dispatch too, and
  // then nothing could settle the promise no matter what the loader did.
  for (const flavor of ['eager', 'deferred']) {
    const load =
      flavor === 'eager'
        ? `
        const require = createRequire(${JSON.stringify(import.meta.url)})
        try {
          require(${JSON.stringify(eagerLoaderPath)})
        } catch (error) {
          loadError = error
        }
      `
        : `
        const loader = await import(
          pathToFileURL(${JSON.stringify(deferredLoaderPath)}).href
        )
        const wasmModule = await WebAssembly.compile(
          readFileSync(${JSON.stringify(wasmPath)}),
        )
        try {
          await loader.createInstance(wasmModule)
        } catch (error) {
          loadError = error
        }
      `
    // Run only once the first rollback has settled: the eager loader throws out
    // of `require()` while its drain is still in flight, and the registry replay
    // deliberately refuses to re-enter a rollback that is still active.
    //
    // Each flavor is watched through the handle its own retry machinery uses —
    // the process-wide rollback registry, and the managed destroyer set behind
    // the beforeExit listener. Both must read "held" before the retry and
    // "released" after, so neither half of the assertion can pass vacuously.
    const retryTeardown =
      flavor === 'eager'
        ? `
        const registry = process[Symbol.for('napi.rs.wasi.rollback.registry.v1')]
        const held = () =>
          registry ? registry.has(${JSON.stringify(eagerLoaderPath)}) : false
        console.error('ROLLBACK_POISONED_HELD ' + held())
        // The registry replay: re-requiring the loader must re-run the rollback
        // it left unfinished rather than re-instantiate, and finish it this time.
        let retry = 'DID_NOT_THROW'
        try {
          require(${JSON.stringify(eagerLoaderPath)})
        } catch (error) {
          retry = 'THREW: ' + error.message
        }
        for (let index = 0; index < 20; index++) {
          await new Promise((resolve) => realSetImmediate(resolve))
        }
        console.error('ROLLBACK_POISONED_RETRY ' + retry)
        console.error('ROLLBACK_POISONED_RETAINED ' + held())
      `
        : `
        // The managed destroyer set is private, but it is exactly what keeps the
        // loader's beforeExit listener registered: the last destroyer to go
        // removes it.
        const held = () => process.listenerCount('beforeExit') !== 0
        console.error('ROLLBACK_POISONED_HELD ' + held())
        // The catch registered this context precisely so an unfinished rollback
        // stays reclaimable, so dispose() must run its destroyer.
        let retry = 'RESOLVED'
        try {
          await loader.dispose()
        } catch (error) {
          retry = 'THREW: ' + error.message
        }
        console.error('ROLLBACK_POISONED_RETRY ' + retry)
        console.error('ROLLBACK_POISONED_RETAINED ' + held())
      `
    const poisonedRollback = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `
        import { readFileSync } from 'node:fs'
        import { createRequire } from 'node:module'
        import { pathToFileURL } from 'node:url'

        const realSetImmediate = globalThis.setImmediate
        const timeout = setTimeout(() => {
          console.error('ROLLBACK_POISONED_TIMEOUT')
          process.exit(46)
        }, 30_000)
        timeout.unref?.()

        globalThis.__napiCustomRuntimeFailRegistrationAfterSpawn = true
        let queued = 'PENDING'
        let cancelled = 'PENDING'
        const watch = (name, settle) => {
          Object.defineProperty(globalThis, name, {
            configurable: true,
            get() {
              return undefined
            },
            set(promise) {
              Object.defineProperty(globalThis, name, {
                configurable: true,
                writable: true,
                value: promise,
              })
              promise.then(
                (value) => settle('RESOLVED: ' + value),
                (error) => settle('REJECTED: ' + error.message),
              )
            },
          })
        }
        // Settles through the threadsafe-function queue, so the rollback's drain
        // has something to wait for and Context.destroy() has something to
        // discard. Without it the drain never schedules a macrotask at all.
        watch('__napiRegistrationQueuedPromise', (outcome) => { queued = outcome })
        // Settled by the barrier itself, on the owning thread.
        watch('__napiRegistrationSpawnedPromise', (outcome) => {
          cancelled = outcome
          // Registration is about to fail. Break only the loader's macrotask
          // scheduling from here on.
          globalThis.setImmediate = function () {
            throw new Error('host setImmediate is broken')
          }
        })

        let loadError
        ${load}
        globalThis.setImmediate = realSetImmediate
        if (!loadError) {
          console.error('ROLLBACK_POISONED_DID_NOT_FAIL')
          process.exit(47)
        }
        // Well past the two turns @emnapi/core needs: if the settlement did not
        // land by now, it never will.
        for (let index = 0; index < 80; index++) {
          await new Promise((resolve) => realSetImmediate(resolve))
        }
        console.error('ROLLBACK_POISONED_QUEUED ' + queued)
        console.error('ROLLBACK_POISONED_CANCELLED ' + cancelled)
        ${retryTeardown}
        process.exit(0)
      `,
      ],
      { encoding: 'utf8', timeout: 60_000 },
    )
    const poisonedRollbackOutput = `${poisonedRollback.stdout}\n${poisonedRollback.stderr}`
    assert.equal(
      poisonedRollback.error,
      undefined,
      poisonedRollback.error?.stack,
    )
    assert.equal(poisonedRollback.signal, null, poisonedRollbackOutput)
    assert.equal(poisonedRollback.status, 0, poisonedRollbackOutput)
    // The barrier still has to have run, otherwise the rest is vacuous: only a
    // barrier that reached the cancelled task proves the poison hit the drain
    // rather than something earlier.
    assert.match(
      poisonedRollbackOutput,
      /ROLLBACK_POISONED_CANCELLED REJECTED: /,
      `the ${flavor} loader's rollback must still run the barrier when the drain cannot schedule:\n${poisonedRollbackOutput}`,
    )
    assert.match(
      poisonedRollbackOutput,
      /ROLLBACK_POISONED_QUEUED RESOLVED: 7/,
      `a rollback whose drain failed must not destroy the environment out from under the settlements the drain never got to wait for: the ${flavor} loader stranded a promise that had already escaped into JavaScript:\n${poisonedRollbackOutput}`,
    )
    // The other half of the trade: declining to destroy may not leak. Something
    // has to be able to finish the teardown afterwards, and it must be reached.
    // The context has to still be held by that machinery first, otherwise
    // "released afterwards" would be true of a context nothing ever tracked.
    assert.match(
      poisonedRollbackOutput,
      /ROLLBACK_POISONED_HELD true/,
      `the ${flavor} loader must keep a rollback it declined to finish reachable for retry:\n${poisonedRollbackOutput}`,
    )
    assert.match(
      poisonedRollbackOutput,
      flavor === 'eager'
        ? /ROLLBACK_POISONED_RETRY THREW: module_exports_hook failed on purpose/
        : /ROLLBACK_POISONED_RETRY RESOLVED/,
      `the ${flavor} loader must leave a rollback it declined to finish reclaimable:\n${poisonedRollbackOutput}`,
    )
    assert.match(
      poisonedRollbackOutput,
      /ROLLBACK_POISONED_RETAINED false/,
      `the ${flavor} loader's retried rollback must run to completion and release what it retained:\n${poisonedRollbackOutput}`,
    )
  }
}
