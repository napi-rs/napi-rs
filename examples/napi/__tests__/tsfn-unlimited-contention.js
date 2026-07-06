import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { setTimeout as delay } from 'node:timers/promises'

import { requireLifecycleFixture } from './lifecycle-fixture.js'

const require = createRequire(import.meta.url)
const { fixture: lifecycle } = requireLifecycleFixture(require, '../index.cjs')

let callbackCount = 0
let resolveCallbacks
const callbacksCompleted = new Promise((resolve) => {
  resolveCallbacks = resolve
})

lifecycle.verifyTsfnUnlimitedBlockingContention(() => {
  callbackCount += 1
  if (callbackCount === 2) {
    resolveCallbacks()
  }
})

const completed = await Promise.race([
  callbacksCompleted.then(() => true),
  delay(10_000).then(() => false),
])
assert.equal(completed, true, 'unlimited TSFN callbacks did not drain')
assert.equal(callbackCount, 2)
console.log('unlimited TSFN contention passed')
