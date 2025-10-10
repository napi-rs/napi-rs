import { test, before, after, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert'

import { Fib, Fib2, Fib3, Fib4, shutdownRuntime } from '../index.cjs'

after(() => {
  shutdownRuntime()
})

for (const [index, factory] of [
  () => new Fib(),
  () => Fib2.create(0),
  () => new Fib3(0, 1),
].entries()) {
  test(`should be able to stop a generator #${index}`, () => {
    let iterator = factory()
    if (typeof Iterator === 'undefined') {
      iterator = iterator[Symbol.iterator]()
    }
    assert.deepStrictEqual(iterator.next(), {
      done: false,
      value: 1,
    })
    iterator.next()
    iterator.next()
    iterator.next()
    iterator.next()
    assert.deepStrictEqual(iterator.next(), {
      done: false,
      value: 8,
    })
    assert.deepStrictEqual(iterator.return?.(), {
      done: true,
    })
    assert.deepStrictEqual(iterator.next(), {
      done: true,
    })
  })

  test(`should be able to throw to generator #${index}`, () => {
    const iterator = factory()
    assert.deepStrictEqual(iterator.next(), {
      done: false,
      value: 1,
    })
    iterator.next()
    iterator.next()
    iterator.next()
    iterator.next()
    assert.deepStrictEqual(iterator.next(), {
      done: false,
      value: 8,
    })
    assert.throws(() => iterator.throw!(new Error()))
    assert.deepStrictEqual(iterator.next(), {
      done: true,
    })
  })

  test(`should be an Iterator and have the Iterator Helper methods #${index}`, () => {
    if (typeof Iterator === 'undefined') {
      t.pass('Iterator is not existing, skipping test')
      return
    }
    const iterator = factory()

    assert.ok(Object.getPrototypeOf(iterator) === Iterator.prototype)
    let arr = [
      ...iterator
        .drop(3)
        .filter((x: number) => x % 2 == 0)
        .take(5),
    ]
    assert.deepStrictEqual(arr, [8, 34, 144, 610, 2584])
  })
}

test('generator should be able to return object', () => {
  const fib = new Fib4(0, 1)

  const gen = fib[Symbol.iterator]
  assert.strictEqual(typeof gen, 'function')
  const iterator = gen.call(fib)
  assert.deepStrictEqual(iterator.next(), {
    done: false,
    value: { number: 1 },
  })
})
