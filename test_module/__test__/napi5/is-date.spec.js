const test = require('ava')

const napiVersion = require('../napi-version')
const bindings = require('../../index.node')

test('should return false if value is not date', (t) => {
  if (napiVersion >= 5) {
    t.false(bindings.testObjectIsDate({}))
    t.false(bindings.testObjectIsDate(null))
    t.false(bindings.testObjectIsDate())
    t.false(bindings.testObjectIsDate(10249892))
  } else {
    t.is(bindings.testObjectIsDate, undefined)
  }
})

test('should return true if value is date', (t) => {
  if (napiVersion >= 5) {
    t.true(bindings.testObjectIsDate(new Date()))
  } else {
    t.is(bindings.testObjectIsDate, undefined)
  }
})
