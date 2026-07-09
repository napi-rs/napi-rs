import assert from 'node:assert/strict'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { Worker } from 'node:worker_threads'

const __dirname = dirname(fileURLToPath(import.meta.url))
const workerPath = join(__dirname, 'runtime-env-lifecycle-worker.js')
const mode = process.argv[2]
const loadPhaseHookReady = 1
const loadPhaseNativeEntered = 2
const loadPhaseNativeReleased = 3
const loadPhaseNativeCompleted = 4
const loadPhaseIndex = 0
const loadLoaderProceedIndex = 1
const loadNativeProceedIndex = 2
const workerOperationTimeout = 10_000
const runtimeCleanupGrace = 5_000
const retirementTimeoutObservationDelay = runtimeCleanupGrace + 500
const tsfnTeardownWaiterErrorMaskIndex = 7
const tsfnTeardownWaiterSettledMaskIndex = 8
const tsfnTeardownWaiterMask = 0b1111
const tsfnTeardownCounterCount = 9
const tsfnBlockingCallbackEnteredIndex = 0
const tsfnBlockingQueueFilledIndex = 1
const tsfnBlockingCallStartedIndex = 2
const tsfnBlockingCallReturnedIndex = 3
const tsfnBlockingCallbackMaskIndex = 4
const tsfnBlockingCompletedIndex = 5
const tsfnBlockingUnexpectedIndex = 6
const tsfnBlockingCounterCount = 7
const tsfnBlockingCallbackMask = 0b111
const postFinalizeProbeScenarios = new Set([
  'finalizer-panic',
  'callback-drop-panic',
  'unregistered-finalizer',
])
const expectedTsfnTeardownCounters = {
  clean: {
    payloadDrops: 0,
    queueFullErrors: 0,
    unexpected: 0,
    jsCallbacks: 0,
    closingFinalizerDrops: 0,
    quiescenceFinalizerMask: 1,
    quiescenceJoinMask: 1,
    waiterErrorMask: 0,
    waiterSettledMask: 0,
  },
  'finalizer-panic': {
    payloadDrops: 0,
    queueFullErrors: 0,
    unexpected: 0,
    jsCallbacks: 0,
    closingFinalizerDrops: 0,
    quiescenceFinalizerMask: 1,
    quiescenceJoinMask: 1,
    waiterErrorMask: 0,
    waiterSettledMask: 0,
  },
  'callback-drop-panic': {
    payloadDrops: 0,
    queueFullErrors: 0,
    unexpected: 0,
    jsCallbacks: 0,
    closingFinalizerDrops: 1,
    quiescenceFinalizerMask: 1,
    quiescenceJoinMask: 1,
    waiterErrorMask: 0,
    waiterSettledMask: 0,
  },
  'unregistered-finalizer': {
    payloadDrops: 0,
    queueFullErrors: 0,
    unexpected: 0,
    jsCallbacks: 0,
    closingFinalizerDrops: 0,
    quiescenceFinalizerMask: 0,
    quiescenceJoinMask: 0,
    waiterErrorMask: 0,
    waiterSettledMask: 0,
  },
  'pending-payload': {
    payloadDrops: 7,
    queueFullErrors: 1,
    unexpected: 0,
    jsCallbacks: 0,
    closingFinalizerDrops: 0,
    quiescenceFinalizerMask: 0,
    quiescenceJoinMask: 0,
    waiterErrorMask: tsfnTeardownWaiterMask,
    waiterSettledMask: tsfnTeardownWaiterMask,
  },
}

