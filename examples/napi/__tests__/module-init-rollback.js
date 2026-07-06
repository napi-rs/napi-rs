import { copyFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'

const operationTimeout = 15_000
const addonPath = process.argv[2]

if (!addonPath) {
  throw new TypeError('module-init rollback addon path is required')
}

const temporaryDirectory = await mkdtemp(
  join(tmpdir(), 'napi-module-init-rollback-'),
)
const failedAddonPath = join(temporaryDirectory, 'failed.node')
const successfulAddonPath = join(temporaryDirectory, 'successful.node')

try {
  await Promise.all([
    copyFile(addonPath, failedAddonPath),
    copyFile(addonPath, successfulAddonPath),
  ])

  const worker = new Worker(
    new URL('./module-init-rollback-worker.js', import.meta.url),
    {
      env: process.env,
      workerData: { failedAddonPath, successfulAddonPath },
    },
  )
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
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true })
}
