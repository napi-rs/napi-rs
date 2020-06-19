const test = require('ava')
const bindings = require('../index.node')

test('should get js function called from a thread', async (t) => {
  let called = 0

  return new Promise((resolve, reject) => {
    bindings.testThreadsafeFunction((err, ret) => {
      called += 1
      try {
        t.is(err, null)
        t.is(ret, 42)
      } catch (err) {
        reject(err)
      }

      if (called === 2) {
        resolve()
      }
    })
  })
})