function request(
  worker,
  message,
  expectedType,
  timeout = workerOperationTimeout,
) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error(`timed out waiting for worker response ${expectedType}`))
    }, timeout)
    const onMessage = (response) => {
      if (response?.type === 'error') {
        cleanup()
        reject(new Error(response.message))
      } else if (response?.type === expectedType) {
        cleanup()
        resolve(response)
      }
    }
    const onError = (error) => {
      cleanup()
      reject(error)
    }
    const onExit = (code) => {
      cleanup()
      reject(
        new Error(`worker exited with code ${code} before ${expectedType}`),
      )
    }
    const cleanup = () => {
      clearTimeout(timer)
      worker.off('message', onMessage)
      worker.off('error', onError)
      worker.off('exit', onExit)
    }

    worker.on('message', onMessage)
    worker.once('error', onError)
    worker.once('exit', onExit)
    try {
      worker.postMessage(message)
    } catch (error) {
      cleanup()
      reject(error)
    }
  })
}

function terminateWorker(
  worker,
  description,
  timeout = workerOperationTimeout,
) {
  return new Promise((resolve, reject) => {
    let workerError
    let settled = false
    let timer
    const cleanup = () => {
      if (timer !== undefined) {
        clearTimeout(timer)
      }
      worker.off('error', onError)
      worker.off('exit', onExit)
    }
    const finish = (error, code) => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      if (error) {
        reject(error)
      } else {
        resolve(code)
      }
    }
    const onError = (error) => {
      workerError ??= error
    }
    const onExit = (code) => {
      finish(workerError, code)
    }
    worker.on('error', onError)
    worker.once('exit', onExit)
    timer = setTimeout(() => {
      finish(new Error(`${description} termination timed out`))
    }, timeout)
    let termination
    try {
      termination = worker.terminate()
    } catch (error) {
      finish(error)
      return
    }
    Promise.resolve(termination).then(
      (code) => finish(workerError, code),
      (error) => finish(error),
    )
  })
}

async function waitForFile(path) {
  const deadline = Date.now() + workerOperationTimeout
  while (Date.now() < deadline) {
    try {
      await access(path)
      return
    } catch {
      await delay(10)
    }
  }
  throw new Error(`timed out waiting for teardown barrier ${path}`)
}

async function waitForAtomicAtLeast(view, index, expected, timeout) {
  const deadline = Date.now() + timeout
  while (Atomics.load(view, index) < expected && Date.now() < deadline) {
    await delay(1)
  }
  return Atomics.load(view, index) >= expected
}

function releaseAtomicGate(buffer, index = 0) {
  const view = new Int32Array(buffer)
  Atomics.store(view, index, 1)
  Atomics.notify(view, index)
}

async function verifyRuntime(worker) {
  const verification = await request(
    worker,
    { type: 'verify-restart' },
    'verified',
  )
  assert.equal(verification.result, 4)
  assert.ok(
    verification.runtimeFactoryCallCount >= 2,
    `replacement environment used only ${verification.runtimeFactoryCallCount} configured Tokio runtime generation(s)`,
  )
}

async function assertWorkerFinalizers(
  runtimeFinalizerPath,
  asyncFinalizerPath,
) {
  await Promise.all([
    waitForFile(runtimeFinalizerPath),
    waitForFile(asyncFinalizerPath),
  ])
  assert.equal(await readFile(runtimeFinalizerPath, 'utf8'), '0')
  assert.equal(await readFile(asyncFinalizerPath, 'utf8'), 'finalized')
}

function readTsfnTeardownCounters(state) {
  const counters = new Int32Array(state)
  return {
    payloadDrops: Atomics.load(counters, 0),
    queueFullErrors: Atomics.load(counters, 1),
    unexpected: Atomics.load(counters, 2),
    jsCallbacks: Atomics.load(counters, 3),
    closingFinalizerDrops: Atomics.load(counters, 4),
    quiescenceFinalizerMask: Atomics.load(counters, 5),
    quiescenceJoinMask: Atomics.load(counters, 6),
    waiterErrorMask: Atomics.load(counters, tsfnTeardownWaiterErrorMaskIndex),
    waiterSettledMask: Atomics.load(
      counters,
      tsfnTeardownWaiterSettledMaskIndex,
    ),
  }
}

