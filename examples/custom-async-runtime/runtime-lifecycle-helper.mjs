import assert from 'node:assert/strict'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'
import {
  isMainThread,
  parentPort,
  Worker,
  workerData,
} from 'node:worker_threads'

const timeoutMilliseconds = 10_000

function waitForMessage(worker, expectedType) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error(`timed out waiting for worker message ${expectedType}`))
    }, timeoutMilliseconds)
    const onMessage = (message) => {
      if (message?.type === 'error') {
        cleanup()
        reject(new Error(message.error))
      } else if (message?.type === expectedType) {
        cleanup()
        resolve(message)
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
  })
}

async function waitForFile(path) {
  const deadline = Date.now() + timeoutMilliseconds
  while (Date.now() < deadline) {
    try {
      await access(path)
      return
    } catch {
      await delay(5)
    }
  }
  throw new Error(`timed out waiting for ${path}`)
}

export async function runCombinedRuntimeLifecycle(bindingFile) {
  assert.ok(bindingFile, 'native binding path is required')
  assert.ok(isAbsolute(bindingFile), 'native binding path must be absolute')

  const directory = await mkdtemp(
    join(tmpdir(), 'napi-combined-runtime-lifecycle-'),
  )
  const enteredPath = join(directory, 'entered')
  const explicitAttemptPath = join(directory, 'explicit-attempt')
  const explicitStartResultPath = join(directory, 'explicit-start-result')
  const explicitShutdownResultPath = join(directory, 'explicit-shutdown-result')
  const releasePath = join(directory, 'release')
  const panicProbeStartedPath = join(directory, 'panic-probe-started')
  const panicProbeStoppedPath = join(directory, 'panic-probe-stopped')
  const first = new Worker(new URL(import.meta.url), {
    workerData: {
      bindingFile,
      enteredPath,
      explicitAttemptPath,
      explicitStartResultPath,
      explicitShutdownResultPath,
      releasePath,
      role: 'hold',
    },
  })
  let second
  let failingShutdown
  let recovery
  let panickingShutdown
  let panicRecovery

  try {
    const { startCalls } = await waitForMessage(first, 'ready')
    await waitForFile(enteredPath)
    await first.terminate()

    second = new Worker(new URL(import.meta.url), {
      workerData: {
        bindingFile,
        role: 'load',
      },
    })
    await waitForMessage(second, 'loading')

    let loadSettled = false
    const loaded = waitForMessage(second, 'loaded')
      .then(
        (result) => ({ result }),
        (error) => ({ error }),
      )
      .finally(() => {
        loadSettled = true
      })

    await writeFile(explicitAttemptPath, 'attempt')
    for (const [operation, resultPath] of [
      ['start', explicitStartResultPath],
      ['shutdown', explicitShutdownResultPath],
    ]) {
      await waitForFile(resultPath)
      const [status, ...reasonLines] = (
        await readFile(resultPath, 'utf8')
      ).split('\n')
      assert.equal(status, 'WouldDeadlock', `explicit ${operation} status`)
      assert.match(
        reasonLines.join('\n'),
        /lifecycle transition is already in progress/i,
      )
      assert.equal(
        loadSettled,
        false,
        `failed explicit ${operation} must not complete automatic registration`,
      )
    }

    await writeFile(releasePath, 'release')
    const loadOutcome = await loaded
    if (loadOutcome.error) {
      throw loadOutcome.error
    }
    const { result } = loadOutcome
    assert.equal(result.value, 42)
    assert.ok(
      result.startCalls > startCalls,
      'automatic registration must restart the custom runtime',
    )
    await second.terminate()
    second = undefined

    failingShutdown = new Worker(new URL(import.meta.url), {
      workerData: {
        bindingFile,
        role: 'fail-shutdown',
      },
    })
    const beforeFailure = await waitForMessage(failingShutdown, 'ready')
    await failingShutdown.terminate()
    failingShutdown = undefined

    recovery = new Worker(new URL(import.meta.url), {
      workerData: {
        bindingFile,
        role: 'recover',
      },
    })
    const recovered = await waitForMessage(recovery, 'recovered')
    assert.equal(recovered.value, 42)
    assert.ok(
      recovered.shutdownCalls >= beforeFailure.shutdownCalls + 2,
      'replacement load must retry the failed shutdown',
    )
    assert.ok(
      recovered.startCalls > beforeFailure.startCalls,
      'replacement load must restart after the shutdown retry',
    )
    await recovery.terminate()
    recovery = undefined

    panickingShutdown = new Worker(new URL(import.meta.url), {
      workerData: {
        bindingFile,
        panicProbeStartedPath,
        panicProbeStoppedPath,
        role: 'panic-shutdown',
      },
    })
    const beforePanic = await waitForMessage(panickingShutdown, 'ready')
    assert.equal(beforePanic.shutdownProbeActive, true)
    assert.equal(beforePanic.runtimeRegistrationCalls, 1)
    await waitForFile(panicProbeStartedPath)
    await panickingShutdown.terminate()
    panickingShutdown = undefined
    await assert.rejects(
      access(panicProbeStoppedPath),
      (error) => error?.code === 'ENOENT',
      'the panicking shutdown must leave its native probe alive',
    )

    panicRecovery = new Worker(new URL(import.meta.url), {
      workerData: {
        bindingFile,
        role: 'recover-panic',
      },
    })
    const recoveredPanic = await waitForMessage(
      panicRecovery,
      'panic-recovered',
    )
    await waitForFile(panicProbeStoppedPath)
    assert.equal(recoveredPanic.value, 42)
    assert.equal(recoveredPanic.shutdownProbeActive, false)
    assert.ok(
      recoveredPanic.moduleInitCalls >= beforePanic.moduleInitCalls,
      'replacement environment must reuse the retained module state',
    )
    assert.equal(
      recoveredPanic.runtimeRegistrationCalls,
      1,
      'replacement environment must not register the process-global backend again',
    )
    assert.equal(
      recoveredPanic.shutdownProbeStarts,
      beforePanic.shutdownProbeStarts,
      'replacement environment must observe the retained probe generation',
    )
    assert.equal(
      recoveredPanic.shutdownProbeStops,
      beforePanic.shutdownProbeStops + 1,
      'shutdown retry must join the retained probe',
    )
    assert.ok(
      recoveredPanic.shutdownCalls >= beforePanic.shutdownCalls + 2,
      'replacement load must retry the panicking shutdown',
    )
    assert.ok(
      recoveredPanic.startCalls > beforePanic.startCalls,
      'replacement load must restart after the panicking shutdown retry',
    )
    console.log('combined runtime lifecycle passed')
  } finally {
    await writeFile(explicitAttemptPath, 'attempt').catch(() => {})
    await writeFile(releasePath, 'release').catch(() => {})
    await first.terminate().catch(() => {})
    await second?.terminate().catch(() => {})
    await failingShutdown?.terminate().catch(() => {})
    await recovery?.terminate().catch(() => {})
    await panickingShutdown?.terminate().catch(() => {})
    await panicRecovery?.terminate().catch(() => {})
    await rm(directory, { recursive: true, force: true })
  }
}

