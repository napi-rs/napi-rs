import test from 'ava'

import { napiVersion } from '../napi-version'

const bindings = require('../../index.node')

test('should set and get instance data', (t) => {
  if (napiVersion >= 6) {
    t.is(bindings.getInstanceData(), undefined)
    bindings.setInstanceData()
    t.is(bindings.getInstanceData(), 1024)
  } else {
    t.is(bindings.getInstanceData, undefined)
    t.is(bindings.setInstanceData, undefined)
  }
})

test('should throw if get instance data type mismatched', (t) => {
  if (napiVersion >= 6) {
    t.throws(bindings.getWrongTypeInstanceData)
  } else {
    t.is(bindings.getWrongTypeInstanceData, undefined)
  }
})
