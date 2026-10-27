import test from 'ava'

import {
  NotWritableClass,
  StaticPropertyFlags,
  shutdownRuntime,
} from '../index.cjs'

test.after(() => {
  shutdownRuntime()
})

test('Not Writable Class', (t) => {
  const obj = new NotWritableClass('1')
  t.throws(() => {
    obj.name = '2'
  })
  obj.setName('2')
  t.is(obj.name, '2')
  t.throws(() => {
    obj.setName = () => {}
  })
})

test('static members keep their default descriptor and honour written flags', (t) => {
  const descriptor = (key: string) =>
    Object.getOwnPropertyDescriptor(StaticPropertyFlags, key)
  t.like(descriptor('defaultFlags'), {
    writable: false,
    enumerable: false,
    configurable: false,
  })
  t.like(descriptor('writableConfigurable'), {
    writable: true,
    enumerable: false,
    configurable: true,
  })
  t.like(descriptor('enumerableOnly'), {
    writable: false,
    enumerable: true,
    configurable: false,
  })
  t.like(descriptor('allOff'), {
    writable: false,
    enumerable: false,
    configurable: false,
  })
  t.like(descriptor('create'), {
    writable: true,
    enumerable: false,
    configurable: false,
  })
  t.deepEqual(Object.keys(StaticPropertyFlags), ['enumerableOnly'])
  t.like(
    Object.getOwnPropertyDescriptor(
      StaticPropertyFlags.prototype,
      'instanceNotWritable',
    ),
    { writable: false, enumerable: true, configurable: true },
  )
  t.is(StaticPropertyFlags.defaultFlags(), 1)
  t.is(StaticPropertyFlags.writableConfigurable(), 2)
  t.is(StaticPropertyFlags.enumerableOnly(), 3)
  t.is(StaticPropertyFlags.allOff(), 4)
  const instance = StaticPropertyFlags.create()
  t.true(instance instanceof StaticPropertyFlags)
  t.is(instance.instanceNotWritable(), 5)
})
