import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

if (typeof global.gc !== 'function') {
  throw new Error('Custom GC owner-release test requires --expose-gc')
}

const binding = require('../index.cjs')
const allocationSize = 4 * 1024 * 1024
const iterations = 20

function consumeOwnerThreadValues() {
  assert.equal(
    binding.validateBuffer(Buffer.allocUnsafe(allocationSize)),
    allocationSize,
  )
  assert.equal(
    binding.validateTypedArray(new Uint8Array(allocationSize)),
    allocationSize,
  )
}

for (let index = 0; index < 4; index += 1) {
  consumeOwnerThreadValues()
}
global.gc()

const initial = process.memoryUsage()
for (let index = 0; index < iterations; index += 1) {
  consumeOwnerThreadValues()
  global.gc()
}
const final = process.memoryUsage()
const externalGrowth = final.external - initial.external
const arrayBufferGrowth = final.arrayBuffers - initial.arrayBuffers
const maximumExpectedGrowth = allocationSize * 8

assert.ok(
  externalGrowth < maximumExpectedGrowth,
  `owner-thread Buffer and TypedArray references retained ${externalGrowth} external bytes before the event loop yielded`,
)
assert.ok(
  arrayBufferGrowth < maximumExpectedGrowth,
  `owner-thread Buffer and TypedArray references retained ${arrayBufferGrowth} ArrayBuffer bytes before the event loop yielded`,
)

console.log('Custom GC owner-thread release passed')
