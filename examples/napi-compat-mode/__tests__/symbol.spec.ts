import { test } from 'node:test'
import assert from 'node:assert'

// @ts-expect-error
import bindings from '../index.node'

test('should create named symbol', () => {
  const symbol = bindings.createNamedSymbol()
  assert.ok(typeof symbol === 'symbol')
  assert.strictEqual(symbol.toString(), 'Symbol(native)')
})

test('should create unnamed symbol', () => {
  const symbol = bindings.createUnnamedSymbol()
  assert.ok(typeof symbol === 'symbol')
  assert.strictEqual(symbol.toString(), 'Symbol()')
})