function assertTsfnTeardownCounters(state, scenario = 'clean') {
  assert.deepEqual(
    readTsfnTeardownCounters(state),
    expectedTsfnTeardownCounters[scenario],
  )
}

async function waitForTsfnTeardownWaiters(state) {
  const counters = new Int32Array(state)
  const deadline = Date.now() + workerOperationTimeout
  while (
    Atomics.load(counters, tsfnTeardownWaiterSettledMaskIndex) !==
      tsfnTeardownWaiterMask &&
    Date.now() < deadline
  ) {
    await delay(1)
  }
  assert.equal(
    Atomics.load(counters, tsfnTeardownWaiterSettledMaskIndex),
    tsfnTeardownWaiterMask,
    'not all pending TSFN async waiters settled after environment teardown',
  )
}

function readTsfnBlockingCounters(state) {
  const counters = new Int32Array(state)
  return {
    callbackEntered: Atomics.load(counters, tsfnBlockingCallbackEnteredIndex),
    queueFilled: Atomics.load(counters, tsfnBlockingQueueFilledIndex),
    callStarted: Atomics.load(counters, tsfnBlockingCallStartedIndex),
    callReturned: Atomics.load(counters, tsfnBlockingCallReturnedIndex),
    callbackMask: Atomics.load(counters, tsfnBlockingCallbackMaskIndex),
    completed: Atomics.load(counters, tsfnBlockingCompletedIndex),
    unexpected: Atomics.load(counters, tsfnBlockingUnexpectedIndex),
  }
}

async function releaseAndVerifyBlockingCall(state, gate) {
  const counters = new Int32Array(state)
  for (const [index, message] of [
    [
      tsfnBlockingCallbackEnteredIndex,
      'bounded TSFN callback did not enter its JavaScript gate',
    ],
    [
      tsfnBlockingQueueFilledIndex,
      'native caller did not fill the bounded TSFN queue',
    ],
    [tsfnBlockingCallStartedIndex, 'blocking TSFN caller did not start'],
  ]) {
    assert.equal(
      await waitForAtomicAtLeast(counters, index, 1, workerOperationTimeout),
      true,
      message,
    )
  }
  await delay(100)
  assert.deepEqual(readTsfnBlockingCounters(state), {
    callbackEntered: 1,
    queueFilled: 1,
    callStarted: 1,
    callReturned: 0,
    callbackMask: 0,
    completed: 0,
    unexpected: 0,
  })

  releaseAtomicGate(gate)
  assert.equal(
    await waitForAtomicAtLeast(
      counters,
      tsfnBlockingCompletedIndex,
      1,
      workerOperationTimeout,
    ),
    true,
    'blocking TSFN caller did not finish after callback queue progress',
  )
  assert.deepEqual(readTsfnBlockingCounters(state), {
    callbackEntered: 1,
    queueFilled: 1,
    callStarted: 1,
    callReturned: 1,
    callbackMask: tsfnBlockingCallbackMask,
    completed: 1,
    unexpected: 0,
  })
}

async function waitForBlockedCall(state) {
  const counters = new Int32Array(state)
  for (const [index, message] of [
    [
      tsfnBlockingCallbackEnteredIndex,
      'bounded TSFN callback did not enter its JavaScript gate',
    ],
    [
      tsfnBlockingQueueFilledIndex,
      'native caller did not fill the bounded TSFN queue',
    ],
    [tsfnBlockingCallStartedIndex, 'blocking TSFN caller did not start'],
  ]) {
    assert.equal(
      await waitForAtomicAtLeast(counters, index, 1, workerOperationTimeout),
      true,
      message,
    )
  }
  await delay(100)
  assert.deepEqual(readTsfnBlockingCounters(state), {
    callbackEntered: 1,
    queueFilled: 1,
    callStarted: 1,
    callReturned: 0,
    callbackMask: 0,
    completed: 0,
    unexpected: 0,
  })
}

