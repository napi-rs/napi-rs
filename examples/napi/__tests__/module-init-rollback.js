import assert from 'node:assert/strict'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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
  process.env.NAPI_TEST_RUNTIME_MODULE_RETIREMENT_ENTERED = join(
    barrierDirectory,
    'entered',
  )
  process.env.NAPI_TEST_RUNTIME_MODULE_RETIREMENT_RESULT = join(
    barrierDirectory,
    'result',
  )
  process.env.NAPI_TEST_RUNTIME_MODULE_RETIREMENT_RELEASE = join(
    barrierDirectory,
    'release',
  )
}

const worker = new Worker(workerUrl, {
  env: process.env,
  workerData: {
    addonPath,
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
  const completion = new Promise((resolve, reject) => {
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

  if (barrierDirectory) {
    const enteredPath = process.env.NAPI_TEST_RUNTIME_MODULE_RETIREMENT_ENTERED
    const resultPath = process.env.NAPI_TEST_RUNTIME_MODULE_RETIREMENT_RESULT
    const releasePath = process.env.NAPI_TEST_RUNTIME_MODULE_RETIREMENT_RELEASE
    await waitForFile(enteredPath)
    await waitForFile(resultPath)
    const [status, ...reasonLines] = (await readFile(resultPath, 'utf8')).split(
      '\n',
    )
    assert.equal(status, 'WouldDeadlock')
    assert.match(
      reasonLines.join('\n'),
      /lifecycle transition is already in progress/i,
      'registration rollback published Stopped before module retirement completed',
    )
    await writeFile(releasePath, 'release')
  }

  await completion
} finally {
  if (barrierDirectory) {
    await writeFile(
      process.env.NAPI_TEST_RUNTIME_MODULE_RETIREMENT_RELEASE,
      'release',
    ).catch(() => {})
    delete process.env.NAPI_TEST_RUNTIME_MODULE_RETIREMENT_ENTERED
    delete process.env.NAPI_TEST_RUNTIME_MODULE_RETIREMENT_RESULT
    delete process.env.NAPI_TEST_RUNTIME_MODULE_RETIREMENT_RELEASE
    await rm(barrierDirectory, { recursive: true, force: true })
  }
}
