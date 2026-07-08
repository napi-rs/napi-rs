import assert from 'node:assert/strict'
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
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

const barrierDirectory =
  scenario === 'cleanup-hook-registration-failure'
    ? await mkdtemp(join(tmpdir(), 'napi-module-init-rollback-retirement-'))
    : undefined
if (barrierDirectory) {
  process.env.NAPI_MODULE_INIT_ROLLBACK_SHUTDOWN_ENTERED = join(
    barrierDirectory,
    'entered',
  )
  process.env.NAPI_MODULE_INIT_ROLLBACK_SHUTDOWN_RELEASE = join(
    barrierDirectory,
    'release',
  )
}

const worker = new Worker(workerUrl, {
  env: process.env,
  workerData: {
    addonPath,
    role:
      scenario === 'cleanup-hook-registration-failure' ? 'failure' : undefined,
  },
})

async function waitForFile(path) {
  const deadline = Date.now() + operationTimeout
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

try {
  const waitForWorkerMessage = (target, expectedType) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        target.terminate().catch(() => {})
        reject(new Error('module-init rollback worker timed out'))
      }, operationTimeout)

      const cleanup = () => {
        clearTimeout(timer)
        target.off('message', onMessage)
        target.off('error', onError)
        target.off('exit', onExit)
      }
      const onMessage = (message) => {
        if (message?.type === expectedType) {
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
          new Error(`module-init rollback worker exited with code ${code}`),
        )
      }
      target.on('message', onMessage)
      target.once('error', onError)
      target.once('exit', onExit)
    })

  if (barrierDirectory) {
    const enteredPath = process.env.NAPI_MODULE_INIT_ROLLBACK_SHUTDOWN_ENTERED
    const releasePath = process.env.NAPI_MODULE_INIT_ROLLBACK_SHUTDOWN_RELEASE
    const failed = waitForWorkerMessage(worker, 'failed')
    await waitForFile(enteredPath)
    const recovery = new Worker(workerUrl, {
      env: process.env,
      workerData: {
        addonPath,
        role: 'recovery',
      },
    })
    const loading = waitForWorkerMessage(recovery, 'loading')
    let recovered = false
    const recoveryCompletion = waitForWorkerMessage(recovery, 'ready').then(
      () => {
        recovered = true
      },
    )
    await loading
    await delay(100)
    assert.equal(
      recovered,
      false,
      'replacement module registration overtook runtime rollback and module-count retirement',
    )
    await writeFile(releasePath, 'release')
    await Promise.all([failed, recoveryCompletion])
    await recovery.terminate()
  } else {
    await waitForWorkerMessage(worker, 'ready')
  }
} finally {
  if (barrierDirectory) {
    await writeFile(
      process.env.NAPI_MODULE_INIT_ROLLBACK_SHUTDOWN_RELEASE,
      'release',
    ).catch(() => {})
    delete process.env.NAPI_MODULE_INIT_ROLLBACK_SHUTDOWN_ENTERED
    delete process.env.NAPI_MODULE_INIT_ROLLBACK_SHUTDOWN_RELEASE
    await rm(barrierDirectory, { recursive: true, force: true })
  }
  await worker.terminate().catch(() => {})
}
