import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { setTimeout as delay } from 'node:timers/promises'

const require = createRequire(import.meta.url)
const binding = require('../index.cjs')
const mode = process.argv[2]

if (typeof global.gc !== 'function') {
  throw new Error('async reference setup ownership test requires --expose-gc')
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

function createRejectedSetupReference() {
  let probe = binding.createAsyncReferenceSetupProbe(42)
  const reference = new WeakRef(probe)
  assert.throws(
    () => binding.asyncReferenceSetupProbe(probe, 'not a number'),
    /Failed to convert napi value String into rust type `u32`/,
  )
  probe = undefined
  return reference
}

function createPartialSetupReference() {
  let probe = binding.createAsyncReferenceSetupProbe(42)
  const reference = new WeakRef(probe)
  assert.throws(
    () => binding.asyncPartialReferenceSetupProbe(probe),
    /failed to create napi ref/,
  )
  probe = undefined
  return reference
}

const createReference = {
  'conversion-failure': createRejectedSetupReference,
  'partial-reference': createPartialSetupReference,
}[mode]
assert.ok(createReference, `unknown async reference setup mode: ${mode}`)

const references = Array.from({ length: 32 }, createReference)
await delay(0)
await forceGcUntil(
  () => references.every((reference) => reference.deref() === undefined),
  `async arguments remained referenced after ${mode} setup failed`,
)

console.log(`async reference setup ownership passed: ${mode}`)
