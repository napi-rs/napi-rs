import assert from 'node:assert/strict'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
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

async function runMain() {
  const bindingFile = process.argv[2]
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
    console.log('combined runtime lifecycle passed')
  } finally {
    await writeFile(explicitAttemptPath, 'attempt').catch(() => {})
    await writeFile(releasePath, 'release').catch(() => {})
    await first.terminate().catch(() => {})
    await second?.terminate().catch(() => {})
    await failingShutdown?.terminate().catch(() => {})
    await recovery?.terminate().catch(() => {})
    await rm(directory, { recursive: true, force: true })
  }
}

async function runWorker() {
  const require = createRequire(import.meta.url)
  try {
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

    throw new TypeError(`unknown worker role: ${workerData.role}`)
  } catch (error) {
    parentPort.postMessage({
      type: 'error',
      error: error instanceof Error ? error.stack : String(error),
    })
  }
}

if (isMainThread) {
  await runMain()
} else {
  await runWorker()
}
