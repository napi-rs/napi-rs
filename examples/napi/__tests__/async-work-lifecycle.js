import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const binding = require('../index.cjs')

const finallyCountBefore = binding.panickingAsyncWorkFinallyCount()
await assert.rejects(
  binding.createPanickingAsyncWork(),
  /intentional async work compute panic/,
)
assert.equal(
  binding.panickingAsyncWorkFinallyCount(),
  finallyCountBefore + 1,
)

const resolveFinallyCountBefore =
  binding.resolvePanickingAsyncWorkFinallyCount()
await assert.rejects(
  binding.createResolvePanickingAsyncWork(),
  /intentional async work resolve panic/,
)
assert.equal(
  binding.resolvePanickingAsyncWorkFinallyCount(),
  resolveFinallyCountBefore + 1,
)

const running = binding.createRunningAsyncWorkLifecycle()
try {
  assert.throws(
    () => binding.cancelAsyncWorkLifecycle(running.id),
    /Cancel async work failed/,
  )
  binding.releaseAsyncWorkLifecycle(running.id)
  assert.equal(await running.promise, 42)
  assert.doesNotThrow(() => binding.cancelAsyncWorkLifecycle(running.id))
} finally {
  binding.releaseAsyncWorkLifecycle(running.id)
  binding.disposeAsyncWorkLifecycle(running.id)
}

const queued = binding.createQueuedAsyncWorkLifecycle()
try {
  assert.doesNotThrow(() => binding.cancelAsyncWorkLifecycle(queued.id))
  await assert.rejects(queued.promise, (error) => error?.name === 'AbortError')
  assert.doesNotThrow(() => binding.cancelAsyncWorkLifecycle(queued.id))
} finally {
  binding.releaseAsyncWorkLifecycle(queued.id)
  binding.disposeAsyncWorkLifecycle(queued.id)
}

console.log('AsyncWorkPromise cancellation lifecycle passed')