async function runSequential() {
  const resultDirectory = await mkdtemp(
    join(tmpdir(), 'napi-runtime-env-lifecycle-sequential-'),
  )
  const runtimeFinalizerPath = join(resultDirectory, 'runtime-finalizer')
  const asyncFinalizerPath = join(resultDirectory, 'async-finalizer')
  const first = new Worker(workerPath, { env: process.env })
  const teardownBlocker = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)
  const tsfnTeardownState = new SharedArrayBuffer(
    Int32Array.BYTES_PER_ELEMENT * tsfnTeardownCounterCount,
  )
  let second
  try {
    await request(
      first,
      {
        type: 'hold-pending-work',
        teardownBlocker,
        tsfnTeardownState,
        runtimeFinalizerPath,
        asyncFinalizerPath,
      },
      'ready',
    )
    await terminateWorker(first, 'first sequential worker')
    await assertWorkerFinalizers(runtimeFinalizerPath, asyncFinalizerPath)
    assertTsfnTeardownCounters(tsfnTeardownState, 'clean')

    second = new Worker(workerPath, { env: process.env })
    await verifyRuntime(second)
  } finally {
    releaseAtomicGate(teardownBlocker)
    await terminateWorker(first, 'first sequential worker').catch(() => {})
    if (second) {
      await terminateWorker(second, 'second sequential worker').catch(() => {})
    }
    await rm(resultDirectory, { recursive: true, force: true })
  }
}