function submissionMetrics(metrics) {
  return {
    completedTasks: metrics.completedTasks,
    spawnBlockingCalls: metrics.spawnBlockingCalls,
    spawnCalls: metrics.spawnCalls,
    synchronousSpawnCompletions: metrics.synchronousSpawnCompletions,
    taskPolls: metrics.taskPolls,
  }
}

function assertRuntimeJoinError(error, phase, kind) {
  assert.equal(
    error.isRuntimeError,
    true,
    `${kind} submission during ${phase} must be a runtime error`,
  )
  assert.equal(
    error.isCancelled,
    false,
    `${kind} submission during ${phase} must not be cancellation`,
  )
  assert.equal(error.status, 'GenericFailure')
  assert.match(error.message, /task submission failed/i)
  assert.match(error.reason, /async runtime is not running/i)
}

async function assertIteratorSetupRejects(binding, phase) {
  for (const [method, argument] of [
    ['next', undefined],
    ['return', undefined],
    ['throw', new Error(`${phase} iterator throw`)],
  ]) {
    const iterator = new binding.RuntimeAsyncIterator()[Symbol.asyncIterator]()
    let promise
    assert.doesNotThrow(() => {
      promise = iterator[method](argument)
    }, `${method}() must not throw synchronously during ${phase}`)
    assert.ok(
      promise instanceof Promise,
      `${method}() must return a Promise during ${phase}`,
    )
    await assert.rejects(
      promise,
      /async runtime is not running/i,
      `${method}() must reject during ${phase}`,
    )
  }
}

async function runSubmissionTransitionPhase({
  binding,
  bindingFile,
  directory,
  hook,
  operation,
  phase,
}) {
  const enteredPath = join(directory, `${hook}-entered`)
  const releasePath = join(directory, `${hook}-release`)
  const worker = new Worker(new URL(import.meta.url), {
    workerData: {
      bindingFile,
      operation,
      role: 'submission-transition',
    },
  })
  let completed

  try {
    await waitForMessage(worker, 'transition-ready')
    binding.armSubmissionTransitionBarrier(hook, enteredPath, releasePath)
    completed = waitForMessage(worker, 'transition-complete')
    worker.postMessage('run')
    await Promise.race([
      waitForFile(enteredPath),
      completed.then(() => {
        throw new Error(
          `${operation} completed before the ${hook} barrier was entered`,
        )
      }),
    ])

    const before = submissionMetrics(binding.getRuntimeMetrics())
    const probe = binding.probeSubmissionTransition()
    assertRuntimeJoinError(probe.future, phase, 'future')
    assertRuntimeJoinError(probe.blocking, phase, 'blocking')
    assert.equal(
      probe.blockingWorkRan,
      false,
      `blocking work must not run during ${phase}`,
    )
    assert.deepEqual(
      submissionMetrics(binding.getRuntimeMetrics()),
      before,
      `explicit submissions must not enter the backend during ${phase}`,
    )

    let generatedPromise
    assert.doesNotThrow(() => {
      generatedPromise = binding.asyncDouble(21)
    })
    assert.ok(
      generatedPromise instanceof Promise,
      `generated async submission during ${phase} must return a Promise`,
    )
    await assert.rejects(
      generatedPromise,
      (error) => {
        assert.ok(error instanceof Error)
        assert.match(error.message, /async runtime is not running/i)
        return true
      },
      `generated async submission must reject during ${phase}`,
    )
    await assertIteratorSetupRejects(binding, phase)
    assert.deepEqual(
      submissionMetrics(binding.getRuntimeMetrics()),
      before,
      `generated submissions must not enter the backend during ${phase}`,
    )

    await writeFile(releasePath, 'release')
    await completed
  } finally {
    await writeFile(releasePath, 'release').catch(() => {})
    await completed?.catch(() => {})
    await worker.terminate().catch(() => {})
  }
}

