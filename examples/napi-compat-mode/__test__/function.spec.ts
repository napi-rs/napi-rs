import test from 'ava'

const bindings = require('../index.node')

test('should call the function', (t) => {
  bindings.testCallFunction((arg1: string, arg2: string) => {
    t.is(`${arg1} ${arg2}`, 'hello world')
  })
})

test('should call function with ref args', (t) => {
  bindings.testCallFunctionWithRefArguments((arg1: string, arg2: string) => {
    t.is(`${arg1} ${arg2}`, 'hello world')
  })
})

test('should set "this" properly', (t) => {
  const obj = {}
  bindings.testCallFunctionWithThis.call(obj, function (this: typeof obj) {
    t.is(this, obj)
  })
})