async function runRace(duplicateLoad = false) {
  const barrierDirectory = await mkdtemp(
    join(
      tmpdir(),
      duplicateLoad
        ? 'napi-runtime-env-lifecycle-duplicate-race-'
        : 'napi-runtime-env-lifecycle-race-',
    ),
  )
  const enteredPath = join(barrierDirectory, 'entered')
  const releasePath = join(barrierDirectory, 'release')
  const retirementCompletedPath = join(barrierDirectory, 'completed')
  const runtimeFinalizerPath = join(barrierDirectory, 'runtime-finalizer')
  const asyncFinalizerPath = join(barrierDirectory, 'async-finalizer')
  const teardownBlocker = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)
  const tsfnTeardownState = new SharedArrayBuffer(
    Int32Array.BYTES_PER_ELEMENT * tsfnTeardownCounterCount,
  )
  let first
  let second
  let termination
  let loadState
  try {
    first = new Worker(workerPath, { env: process.env })
    const { duplicateResult, duplicateInFlightResult, failedDuplicateExport } =
      await request(
        first,
        {
          type: 'hold-pending-work',
          enteredPath,
          releasePath,
          retirementCompletedPath,
          teardownBlocker,
          tsfnTeardownState,
          runtimeFinalizerPath,
          asyncFinalizerPath,
          duplicateLoad,
        },
        'ready',
      )
    if (duplicateLoad) {
      assert.equal(duplicateResult, 4)
      assert.equal(duplicateInFlightResult, 'duplicate-load-in-flight')
      assert.equal(typeof failedDuplicateExport, 'string')
    }

    const firstWorkerDescription = duplicateLoad
      ? 'duplicate-loaded racing worker'
      : 'first racing worker'
    termination = terminateWorker(first, firstWorkerDescription, 20_000).then(
      (code) => ({ code }),
      (error) => ({ error }),
    )
    await waitForFile(enteredPath)

    second = new Worker(workerPath, { env: process.env })
    const loadControl = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 3)
    loadState = new Int32Array(loadControl)
    const loaded = request(
      second,
      { type: 'load-runtime', loadControl, retirementCompletedPath },
      'loaded',
    ).then(
      (response) => ({ response }),
      (error) => ({ error }),
    )
    assert.equal(
      await waitForAtomicAtLeast(
        loadState,
        loadPhaseIndex,
        loadPhaseHookReady,
        workerOperationTimeout,
      ),
      true,
      'racing worker did not reach the native module loader hook',
    )
    Atomics.store(loadState, loadLoaderProceedIndex, 1)
    Atomics.notify(loadState, loadLoaderProceedIndex)
    assert.equal(
      await waitForAtomicAtLeast(
        loadState,
        loadPhaseIndex,
        loadPhaseNativeEntered,
        workerOperationTimeout,
      ),
      true,
      'racing worker did not enter native addon loading',
    )
    Atomics.store(loadState, loadNativeProceedIndex, 1)
    Atomics.notify(loadState, loadNativeProceedIndex)
    assert.equal(
      await waitForAtomicAtLeast(
        loadState,
        loadPhaseIndex,
        loadPhaseNativeReleased,
        workerOperationTimeout,
      ),
      true,
      'racing worker did not resume native addon loading',
    )
    await delay(100)
    assert.equal(
      Atomics.load(loadState, loadPhaseIndex),
      loadPhaseNativeReleased,
      'replacement addon completed loading while the previous runtime retirement was blocked',
    )
    await writeFile(releasePath, 'release')
    await waitForFile(retirementCompletedPath)
    assert.equal(
      await waitForAtomicAtLeast(
        loadState,
        loadPhaseIndex,
        loadPhaseNativeCompleted,
        workerOperationTimeout,
      ),
      true,
      'racing worker did not complete native loading after retirement',
    )
    const loadResult = await loaded
    if (loadResult.error) {
      throw loadResult.error
    }
    const terminationResult = await termination
    termination = undefined
    if (terminationResult.error) {
      throw terminationResult.error
    }
    await assertWorkerFinalizers(runtimeFinalizerPath, asyncFinalizerPath)
    assertTsfnTeardownCounters(tsfnTeardownState, 'clean')

    await verifyRuntime(second)
  } finally {
    releaseAtomicGate(teardownBlocker)
    if (loadState) {
      Atomics.store(loadState, loadLoaderProceedIndex, 1)
      Atomics.store(loadState, loadNativeProceedIndex, 1)
      Atomics.notify(loadState, loadLoaderProceedIndex)
      Atomics.notify(loadState, loadNativeProceedIndex)
    }
    await writeFile(releasePath, 'release').catch(() => {})
    await termination?.catch(() => {})
    if (first) {
      await terminateWorker(
        first,
        duplicateLoad
          ? 'duplicate-loaded racing worker'
          : 'first racing worker',
      ).catch(() => {})
    }
    if (second) {
      await terminateWorker(second, 'second racing worker').catch(() => {})
    }
    await rm(barrierDirectory, { recursive: true, force: true })
  }
}

