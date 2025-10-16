import { test } from 'node:test'
import assert from 'node:assert'

import { napiVersion } from '../napi-version'

// @ts-expect-error
import bindings from '../../index.node'

test('should set and get instance data', () => {
  if (napiVersion >= 6) {
    assert.strictEqual(bindings.getInstanceData(), undefined)
    bindings.setInstanceData()
    assert.strictEqual(bindings.getInstanceData(), 1024)
  } else {
    assert.strictEqual(bindings.getInstanceData, undefined)
    assert.strictEqual(bindings.setInstanceData, undefined)
  }
})

test('should throw if get instance data type mismatched', () => {
  if (napiVersion >= 6) {
    assert.throws(bindings.getWrongTypeInstanceData)
  } else {
    assert.strictEqual(bindings.getWrongTypeInstanceData, undefined)
  }
})
