import test from 'ava'

const bindings = require('../index.node')

test('should call the function', (t) => {
  bindings.testCallFunction((arg1: string, arg2: string) => {
    t.is(`${arg1} ${arg2}`, 'hello world')
  })
})

test('should set "this" properly', (t) => {
  const obj = {}
  bindings.testCallFunctionWithThis.call(obj, function (this: typeof obj) {
    t.is(this, obj)
  })
})

test('function context should be able to get with context_ref_unchecked', (t) => {
  t.false(bindings.functionWithStringContext(''))
  t.true(bindings.functionWithStringContext('1'))
})
