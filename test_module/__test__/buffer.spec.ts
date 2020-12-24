import test from 'ava'

const bindings = require('../index.node')

test('should get buffer length', (t) => {
  const fixture = Buffer.from('wow, hello')
  t.is(bindings.getBufferLength(fixture), fixture.length)
})

test('should stringify buffer', (t) => {
  const fixture = 'wow, hello'
  t.is(bindings.bufferToString(Buffer.from(fixture)), fixture)
})

test('should copy', (t) => {
  const fixture = Buffer.from('wow, hello')
  const copyBuffer = bindings.copyBuffer(fixture)
  t.deepEqual(copyBuffer, fixture)
  t.not(fixture, copyBuffer)
})

test('should create borrowed buffer with noop finalize', (t) => {
  t.deepEqual(
    bindings.createBorrowedBufferWithNoopFinalize(),
    Buffer.from([1, 2, 3]),
  )
})

test('should create borrowed buffer with finalize', (t) => {
  t.deepEqual(
    bindings.createBorrowedBufferWithFinalize(),
    Buffer.from([1, 2, 3]),
  )
})
