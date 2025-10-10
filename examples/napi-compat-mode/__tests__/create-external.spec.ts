import { test } from 'node:test'
import assert from 'node:assert'

// @ts-expect-error
import bindings from '../index.node'

test('should create external object and get it back', () => {
  const fixture = 42
  const externalObject = bindings.createExternal(42)
  assert.strictEqual(bindings.getExternalCount(externalObject), fixture)
})

test('should create external with size hint', () => {
  const fixture = 42
  const externalObject = bindings.createExternalWithHint(42)
  assert.strictEqual(bindings.getExternalCount(externalObject), fixture)
})
