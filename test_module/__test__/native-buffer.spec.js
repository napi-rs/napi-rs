const test = require('ava')

const bindings = require('../index.node')

test('should be able to resolve NativeBuffer from async task', async (t) => {
  const result = await bindings.getNativeBufferFromAsyncTask()
  t.is(result.length, 1024 * 1024 * 100)
})

test('NativeBuffer to_js_buffer should zero copy', async (t) => {
  const time1 = process.hrtime()
  await bindings.getNativeBufferFromAsyncTask()
  const duration1 = process.hrtime(time1)
  const time2 = process.hrtime()
  await bindings.getVecFromAsyncTask()
  const duration2 = process.hrtime(time2)

  t.true(duration1[0] <= duration2[0] && duration1[1] < duration2[1])
})
