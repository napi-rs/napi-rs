import assert from 'node:assert/strict'
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { Worker } from 'node:worker_threads'

const __dirname = dirname(fileURLToPath(import.meta.url))
const workerPath = join(__dirname, 'runtime-env-lifecycle-worker.js')
const mode = process.argv[2]
const expectedTsfnTeardownCounters = {
  payloadDrops: 6,
  waiterErrors: 3,
  queueFullErrors: 1,
  unexpectedWaiters: 0,
  jsCallbacks: 0,
  closingFinalizerDrops: 1,
}

function request(worker, message, expectedType) {
  return new Promise((resolve, reject) => {
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
      worker.off('message', onMessage)
      worker.off('error', onError)
      worker.off('exit', onExit)
    }

    worker.on('message', onMessage)
    worker.once('error', onError)
    worker.once('exit', onExit)
    worker.postMessage(message)
  })
}

async function waitForFile(path) {
  const deadline = Date.now() + 2_000
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

async function verifyRuntime(worker) {
  const verification = await request(
    worker,
    { type: 'verify-restart' },
    'verified',
  )
  assert.equal(verification.finalizerCount, 1)
  assert.equal(verification.lifecycleResult, 0)
  assert.equal(verification.result, 4)
  assert.deepEqual(
    verification.tsfnTeardownCounters,
    expectedTsfnTeardownCounters,
  )
  return verification.threadStopCount
}

async function runSequential() {
  const first = new Worker(workerPath, { env: process.env })
  const teardownBlocker = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)
  const { threadStopCount: initialThreadStopCount } = await request(
    first,
    { type: 'hold-pending-work', teardownBlocker },
    'ready',
  )
  await first.terminate()

  const second = new Worker(workerPath, { env: process.env })
  try {
    const threadStopCount = await verifyRuntime(second)
    assert.ok(threadStopCount > initialThreadStopCount)
  } finally {
    await second.terminate()
  }
}

async function runRace() {
  const barrierDirectory = await mkdtemp(
    join(tmpdir(), 'napi-runtime-env-lifecycle-'),
  )
  const enteredPath = join(barrierDirectory, 'entered')
  const releasePath = join(barrierDirectory, 'release')
  const first = new Worker(workerPath, { env: process.env })
  const teardownBlocker = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)
  let second
  let termination
  try {
    const { threadStopCount: initialThreadStopCount } = await request(
      first,
      {
        type: 'hold-pending-work',
        enteredPath,
        releasePath,
        teardownBlocker,
      },
      'ready',
    )
    termination = first.terminate()
    await waitForFile(enteredPath)

    second = new Worker(workerPath, { env: process.env })
    const loading = new Promise((resolve, reject) => {
      const onMessage = (message) => {
        if (message?.type === 'loading') {
          cleanup()
          resolve()
        } else if (message?.type === 'error') {
          cleanup()
          reject(new Error(message.message))
        }
      }
      const onError = (error) => {
        cleanup()
        reject(error)
      }
      const cleanup = () => {
        second.off('message', onMessage)
        second.off('error', onError)
      }
      second.on('message', onMessage)
      second.once('error', onError)
    })
    let loadSettled = false
    const loaded = request(second, { type: 'load-runtime' }, 'loaded')
      .then(
        (response) => ({ response }),
        (error) => ({ error }),
      )
      .finally(() => {
        loadSettled = true
      })
    await loading
    await delay(50)
    assert.equal(loadSettled, false)

    await writeFile(releasePath, 'release')
    const loadResult = await loaded
    if (loadResult.error) {
      throw loadResult.error
    }
    const { threadStopCount: restartedThreadStopCount } = loadResult.response
    await termination
    termination = undefined
    assert.ok(restartedThreadStopCount > initialThreadStopCount)

    const liveThreadStopCount = await verifyRuntime(second)
    assert.equal(liveThreadStopCount, restartedThreadStopCount)
  } finally {
    await writeFile(releasePath, 'release').catch(() => {})
    await termination?.catch(() => {})
    await first.terminate().catch(() => {})
    await second?.terminate().catch(() => {})
    await rm(barrierDirectory, { recursive: true, force: true })
  }
}

switch (mode) {
  case 'sequential':
    await runSequential()
    break
  case 'race':
    await runRace()
    break
  default:
    throw new TypeError(`unknown lifecycle scenario: ${mode}`)
}
