import test from 'ava'

import { Fib } from '../index'

test('should be able to stop a generator', (t) => {
  const fib = new Fib()
  const gen = fib[Symbol.iterator]
  t.is(typeof gen, 'function')
  const iterator = gen()
  t.deepEqual(iterator.next(), {
    done: false,
    value: 1,
  })
  iterator.next()
  iterator.next()
  iterator.next()
  iterator.next()
  t.deepEqual(iterator.next(), {
    done: false,
    value: 8,
  })
  t.deepEqual(iterator.return?.(), {
    done: true,
  })
  t.deepEqual(iterator.next(), {
    done: true,
  })
})

test('should be able to throw to generator', (t) => {
  const fib = new Fib()
  const gen = fib[Symbol.iterator]
  t.is(typeof gen, 'function')
  const iterator = gen()
  t.deepEqual(iterator.next(), {
    done: false,
    value: 1,
  })
  iterator.next()
  iterator.next()
  iterator.next()
  iterator.next()
  t.deepEqual(iterator.next(), {
    done: false,
    value: 8,
  })
  t.throws(() => iterator.throw!(new Error()))
  t.deepEqual(iterator.next(), {
    done: true,
  })
})
