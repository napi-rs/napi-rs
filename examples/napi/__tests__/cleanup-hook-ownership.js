import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'

const require = createRequire(import.meta.url)
const lifecycle = require('../index.cjs')

const syncBefore = lifecycle.syncCleanupHookCounts()
lifecycle.registerRemovableSyncCleanupHook()
assert.deepEqual(lifecycle.syncCleanupHookCounts(), syncBefore)
lifecycle.removeRemovableSyncCleanupHook()
assert.deepEqual(lifecycle.syncCleanupHookCounts(), [
  syncBefore[0] + 1,
  syncBefore[1] + 1,
  syncBefore[2],
])
assert.throws(() => lifecycle.removeRemovableSyncCleanupHook(), {
  message: /no removable sync cleanup hook is registered/,
})

const asyncBefore = lifecycle.asyncCleanupHookCounts()
lifecycle.registerRemovableAsyncCleanupHook()
assert.deepEqual(lifecycle.asyncCleanupHookCounts(), asyncBefore)
lifecycle.removeRemovableAsyncCleanupHook()
assert.deepEqual(lifecycle.asyncCleanupHookCounts(), [
  asyncBefore[0] + 1,
  asyncBefore[1] + 1,
  asyncBefore[2],
])
assert.throws(() => lifecycle.removeRemovableAsyncCleanupHook(), {
  message: /no removable async cleanup hook is registered/,
})

const workerPath = new URL(
  './cleanup-hook-ownership-worker.js',
  import.meta.url,
)
const directory = await mkdtemp(join(tmpdir(), 'napi-cleanup-hook-ownership-'))

async function runCleanupWorker(mode, expected) {
  const resultPath = join(directory, `${mode}.txt`)
  const worker = new Worker(workerPath, {
    workerData: { mode, resultPath },
  })
  await new Promise((resolve, reject) => {
    worker.once('error', reject)
    worker.once('exit', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(
          new Error(`${mode} cleanup hook worker exited with code ${code}`),
        )
      }
    })
  })
  assert.equal(await readFile(resultPath, 'utf8'), expected)
}

try {
  await runCleanupWorker('sync', 'removed=true;data=1;capture=1')
  await runCleanupWorker('async', 'dropped=true;data=1;capture=1')
} finally {
  await rm(directory, { recursive: true, force: true })
}

console.log('cleanup-hook ownership passed')
