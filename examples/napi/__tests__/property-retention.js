import { fileURLToPath } from 'node:url'
import { Worker, isMainThread, workerData } from 'node:worker_threads'

import native from '../index.cjs'

function stashUntilExit() {
  const sym = Symbol('exit-sym')
  const obj = { kept: true }
  native.stashPropertiesUntilExit(obj, sym)
}

async function runWorkerExit() {
  const worker = new Worker(fileURLToPath(import.meta.url), {
    workerData: 'worker-exit',
  })
  const code = await new Promise((resolve, reject) => {
    worker.once('error', reject)
    worker.once('exit', resolve)
  })
  if (code !== 0) {
    throw new Error(`worker exited with ${code}`)
  }
  console.log('worker-exit ok')
}

if (!isMainThread) {
  if (workerData === 'worker-exit') {
    stashUntilExit()
  } else {
    throw new Error(`unknown worker scenario: ${workerData}`)
  }
} else if (process.argv[2] === 'worker-exit') {
  await runWorkerExit()
} else if (process.argv[2] === 'process-exit') {
  stashUntilExit()
  console.log('process-exit ok')
} else {
  throw new Error(`unknown scenario: ${process.argv[2]}`)
}
