import assert from 'node:assert/strict'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'

const operationTimeout = 10_000
const __dirname = dirname(fileURLToPath(import.meta.url))
const workerPath = join(__dirname, 'tsfn-retention-worker.js')
const [scenario, addonPath] = process.argv.slice(2)

if (!scenario || !addonPath) {
  throw new TypeError('scenario and addon path are required')
}

function waitForReady(worker) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('timed out waiting for retention worker setup'))
    }, operationTimeout)
    const onMessage = (message) => {
      if (message?.type === 'ready') {
        cleanup()
        resolve()
      }
    }
    const onError = (error) => {
      cleanup()
      reject(error)
    }
    const onExit = (code) => {
      cleanup()
      reject(
        new Error(`retention worker exited before setup with code ${code}`),
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

async function waitForFile(path, description, timeout = operationTimeout) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    try {
      await access(path)
      return
    } catch {
      await delay(10)
    }
  }
  throw new Error(`timed out waiting for ${description}`)
}

async function terminateWorker(worker) {
  let timer
  try {
    await Promise.race([
      worker.terminate(),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('retention worker termination timed out')),
          operationTimeout,
        )
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

async function run() {
  const barrierDirectory = await mkdtemp(
    join(tmpdir(), `napi-tsfn-retention-${scenario}-`),
  )
  const enteredPath = join(barrierDirectory, 'entered')
  const releasePath = join(barrierDirectory, 'release')
  const completedPath = join(barrierDirectory, 'completed')
  const blocker = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)
  const blockerView = new Int32Array(blocker)
  const worker = new Worker(workerPath, {
    env: process.env,
    workerData: {
      addonPath,
      blocker,
      completedPath,
      enteredPath,
      releasePath,
      scenario,
    },
  })

  try {
    await waitForReady(worker)
    if (scenario.startsWith('unregistered-finalizer')) {
      await terminateWorker(worker)
      await waitForFile(enteredPath, 'post-drop native probe entry marker')
    } else {
      await waitForFile(enteredPath, 'native probe entry marker')
      await terminateWorker(worker)
    }

    await writeFile(releasePath, 'release')
    await waitForFile(completedPath, 'post-finalization completion marker')
    assert.equal(await readFile(completedPath, 'utf8'), 'completed')
  } finally {
    await terminateWorker(worker).catch(() => {})
    Atomics.store(blockerView, 0, 1)
    Atomics.notify(blockerView, 0)
    await writeFile(releasePath, 'release').catch(() => {})
    await waitForFile(completedPath, 'cleanup completion marker', 1_000).catch(
      () => {},
    )
    await rm(barrierDirectory, { recursive: true, force: true })
  }
}

await run()
