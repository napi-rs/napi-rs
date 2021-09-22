import ava from 'ava'

import { napiVersion } from '../napi-version'

const bindings = require('../../index.node')

const test = napiVersion >= 8 ? ava : ava.skip

test('should be able to freeze object', (t) => {
  const obj: any = {}
  bindings.testFreezeObject(obj)
  t.true(Object.isFrozen(obj))
  t.throws(() => {
    obj.a = 1
  })
})

test('should be able to seal object', (t) => {
  const obj: any = {}
  bindings.testSealObject(obj)
  t.true(Object.isSealed(obj))
  t.throws(() => {
    obj.a = 1
  })
})
