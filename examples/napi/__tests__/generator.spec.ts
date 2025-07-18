import test from 'ava'

import { Fib, Fib2, Fib3, shutdownRuntime } from '../index.cjs'

test.after(() => {
  shutdownRuntime()
})

for (const [index, factory] of [
  () => new Fib(),
  () => Fib2.create(0),
  () => new Fib3(0, 1),
].entries()) {
  test(`should be able to stop a generator #${index}`, (t) => {
    const iterator = factory()
    // TODO remove these ignores when using the es2025 typescript target
    // @ts-ignore
    t.deepEqual(iterator.next(), {
      done: false,
      value: 1,
    })
    // @ts-ignore
    iterator.next()
    // @ts-ignore
    iterator.next()
    // @ts-ignore
    iterator.next()
    // @ts-ignore
    iterator.next()
    // @ts-ignore
    t.deepEqual(iterator.next(), {
      done: false,
      value: 8,
    })
    // @ts-ignore
    t.deepEqual(iterator.return?.(), {
      done: true,
    })
    // @ts-ignore
    t.deepEqual(iterator.next(), {
      done: true,
    })
  })

  test(`should be able to throw to generator #${index}`, (t) => {
    const iterator = factory()
    // @ts-ignore
    t.deepEqual(iterator.next(), {
      done: false,
      value: 1,
    })
    // @ts-ignore
    iterator.next()
    // @ts-ignore
    iterator.next()
    // @ts-ignore
    iterator.next()
    // @ts-ignore
    iterator.next()
    // @ts-ignore
    t.deepEqual(iterator.next(), {
      done: false,
      value: 8,
    })
    // @ts-ignore
    t.throws(() => iterator.throw!(new Error()))
    // @ts-ignore
    t.deepEqual(iterator.next(), {
      done: true,
    })
  })

  test(`should be an Iterator and have the Iterator Helper methods #${index}`, (t) => {
    const iterator = factory()

    // @ts-ignore
    t.true(Object.getPrototypeOf(iterator) === Iterator.prototype)
    let arr = [
      ...iterator
        // @ts-ignore
        .drop(3)
        .filter((x: number) => x % 2 == 0)
        .take(5),
    ]
    t.deepEqual(arr, [8, 34, 144, 610, 2584])
  })
}
