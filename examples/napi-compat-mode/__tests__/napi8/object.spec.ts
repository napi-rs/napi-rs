import { test } from 'node:test'
import assert from 'node:assert'

import { napiVersion } from '../napi-version'

// @ts-expect-error
import bindings from '../../index.node'

const testFn = napiVersion >= 8 ? test : test.skip

test('should be able to freeze object', () => {
  const obj: any = {}
  bindings.testFreezeObject(obj)
  assert.ok(Object.isFrozen(obj))
  assert.throws(() => {
    obj.a = 1
  })
})

test('should be able to seal object', () => {
  const obj: any = {}
  bindings.testSealObject(obj)
  assert.ok(Object.isSealed(obj))
  assert.throws(() => {
    obj.a = 1
  })
})
