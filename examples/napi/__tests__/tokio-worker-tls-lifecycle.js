import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const lifecycle = require('../index.cjs')
const directory = await mkdtemp(join(tmpdir(), 'napi-tokio-worker-tls-'))
const workerResultPath = join(directory, 'worker-retirement-result')
const blockingResultPath = join(directory, 'blocking-retirement-result')
const blockingReleasePath = join(directory, 'blocking-release')

async function retryRestart() {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    try {
      lifecycle.restartTokioRuntimeAfterRetirement()
      return
    } catch (error) {
      assert.match(
        String(error),
        /still shutting down|untracked runtime threads/i,
      )
      await new Promise((resolve) => setTimeout(resolve, 1))
    }
  }
  throw new Error('timed out waiting to restart the supplied Tokio runtime')
}

async function readResult(path) {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    try {
      return await readFile(path, 'utf8')
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw error
      }
      await new Promise((resolve) => setTimeout(resolve, 1))
    }
  }
  throw new Error(`timed out waiting for retirement result ${path}`)
}

try {
  await lifecycle.armTokioWorkerTlsRetirementProbe(workerResultPath)
  await lifecycle.armTokioBlockingTlsRetirementProbe(
    blockingResultPath,
    blockingReleasePath,
  )
  lifecycle.shutdownAsyncRuntimeForTest()
  assert.throws(
    () => lifecycle.waitForTokioRuntimeRetirement(),
    /supplied Tokio runtime.*untracked runtime threads/i,
  )
  await writeFile(blockingReleasePath, 'release')

  const [workerResult, blockingResult] = await Promise.all([
    readResult(workerResultPath),
    readResult(blockingResultPath),
  ])
  for (const result of [workerResult, blockingResult]) {
    assert.match(result, /^WouldDeadlock\n/)
    assert.match(result, /supplied Tokio runtime.*untracked runtime threads/i)
  }

  await retryRestart()
  assert.equal(await lifecycle.tokioRuntimeLifecycleValue(42), 42)
} finally {
  await writeFile(blockingReleasePath, 'release').catch(() => {})
  await rm(directory, { recursive: true, force: true })
}
