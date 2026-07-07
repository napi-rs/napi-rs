import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { Worker } from 'node:worker_threads'

const require = createRequire(import.meta.url)

async function waitForFile(path, label) {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    try {
      return await readFile(path, 'utf8')
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error
      }
    }
    await delay(5)
  }
  throw new Error(`timed out waiting for ${label}`)
}

function waitForWorkerReady(worker) {
  return new Promise((resolve, reject) => {
    worker.once('error', reject)
    worker.once('message', resolve)
  })
}

const directory = await mkdtemp(join(tmpdir(), 'napi-deferred-lifecycle-'))
const resultPath = join(directory, 'cleanup-order.txt')
try {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const readyPath = join(directory, `race-${attempt}.ready`)
    const releasePath = join(directory, `race-${attempt}.release`)
    const donePath = join(directory, `race-${attempt}.done`)
    const raceWorker = new Worker(
      new URL('./deferred-lifecycle-worker.js', import.meta.url),
      {
        workerData: {
          mode: 'teardown-race',
          readyPath,
          releasePath,
          donePath,
          count: 256,
        },
      },
    )
    await waitForWorkerReady(raceWorker)
    assert.equal(
      await waitForFile(readyPath, 'deferred race readiness'),
      'ready',
    )
    const termination = raceWorker.terminate()
    await writeFile(releasePath, 'release')
    await termination
    assert.equal(
      await waitForFile(donePath, 'deferred race completion'),
      'done',
    )
  }

  const worker = new Worker(
    new URL('./deferred-lifecycle-worker.js', import.meta.url),
    {
      workerData: { mode: 'cleanup-order', resultPath },
    },
  )
  await waitForWorkerReady(worker)
  await worker.terminate()
  assert.equal(await readFile(resultPath, 'utf8'), 'dropped=true')
} finally {
  await rm(directory, { recursive: true, force: true })
}

const fixture = require('../index.cjs')
fixture.abandonDeferredClones()

const queuedSettlement = fixture.settleDeferredBeforeFinalizeRegistration()
assert.equal(fixture.deferredFinalizeCallbackCount(), 0)
await queuedSettlement
assert.equal(fixture.deferredFinalizeCallbackCount(), 1)

await fixture.settleDeferredClone()
assert.equal(fixture.registerLateDeferredFinalizeCallback(), true)

process.stdout.write('deferred lifecycle passed\n')
