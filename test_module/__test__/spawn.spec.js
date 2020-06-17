const test = require('ava')

const bindings = require('../index.node')

test('should be able to spawn thread and return promise', async (t) => {
  const result = await bindings.testSpawnThread(20)
  t.is(result, 6765)
})