export async function runSubmissionTransitionLifecycle(bindingFile) {
  assert.ok(bindingFile, 'native binding path is required')
  assert.ok(isAbsolute(bindingFile), 'native binding path must be absolute')

  const require = createRequire(import.meta.url)
  const binding = require(bindingFile)
  const directory = await mkdtemp(
    join(tmpdir(), 'napi-submission-transition-lifecycle-'),
  )

  try {
    assert.equal(await binding.asyncDouble(21), 42)
    await runSubmissionTransitionPhase({
      binding,
      bindingFile,
      directory,
      hook: 'shutdown',
      operation: 'shutdown',
      phase: 'Stopping',
    })
    await runSubmissionTransitionPhase({
      binding,
      bindingFile,
      directory,
      hook: 'start',
      operation: 'start',
      phase: 'Starting',
    })
    assert.equal(
      await binding.asyncDouble(21),
      42,
      'generated async work must recover after the start transition',
    )
    assert.equal(
      binding.spawnBlockingValue(41),
      42,
      'explicit blocking work must recover after the start transition',
    )
    console.log('submission transition lifecycle passed')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

async function runWorker() {
  const require = createRequire(import.meta.url)
  try {
    if (workerData.role === 'submission-transition') {
      const binding = require(workerData.bindingFile)
      parentPort.postMessage({ type: 'transition-ready' })
      const command = await new Promise((resolve) => {
        parentPort.once('message', resolve)
      })
      if (command !== 'run') {
        throw new TypeError(`unknown transition worker command: ${command}`)
      }
      if (workerData.operation === 'shutdown') {
        binding.shutdownRuntime()
      } else if (workerData.operation === 'start') {
        binding.startRuntime()
      } else {
        throw new TypeError(
          `unknown runtime lifecycle operation: ${workerData.operation}`,
        )
      }
      parentPort.postMessage({ type: 'transition-complete' })
      return
    }

    if (workerData.role === 'hold') {
      const binding = require(workerData.bindingFile)
      const { startCalls } = binding.getRuntimeMetrics()
      binding.startTokioRetirementProbe(
        workerData.enteredPath,
        workerData.explicitAttemptPath,
        workerData.explicitStartResultPath,
        workerData.explicitShutdownResultPath,
        workerData.releasePath,
      )
      parentPort.postMessage({ type: 'ready', startCalls })
      parentPort.on('message', () => {})
      return
    }

    if (workerData.role === 'load') {
      parentPort.postMessage({ type: 'loading' })
      const binding = require(workerData.bindingFile)
      const value = await binding.asyncDouble(21)
      const { startCalls } = binding.getRuntimeMetrics()
      parentPort.postMessage({ type: 'loaded', startCalls, value })
      return
    }

    if (workerData.role === 'fail-shutdown') {
      const binding = require(workerData.bindingFile)
      binding.failNextShutdown()
      parentPort.postMessage({
        type: 'ready',
        ...binding.getRuntimeMetrics(),
      })
      parentPort.on('message', () => {})
      return
    }

    if (workerData.role === 'recover') {
      const binding = require(workerData.bindingFile)
      const value = await binding.asyncDouble(21)
      parentPort.postMessage({
        type: 'recovered',
        ...binding.getRuntimeMetrics(),
        value,
      })
      return
    }

    if (workerData.role === 'panic-shutdown') {
      const binding = require(workerData.bindingFile)
      binding.startShutdownPanicProbe(
        workerData.panicProbeStartedPath,
        workerData.panicProbeStoppedPath,
      )
      binding.panicNextShutdown()
      parentPort.postMessage({
        type: 'ready',
        ...binding.getRuntimeMetrics(),
      })
      parentPort.on('message', () => {})
      return
    }

    if (workerData.role === 'recover-panic') {
      const binding = require(workerData.bindingFile)
      const value = await binding.asyncDouble(21)
      parentPort.postMessage({
        type: 'panic-recovered',
        ...binding.getRuntimeMetrics(),
        value,
      })
      return
    }

    throw new TypeError(`unknown worker role: ${workerData.role}`)
  } catch (error) {
    parentPort.postMessage({
      type: 'error',
      error: error instanceof Error ? error.stack : String(error),
    })
  }
}

if (!isMainThread) {
  await runWorker()
} else if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  await runCombinedRuntimeLifecycle(process.argv[2])
}
