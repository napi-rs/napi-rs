import test from 'ava'

const bindings = require('../index.node')

test('should be able to spawn thread and return promise', async (t) => {
  const result = await bindings.testSpawnThread(20)
  t.is(result, 6765)
})

test('should be able to spawn thread with ref value', async (t) => {
  const fixture = 'hello'
  const result = await bindings.testSpawnThreadWithRef(Buffer.from(fixture))
  t.is(result, fixture.length)
})
