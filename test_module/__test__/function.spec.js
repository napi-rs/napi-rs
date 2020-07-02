const test = require('ava')

const bindings = require('../index.node')

test('should call the function', (t) => {
  bindings.testCallFunction((arg1, arg2) => {
    t.is(`${arg1} ${arg2}`, 'hello world')
  })
})

test('should set "this" properly', (t) => {
  const obj = {}
  bindings.testCallFunctionWithThis.call(obj, function () {
    t.is(this, obj)
  })
})
