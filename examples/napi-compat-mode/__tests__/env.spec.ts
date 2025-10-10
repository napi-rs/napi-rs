import { test } from 'node:test'
import assert from 'node:assert'

// @ts-expect-error
import bindings from '../index.node'

test('should be able to access env variable from native', () => {
  assert.strictEqual(bindings.getEnvVariable(), '@examples/compat-mode')
})

test('should be able to throw syntax error', () => {
  const msg = 'Custom Syntax Error'
  try {
    bindings.throwSyntaxError(msg)
    throw new Error('Unreachable')
  } catch (e) {
    assert.ok(e instanceof SyntaxError)
    assert.strictEqual((e as SyntaxError).message, msg)
  }
})

test('should be able to coerceToBool', () => {
  assert.ok(bindings.coerceToBool(true))
  assert.ok(bindings.coerceToBool(1))
  assert.ok(bindings.coerceToBool({}))
  assert.ok(bindings.coerceToBool(Symbol()))
  assert.strictEqual(bindings.coerceToBool(0, false))
  assert.strictEqual(bindings.coerceToBool(undefined, false))
  assert.strictEqual(bindings.coerceToBool(null, false))
  assert.strictEqual(bindings.coerceToBool(NaN, false))
})
