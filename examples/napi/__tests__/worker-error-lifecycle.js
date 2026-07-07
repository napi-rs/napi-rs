import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'

const workerPath = fileURLToPath(new URL('./worker.js', import.meta.url))
const [scenario, concurrencyText] = process.argv.slice(2)
const concurrency = Number.parseInt(concurrencyText, 10)

assert(scenario, 'worker Error lifecycle scenario is required')
assert(
  Number.isSafeInteger(concurrency) && concurrency > 0,
  'invalid concurrency',
)
assert.equal(typeof global.gc, 'function', 'runner requires --expose-gc')

async function runWorker() {
  const worker = new Worker(workerPath, { env: process.env })
  try {
    await new Promise((resolve, reject) => {
      let completed = false
      worker.once('error', reject)
      worker.once('exit', (code) => {
        if (!completed) {
          reject(new Error(`worker exited with code ${code} before completion`))
        }
      })
      worker.once('message', (message) => {
        try {
          assert.equal(message, 'done')
          completed = true
          resolve()
        } catch (error) {
          reject(error)
        }
      })
      worker.postMessage({ type: scenario })
    })
  } finally {
    await worker.terminate()
  }
}

await Promise.all(Array.from({ length: concurrency }, runWorker))
console.log(`worker Error lifecycle passed: ${scenario}`)
