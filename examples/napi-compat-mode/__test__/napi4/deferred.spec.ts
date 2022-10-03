import test from 'ava'

const bindings = require('../../index.node')

test('should resolve deferred from background thread', async (t) => {
  const promise = bindings.testDeferred(false)
  t.assert(promise instanceof Promise)

  const result = await promise
  t.is(result, 15)
})

test('should reject deferred from background thread', async (t) => {
  await t.throwsAsync(() => bindings.testDeferred(true), { message: 'Fail' })
})
