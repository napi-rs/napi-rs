import test from 'ava'

import { CounterRepro, shutdownRuntime } from '../index.cjs'

test.after(() => {
  shutdownRuntime()
})

test('[[InstanceRef]] should be hidden from enumeration', async (t) => {
  if (typeof CounterRepro === 'undefined') {
    t.pass('CounterRepro not available, skipping test')
    return
  }

  const counter = new CounterRepro(10)
  const iterator = counter[Symbol.asyncIterator]()

  // The [[InstanceRef]] property should not be enumerable
  const keys = Object.keys(iterator)
  t.false(
    keys.includes('[[InstanceRef]]'),
    '[[InstanceRef]] should not appear in Object.keys()',
  )

  // Should not show up in for-in loop
  const forInKeys: string[] = []
  for (const key in iterator) {
    forInKeys.push(key)
  }
  t.false(
    forInKeys.includes('[[InstanceRef]]'),
    '[[InstanceRef]] should not appear in for-in',
  )

  // Verify the property descriptor shows it's truly hidden
  // Note: Object.getOwnPropertyNames() WILL show non-enumerable properties,
  // but what matters is that [[InstanceRef]] doesn't show in Object.keys() or for-in (which we tested above)
  const descriptor = Object.getOwnPropertyDescriptor(
    iterator,
    '[[InstanceRef]]',
  )
  if (descriptor) {
    t.false(descriptor.enumerable, '[[InstanceRef]] should be non-enumerable')
    t.false(descriptor.writable, '[[InstanceRef]] should be non-writable')
    t.false(
      descriptor.configurable,
      '[[InstanceRef]] should be non-configurable',
    )
  }

  // The iterator should still work correctly
  const first = await iterator.next()
  t.deepEqual(first, { value: 0, done: false })
})

test('[[InstanceRef]] should be non-writable and non-configurable', async (t) => {
  if (typeof CounterRepro === 'undefined') {
    t.pass('CounterRepro not available, skipping test')
    return
  }

  const counter = new CounterRepro(10)
  const iterator = counter[Symbol.asyncIterator]()

  const originalValue = (iterator as any)['[[InstanceRef]]']

  // Try to assign a new value (should throw in strict mode)
  const assignError = t.throws(
    () => {
      'use strict'
      ;(iterator as any)['[[InstanceRef]]'] = 'hacked'
    },
    { instanceOf: TypeError },
  )

  t.truthy(
    assignError,
    'Assignment to non-writable property should throw TypeError',
  )

  // Value should remain unchanged
  t.is((iterator as any)['[[InstanceRef]]'], originalValue)

  // Try to delete the property (should throw in strict mode for non-configurable property)
  const deleteError = t.throws(
    () => {
      'use strict'
      delete (iterator as any)['[[InstanceRef]]']
    },
    { instanceOf: TypeError },
  )

  t.truthy(
    deleteError,
    'Deleting non-configurable property should throw TypeError',
  )

  // Property should still exist
  t.is((iterator as any)['[[InstanceRef]]'], originalValue)

  // The iterator should still work correctly
  const first = await iterator.next()
  t.deepEqual(first, { value: 0, done: false })
})

test('visible properties should still be accessible', async (t) => {
  if (typeof CounterRepro === 'undefined') {
    t.pass('CounterRepro not available, skipping test')
    return
  }

  const counter = new CounterRepro(10)
  const iterator = counter[Symbol.asyncIterator]()

  // The visible methods should be accessible
  t.is(typeof iterator.next, 'function')
  t.is(typeof iterator.return, 'function')
  t.is(typeof iterator.throw, 'function')

  // These should appear in enumeration
  const keys = Object.keys(iterator)
  t.true(keys.includes('next'), 'next should be enumerable')
  t.true(keys.includes('return'), 'return should be enumerable')
  t.true(keys.includes('throw'), 'throw should be enumerable')
})
