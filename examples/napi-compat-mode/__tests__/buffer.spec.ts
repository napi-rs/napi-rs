import { test } from 'node:test'
import assert from 'node:assert'

// @ts-expect-error
import bindings from '../index.node'

test('should get buffer length', () => {
  const fixture = Buffer.from('wow, hello')
  assert.strictEqual(bindings.getBufferLength(fixture), fixture.length)
})

test('should stringify buffer', () => {
  const fixture = 'wow, hello'
  assert.strictEqual(bindings.bufferToString(Buffer.from(fixture)), fixture)
})

test('should copy', () => {
  const fixture = Buffer.from('wow, hello')
  const copyBuffer = bindings.copyBuffer(fixture)
  assert.deepStrictEqual(copyBuffer, fixture)
  assert.notStrictEqual(fixture, copyBuffer)
})

test('should create borrowed buffer with noop finalize', () => {
  assert.deepStrictEqual(
    bindings.createBorrowedBufferWithNoopFinalize(),
    Buffer.from([1, 2, 3]),
  )
})

test('should create borrowed buffer with finalize', () => {
  assert.deepStrictEqual(
    bindings.createBorrowedBufferWithFinalize(),
    Buffer.from([1, 2, 3]),
  )
})

test('should create empty borrowed buffer with finalize', () => {
  assert.throws(() => bindings.createEmptyBorrowedBufferWithFinalize().toString(), {
    message: 'Borrowed data should not be null',
  })
  assert.throws(() => bindings.createEmptyBorrowedBufferWithFinalize().toString(), {
    message: 'Borrowed data should not be null',
  })
})

test('should create empty buffer', () => {
  assert.strictEqual(bindings.createEmptyBuffer().toString(), '')
  assert.strictEqual(bindings.createEmptyBuffer().toString(), '')
})

test('should be able to mutate buffer', () => {
  const fixture = Buffer.from([0, 1])
  bindings.mutateBuffer(fixture)
  assert.strictEqual(fixture[1], 42)
})
