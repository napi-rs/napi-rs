const test = require('ava')
const bindings = require('../index.node')

test('should call callback with the first arguments as an Error', async (t) => {
  return new Promise((resolve, reject) => {
    bindings.testTsfnError((err) => {
      try {
        t.is(err instanceof Error, true)
        t.is(err.message, 'invalid')
        resolve()
      } catch (err) {
        reject(err)
      }
    })
  })
})
