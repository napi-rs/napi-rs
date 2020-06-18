const test = require('ava')

const bindings = require('../index.node')

test('should be able to throw error from native', (t) => {
  t.throws(bindings.testThrow)
})

test('should be able to throw error from native with reason', (t) => {
  const reason = 'Fatal'
  t.throws(() => bindings.testThrowWithReason(reason), null, reason)
})

test('should throw if argument type is not match', (t) => {
  t.throws(() => bindings.testThrowWithReason(2))
})
