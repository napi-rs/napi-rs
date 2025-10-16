import { test } from 'node:test'
import assert from 'node:assert'

// @ts-expect-error
import bindings from '../index.node'

test('either should work', () => {
  const fixture = 'napi'
  assert.strictEqual(bindings.eitherNumberString(1), 101)
  assert.strictEqual(bindings.eitherNumberString(fixture), `Either::B(${fixture})`)
})

test('dynamic argument length should work', () => {
  assert.strictEqual(bindings.dynamicArgumentLength(1), 101)
  assert.strictEqual(bindings.dynamicArgumentLength(), 42)
})