async function runTimeoutRetention() {
  const barrierDirectory = await mkdtemp(
    join(tmpdir(), 'napi-runtime-env-lifecycle-'),
  )
  const enteredPath = join(barrierDirectory, 'entered')
  const releasePath = join(barrierDirectory, 'release')
  const retirementCompletedPath = join(barrierDirectory, 'completed')
  const runtimeFinalizerPath = join(barrierDirectory, 'runtime-finalizer')
  const asyncFinalizerPath = join(barrierDirectory, 'async-finalizer')
  const teardownBlocker = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)
  const tsfnTeardownState = new SharedArrayBuffer(
    Int32Array.BYTES_PER_ELEMENT * tsfnTeardownCounterCount,
  )
  let first
  let second
  let termination
  let loadState
  try {
    first = new Worker(workerPath, { env: process.env })
    await request(
      first,
      {
        type: 'hold-pending-work',
        enteredPath,
        releasePath,
        retirementCompletedPath,
        teardownBlocker,
        tsfnTeardownState,
        runtimeFinalizerPath,
        asyncFinalizerPath,
      },
      'ready',
    )
    termination = terminateWorker(
      first,
      'first timeout-retention worker',
      20_000,
    ).then(
      (code) => ({ code }),
      (error) => ({ error }),
    )
    await waitForFile(enteredPath)
    const cleanupGraceElapsed = delay(retirementTimeoutObservationDelay)
    const terminationResult = await termination
    termination = undefined
    if (terminationResult.error) {
      throw terminationResult.error
    }
    await cleanupGraceElapsed
    await assertWorkerFinalizers(runtimeFinalizerPath, asyncFinalizerPath)
    assertTsfnTeardownCounters(tsfnTeardownState, 'clean')

    second = new Worker(workerPath, { env: process.env })
    const loadControl = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 3)
    loadState = new Int32Array(loadControl)
    const loaded = request(
      second,
      { type: 'load-runtime', loadControl, retirementCompletedPath },
      'loaded',
    ).then(
      (response) => ({ response }),
      (error) => ({ error }),
    )
    assert.equal(
      await waitForAtomicAtLeast(
        loadState,
        loadPhaseIndex,
        loadPhaseHookReady,
        workerOperationTimeout,
      ),
      true,
      'second worker did not reach the native module loader hook',
    )
    Atomics.store(loadState, loadLoaderProceedIndex, 1)
    Atomics.notify(loadState, loadLoaderProceedIndex)
    assert.equal(
      await waitForAtomicAtLeast(
        loadState,
        loadPhaseIndex,
        loadPhaseNativeEntered,
        workerOperationTimeout,
      ),
      true,
      'second worker did not enter native addon loading',
    )
    Atomics.store(loadState, loadNativeProceedIndex, 1)
    Atomics.notify(loadState, loadNativeProceedIndex)
    assert.equal(
      await waitForAtomicAtLeast(
        loadState,
        loadPhaseIndex,
        loadPhaseNativeReleased,
        workerOperationTimeout,
      ),
      true,
      'second worker did not resume native addon loading',
    )
    assert.equal(
      Atomics.load(loadState, loadPhaseIndex),
      loadPhaseNativeReleased,
      'second worker completed native loading while prior runtime retirement was blocked',
    )

    await writeFile(releasePath, 'release')
    await waitForFile(retirementCompletedPath)
    assert.equal(
      await waitForAtomicAtLeast(
        loadState,
        loadPhaseIndex,
        loadPhaseNativeCompleted,
        10_000,
      ),
      true,
      'second worker did not complete native loading after retirement',
    )
    const loadResult = await loaded
    if (loadResult.error) {
      throw loadResult.error
    }
    await verifyRuntime(second)
  } finally {
    releaseAtomicGate(teardownBlocker)
    if (loadState) {
      Atomics.store(loadState, loadLoaderProceedIndex, 1)
      Atomics.store(loadState, loadNativeProceedIndex, 1)
      Atomics.notify(loadState, loadLoaderProceedIndex)
      Atomics.notify(loadState, loadNativeProceedIndex)
    }
    await writeFile(releasePath, 'release').catch(() => {})
    await termination?.catch(() => {})
    if (first) {
      await terminateWorker(first, 'first timeout-retention worker').catch(
        () => {},
      )
    }
    if (second) {
      await terminateWorker(second, 'replacement worker').catch(() => {})
    }
    await rm(barrierDirectory, { recursive: true, force: true })
  }
}

