import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { setTimeout as delay } from 'node:timers/promises'

const require = createRequire(import.meta.url)
const binding = require('../index.cjs')

if (typeof global.gc !== 'function') {
  throw new Error('ArrayBuffer detachment test requires --expose-gc')
}

async function forceGcUntil(predicate, message) {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    global.gc()
    const pressure = new ArrayBuffer(1024 * 1024)
    assert.equal(pressure.byteLength, 1024 * 1024)
    await delay(10)
    if (predicate()) {
      return
    }
  }
  throw new Error(message)
}

const finalizeCountBefore = binding.detachableExternalArraybufferFinalizeCount()

function detachExternalArrayBuffer() {
  const buffer = binding.createDetachableExternalArraybuffer()
  const alias = buffer
  const view = new Uint8Array(alias)

  assert.deepEqual([...view], [1, 2, 3, 4])
  binding.detachArraybufferWithAlias(buffer, alias)
  assert.equal(buffer.byteLength, 0)
  assert.equal(alias.byteLength, 0)
  assert.equal(view.byteLength, 0)
  assert.equal(view.length, 0)

  return new WeakRef(buffer)
}

const detachedBuffer = detachExternalArrayBuffer()
await delay(0)
await forceGcUntil(
  () =>
    detachedBuffer.deref() === undefined &&
    binding.detachableExternalArraybufferFinalizeCount() ===
      finalizeCountBefore + 1,
  'detached external ArrayBuffer backing data was not finalized exactly once',
)

for (let index = 0; index < 4; index += 1) {
  global.gc()
  await delay(10)
}
assert.equal(
  binding.detachableExternalArraybufferFinalizeCount(),
  finalizeCountBefore + 1,
)

console.log('ArrayBuffer detachment passed')
