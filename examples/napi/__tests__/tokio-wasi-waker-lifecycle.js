import assert from 'node:assert/strict'
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'

const operationTimeout = 10_000
const __dirname = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
process.env.NAPI_RS_FORCE_WASI = 'error'
const lifecycle = require('../index.cjs')
const dispose = lifecycle[Symbol.for('napi.rs.wasi.dispose')]
assert.equal(typeof dispose, 'function')
const workerPath = join(__dirname, 'tokio-wasi-waker-worker.js')

async function waitForFile(path, description) {
  const deadline = Date.now() + operationTimeout
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

function waitForWorkerReady(worker) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('timed out waiting for WASI waker worker'))
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
      reject(new Error(`WASI waker worker exited early with code ${code}`))
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

async function verifyParentWorkerTerminatesPthread() {
  const directory = await mkdtemp(join(tmpdir(), 'napi-wasi-waker-exit-'))
  const enteredPath = join(directory, 'entered')
  const releasePath = join(directory, 'release')
  const completedPath = join(directory, 'completed')
  const blocker = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)
  const worker = new Worker(workerPath, {
    env: process.env,
    workerData: {
      blocker,
      completedPath,
      enteredPath,
      releasePath,
    },
  })

  try {
    await waitForWorkerReady(worker)
    await waitForFile(enteredPath, 'nested WASI waker thread entry')
    await worker.terminate()
    await writeFile(releasePath, 'release')
    await delay(500)
    await assert.rejects(
      access(completedPath),
      (error) => error?.code === 'ENOENT',
    )
  } finally {
    Atomics.store(new Int32Array(blocker), 0, 1)
    Atomics.notify(new Int32Array(blocker), 0)
    await worker.terminate().catch(() => {})
    await writeFile(releasePath, 'release').catch(() => {})
    await rm(directory, { recursive: true, force: true })
  }
}

await verifyParentWorkerTerminatesPthread()
const firstDisposal = dispose()
assert.strictEqual(dispose(), firstDisposal)
let disposalTimeout
const disposalExpired = new Promise((_, reject) => {
  disposalTimeout = setTimeout(() => {
    reject(new Error('timed out waiting for WASI disposal'))
  }, operationTimeout)
})
try {
  await Promise.race([firstDisposal, disposalExpired])
} finally {
  clearTimeout(disposalTimeout)
}