async function runTsfnScenario(scenario) {
  const worker = new Worker(workerPath, { env: process.env })
  const teardownBlocker = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)
  const tsfnTeardownState = new SharedArrayBuffer(
    Int32Array.BYTES_PER_ELEMENT * tsfnTeardownCounterCount,
  )
  const tsfnBlockingState = new SharedArrayBuffer(
    Int32Array.BYTES_PER_ELEMENT * tsfnBlockingCounterCount,
  )
  const tsfnBlockingGate = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)
  const needsPostFinalizeProbe = postFinalizeProbeScenarios.has(scenario)
  let barrierDirectory
  let postFinalizeEnteredPath
  let postFinalizeReleasePath
  let postFinalizeCompletedPath
  try {
    if (needsPostFinalizeProbe) {
      barrierDirectory = await mkdtemp(
        join(tmpdir(), 'napi-tsfn-post-finalize-'),
      )
      postFinalizeEnteredPath = join(barrierDirectory, 'entered')
      postFinalizeReleasePath = join(barrierDirectory, 'release')
      postFinalizeCompletedPath = join(barrierDirectory, 'completed')
    }
    const ready = request(
      worker,
      {
        type: 'hold-tsfn-scenario',
        teardownBlocker,
        tsfnTeardownState,
        tsfnScenario: scenario,
        tsfnBlockingState,
        tsfnBlockingGate,
        postFinalizeEnteredPath,
        postFinalizeReleasePath,
        postFinalizeCompletedPath,
      },
      'ready',
    )
    if (scenario === 'pending-payload') {
      await releaseAndVerifyBlockingCall(tsfnBlockingState, tsfnBlockingGate)
    }
    await ready
    if (needsPostFinalizeProbe) {
      await waitForFile(postFinalizeEnteredPath)
    }
    await terminateWorker(worker, `${scenario} TSFN worker`)
    if (scenario === 'pending-payload') {
      await waitForTsfnTeardownWaiters(tsfnTeardownState)
    }
    if (needsPostFinalizeProbe) {
      await writeFile(postFinalizeReleasePath, 'release')
      await waitForFile(postFinalizeCompletedPath)
    }
    assertTsfnTeardownCounters(tsfnTeardownState, scenario)
  } finally {
    releaseAtomicGate(teardownBlocker)
    releaseAtomicGate(tsfnBlockingGate)
    if (postFinalizeReleasePath) {
      await writeFile(postFinalizeReleasePath, 'release').catch(() => {})
    }
    await terminateWorker(worker, `${scenario} TSFN worker`).catch(() => {})
    if (barrierDirectory) {
      await rm(barrierDirectory, { recursive: true, force: true })
    }
  }
}

async function runCleanupBlockedCall() {
  const worker = new Worker(workerPath, { env: process.env })
  const tsfnBlockingState = new SharedArrayBuffer(
    Int32Array.BYTES_PER_ELEMENT * tsfnBlockingCounterCount,
  )
  const tsfnBlockingGate = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)
  try {
    await request(
      worker,
      {
        type: 'hold-tsfn-scenario',
        tsfnScenario: 'cleanup-blocked-call',
        tsfnBlockingState,
        tsfnBlockingGate,
      },
      'ready',
    )
    await waitForBlockedCall(tsfnBlockingState)
    await terminateWorker(worker, 'cleanup-blocked-call TSFN worker')
    const counters = new Int32Array(tsfnBlockingState)
    assert.equal(
      await waitForAtomicAtLeast(
        counters,
        tsfnBlockingCompletedIndex,
        1,
        workerOperationTimeout,
      ),
      true,
      'environment cleanup did not wake the blocking TSFN caller',
    )
    assert.deepEqual(readTsfnBlockingCounters(tsfnBlockingState), {
      callbackEntered: 1,
      queueFilled: 1,
      callStarted: 1,
      callReturned: 1,
      callbackMask: 0,
      completed: 1,
      unexpected: 0,
    })
  } finally {
    releaseAtomicGate(tsfnBlockingGate)
    await terminateWorker(worker, 'cleanup-blocked-call TSFN worker').catch(
      () => {},
    )
  }
}

switch (mode) {
  case 'sequential':
    await runSequential()
    break
  case 'race':
    await runRace()
    break
  case 'duplicate-race':
    await runRace(true)
    break
  case 'timeout-retention':
    await runTimeoutRetention()
    break
  case 'finalizer-panic':
  case 'callback-drop-panic':
  case 'unregistered-finalizer':
  case 'pending-payload':
    await runTsfnScenario(mode)
    break
  case 'cleanup-blocked-call':
    await runCleanupBlockedCall()
    break
  default:
    throw new TypeError(`unknown lifecycle scenario: ${mode}`)
}
