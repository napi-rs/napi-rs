import test from 'ava'

import {
  AsyncIteratorConstructor,
  createAsyncIteratorIntoInstance,
  createSyncIteratorIntoInstance,
  shutdownRuntime,
} from '../index.cjs'

test.after(() => {
  shutdownRuntime()
})

test('struct-level async iterator constructor installs its iterator', async (t) => {
  const owner = new AsyncIteratorConstructor(2, 4)

  t.is(typeof owner[Symbol.asyncIterator], 'function')
  const iterator = owner[Symbol.asyncIterator]()
  t.is(iterator[Symbol.asyncIterator](), iterator)
  t.deepEqual(await iterator.next(), { value: 2, done: false })
  t.deepEqual(await iterator.next(), { value: 3, done: false })
  t.deepEqual(await iterator.next(), { value: undefined, done: true })
})

test('into_instance installs a sync iterator implementation', (t) => {
  const iterator = createSyncIteratorIntoInstance(3, 6)

  t.is(typeof iterator[Symbol.iterator], 'function')
  t.is(iterator[Symbol.iterator](), iterator)
  t.deepEqual([...iterator], [3, 4, 5])
})

test('into_instance installs an async iterator implementation', async (t) => {
  const owner = createAsyncIteratorIntoInstance(5, 7)

  t.is(typeof owner[Symbol.asyncIterator], 'function')
  const iterator = owner[Symbol.asyncIterator]()
  t.is(iterator[Symbol.asyncIterator](), iterator)
  t.deepEqual(await iterator.next(), { value: 5, done: false })
  t.deepEqual(await iterator.next(), { value: 6, done: false })
  t.deepEqual(await iterator.next(), { value: undefined, done: true })
})
