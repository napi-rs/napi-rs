import { test } from 'node:test'
import assert from 'node:assert'

// @ts-expect-error
import bindings from '../index.node'

test('should be able to throw error from native', () => {
  assert.throws(bindings.testThrow)
})

test('should be able to throw error from native with reason', () => {
  const reason = 'Fatal'
  assert.throws(() => bindings.testThrowWithReason(reason), void 0, reason)
})

test('should throw if argument type is not match', () => {
  assert.throws(() => bindings.testThrowWithReason(2))
})

test('should throw if Rust code panic', () => {
  assert.throws(() => bindings.testThrowWithPanic())
})
