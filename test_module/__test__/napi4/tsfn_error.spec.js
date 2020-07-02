const test = require('ava')

const bindings = require('../../index.node')
const napiVersion = require('../napi-version')

test('should call callback with the first arguments as an Error', async (t) => {
  if (napiVersion < 4) {
    t.is(bindings.testTsfnError, undefined)
    return
  }
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
