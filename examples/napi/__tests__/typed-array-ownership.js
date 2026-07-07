import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { setTimeout as delay } from 'node:timers/promises'

const require = createRequire(import.meta.url)
const binding = require('../index.cjs')
const lifecycle = binding

if (typeof global.gc !== 'function') {
  throw new Error('typed-array ownership test requires --expose-gc')
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

function createRejectedTypedArrayReference() {
  const value = new Uint8Array(64 * 1024)
  const reference = new WeakRef(value)
  assert.throws(() => binding.convertU32Array(value), {
    message: /Expected Uint32Array, got Uint8Array/,
  })
  return reference
}

const rejectedReferences = Array.from(
  { length: 32 },
  createRejectedTypedArrayReference,
)
await delay(0)
await forceGcUntil(
  () =>
    rejectedReferences.every((reference) => reference.deref() === undefined),
  'wrong-subtype TypedArrays remained retained after conversion failed',
)

const finalizeCountBefore = lifecycle.mutableTypedArrayFinalizeCount()
const valueCount = 16

function createMutableTypedArrays() {
  for (let index = 0; index < valueCount; index += 1) {
    const empty = index % 2 === 0
    const value = lifecycle.createMutableTypedArrayForOwnershipTest(empty)
    assert.deepEqual([...value], empty ? [] : [1, 2, 3, 4])
  }
}

createMutableTypedArrays()
await delay(0)
await forceGcUntil(
  () =>
    lifecycle.mutableTypedArrayFinalizeCount() ===
    finalizeCountBefore + valueCount,
  'mutable TypedArray backing data was not finalized exactly once',
)

for (let index = 0; index < 4; index += 1) {
  global.gc()
  await delay(10)
}
assert.equal(
  lifecycle.mutableTypedArrayFinalizeCount(),
  finalizeCountBefore + valueCount,
)

console.log('typed-array ownership passed')
