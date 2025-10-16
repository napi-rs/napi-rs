import { test, before, after, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert'

import { NotWritableClass, shutdownRuntime } from '../index.cjs'

after(() => {
  shutdownRuntime()
})

test('Not Writable Class', () => {
  const obj = new NotWritableClass('1')
  assert.throws(() => {
    obj.name = '2'
  })
  obj.setName('2')
  assert.strictEqual(obj.name, '2')
  assert.throws(() => {
    obj.setName = () => {}
  })
})
