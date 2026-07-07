import { Worker } from 'node:worker_threads'

const operationTimeout = 70_000
const addonPath = process.argv[2]
const scenario = process.argv[3] ?? 'module-init'

if (!addonPath) {
  throw new TypeError('module-init rollback addon path is required')
}

const workerUrl =
  scenario === 'cleanup-hook-registration-failure'
    ? new URL('./module-init-cleanup-hook-failure-worker.js', import.meta.url)
    : new URL('./module-init-rollback-worker.js', import.meta.url)
if (scenario === 'cleanup-hook-registration-failure') {
  process.env.NAPI_MODULE_INIT_ROLLBACK_FAIL_RUNTIME_CLEANUP_HOOK = '1'
}
const worker = new Worker(workerUrl, {
  env: process.env,
  workerData: {
    addonPath,
  },
})
await new Promise((resolve, reject) => {
  let ready = false
  const timer = setTimeout(() => {
    worker.terminate().catch(() => {})
    reject(new Error('module-init rollback worker timed out'))
  }, operationTimeout)

  worker.on('message', (message) => {
    if (message?.type === 'ready') {
      ready = true
    }
  })
  worker.once('error', (error) => {
    clearTimeout(timer)
    reject(error)
  })
  worker.once('exit', (code) => {
    clearTimeout(timer)
    if (ready && code === 0) {
      resolve()
    } else {
      reject(
        new Error(
          `module-init rollback worker exited with code ${code} before successful cleanup`,
        ),
      )
    }
  })
})
