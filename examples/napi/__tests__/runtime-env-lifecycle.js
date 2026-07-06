import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'

const __dirname = dirname(fileURLToPath(import.meta.url))
const workerPath = join(__dirname, 'runtime-env-lifecycle-worker.js')
const mode = process.argv[2]

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

async function run() {
  assert.ok(
    mode === 'sequential' || mode === 'race',
    `unknown lifecycle scenario: ${mode}`,
  )

  const first = new Worker(workerPath, { env: process.env })
  await request(first, { type: 'hold-pending-work' }, 'ready')

  const termination = first.terminate()
  if (mode === 'sequential') {
    await termination
  }

  const second = new Worker(workerPath, { env: process.env })
  try {
    const verification = request(second, { type: 'verify-restart' }, 'verified')
    await termination
    const { finalizerCount, lifecycleResult, result } = await verification
    assert.equal(finalizerCount, 1)
    assert.equal(lifecycleResult, 0)
    assert.equal(result, 4)
  } finally {
    await second.terminate()
  }
}

await run()
