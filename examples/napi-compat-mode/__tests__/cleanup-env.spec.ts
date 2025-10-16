import { test } from 'node:test'
import assert from 'node:assert'

// @ts-expect-error
import bindings from '../index.node'

test('should be able to add cleanup hook', () => {
  assert.doesNotThrow(() => {
    const ret = bindings.addCleanupHook()
    assert.strictEqual(typeof ret, 'object')
  })
})

test('should be able to remove cleanup hook', () => {
  assert.doesNotThrow(() => {
    const ret = bindings.addCleanupHook()
    bindings.removeCleanupHook(ret)
  })
})
