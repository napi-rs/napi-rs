const test = require('ava')

const bindings = require('../index.node')

test('should call the function', async (t) => {
  const ret = await new Promise((resolve) => {
    bindings.testCallFunction((arg1, arg2) => {
      resolve(`${arg1} ${arg2}`)
    })
  })
  t.is(ret, 'hello world')
})

test('should set "this" properly', async (t) => {
  const obj = {}
  const ret = await new Promise((resolve) => {
    bindings.testCallFunctionWithThis(obj, function () {
      resolve(this)
    })
  })
  t.is(ret, obj)
})
