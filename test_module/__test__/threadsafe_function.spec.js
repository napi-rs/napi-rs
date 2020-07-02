const test = require('ava')
const bindings = require('../index.node')

test('should get js function called from a thread', async (t) => {
  let called = 0

  return new Promise((resolve, reject) => {
    bindings.testThreadsafeFunction((...args) => {
      called += 1
      try {
        t.deepEqual(args, [null, 42, 1, 2, 3])
      } catch (err) {
        reject(err)
      }

      if (called === 2) {
        resolve()
      }
    })
  })
})
