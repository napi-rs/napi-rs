const test = require('ava')

const bindings = require('../../index.node')
const napiVersion = require('../napi-version')

test('should get js function called from a thread', async (t) => {
  let called = 0

  if (napiVersion < 4) {
    t.is(bindings.testThreadsafeFunction, undefined)
    return
  }

  return new Promise((resolve, reject) => {
    bindings.testThreadsafeFunction((...args) => {
      called += 1
      try {
        t.deepEqual(args, [42, 1, 2, 3])
      } catch (err) {
        reject(err)
      }

      if (called === 2) {
        resolve()
      }
    })
  })
})
