const test = require('ava')

const bindings = require('../index.node')

test('should return false if value is not date', (t) => {
  t.false(bindings.testObjectIsDate({}))
  t.false(bindings.testObjectIsDate(null))
  t.false(bindings.testObjectIsDate())
  t.false(bindings.testObjectIsDate(10249892))
})

test('should return true if value is date', (t) => {
  t.true(bindings.testObjectIsDate(new Date()))
})
