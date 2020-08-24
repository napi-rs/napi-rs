import test from 'ava'

const bindings = require('../index.node')

test('should create external object and get it back', (t) => {
  const fixture = 42
  const externalObject = bindings.createExternal(42)
  t.is(bindings.getExternalCount(externalObject), fixture)
})
