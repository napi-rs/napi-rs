import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { setImmediate } from 'node:timers/promises'

const require = createRequire(import.meta.url)
const binding = require('../index.cjs')

assert.equal(
  typeof global.gc,
  'function',
  'Deferred trace release test requires --expose-gc',
)

async function rejectedErrorReference() {
  let promise = binding.throwAsyncError()
  let reference
  try {
    await promise
    assert.fail('throwAsyncError must reject')
  } catch (error) {
    assert.equal(error.message, 'Async Error')
    assert.equal(error.code, 'InvalidArg')
    reference = new WeakRef(error)
  }
  promise = null
  return reference
}

const reference = await rejectedErrorReference()
for (let round = 0; round < 50 && reference.deref() !== undefined; round++) {
  await setImmediate()
  const pressure = Array.from({ length: 10_000 }, (_, index) => ({
    index,
    value: `${round}:${index}`,
  }))
  assert.equal(pressure.length, 10_000)
  global.gc()
}

assert.equal(
  reference.deref(),
  undefined,
  'DeferredTrace kept its rejection error referenced after settlement',
)
binding.shutdownRuntime()
console.log('Deferred trace release passed')
