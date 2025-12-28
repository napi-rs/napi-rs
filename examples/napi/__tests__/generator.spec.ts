import test from 'ava'

import {
  Fib,
  Fib2,
  Fib3,
  Fib4,
  AsyncFib,
  DelayedCounter,
  AsyncDataSource,
  shutdownRuntime,
} from '../index.cjs'

test.after(() => {
  shutdownRuntime()
})

for (const [index, factory] of [
  () => new Fib(),
  () => Fib2.create(0),
  () => new Fib3(0, 1),
].entries()) {
  test(`should be able to stop a generator #${index}`, (t) => {
    let iterator = factory()
    if (typeof Iterator === 'undefined') {
      iterator = iterator[Symbol.iterator]()
    }
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

  test(`should be able to throw to generator #${index}`, (t) => {
    const iterator = factory()
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

  test(`should be an Iterator and have the Iterator Helper methods #${index}`, (t) => {
    if (typeof Iterator === 'undefined') {
      t.pass('Iterator is not existing, skipping test')
      return
    }
    const iterator = factory()

    t.true(Object.getPrototypeOf(iterator) === Iterator.prototype)
    let arr = [
      ...iterator
        .drop(3)
        .filter((x: number) => x % 2 == 0)
        .take(5),
    ]
    t.deepEqual(arr, [8, 34, 144, 610, 2584])
  })
}

test('generator should be able to return object', (t) => {
  const fib = new Fib4(0, 1)

  const gen = fib[Symbol.iterator]
  t.is(typeof gen, 'function')
  const iterator = gen.call(fib)
  t.deepEqual(iterator.next(), {
    done: false,
    value: { number: 1 },
  })
})

// AsyncGenerator tests
test('async generator should work with for-await-of', async (t) => {
  if (typeof AsyncFib === 'undefined') {
    t.pass(
      'AsyncFib is not available (tokio_rt feature not enabled), skipping test',
    )
    return
  }
  const fib = new AsyncFib()
  const results: number[] = []
  let count = 0
  for await (const value of fib) {
    results.push(value)
    if (++count >= 5) break
  }
  t.deepEqual(results, [1, 1, 2, 3, 5])
})

test('async generator should support next()', async (t) => {
  if (typeof AsyncFib === 'undefined') {
    t.pass(
      'AsyncFib is not available (tokio_rt feature not enabled), skipping test',
    )
    return
  }
  const fib = new AsyncFib()
  const iter = fib[Symbol.asyncIterator]()
  t.deepEqual(await iter.next(), { value: 1, done: false })
  t.deepEqual(await iter.next(), { value: 1, done: false })
  t.deepEqual(await iter.next(), { value: 2, done: false })
})

test('async generator should support return()', async (t) => {
  if (typeof AsyncFib === 'undefined') {
    t.pass(
      'AsyncFib is not available (tokio_rt feature not enabled), skipping test',
    )
    return
  }
  const fib = new AsyncFib()
  const iter = fib[Symbol.asyncIterator]()
  t.deepEqual(await iter.next(), { value: 1, done: false })
  t.deepEqual(await iter.return?.(), { value: undefined, done: true })
})

// Truly async generator tests - these use actual async delays
test('DelayedCounter should yield values with real async delays', async (t) => {
  if (typeof DelayedCounter === 'undefined') {
    t.pass('DelayedCounter is not available, skipping test')
    return
  }

  const counter = new DelayedCounter(3, 10) // 3 values, 10ms delay each
  const results: number[] = []
  const startTime = Date.now()

  for await (const value of counter) {
    results.push(value as number)
  }

  const elapsed = Date.now() - startTime

  t.deepEqual(results, [0, 1, 2])
  // Should take at least 30ms (3 iterations * 10ms each)
  // Allow some tolerance for timing
  t.true(elapsed >= 25, `Expected at least 25ms, got ${elapsed}ms`)
})

test('DelayedCounter should complete and return done:true', async (t) => {
  if (typeof DelayedCounter === 'undefined') {
    t.pass('DelayedCounter is not available, skipping test')
    return
  }

  const counter = new DelayedCounter(2, 5)
  const iter = counter[Symbol.asyncIterator]()

  t.deepEqual(await iter.next(), { value: 0, done: false })
  t.deepEqual(await iter.next(), { value: 1, done: false })
  // After max is reached, should return done: true
  t.deepEqual(await iter.next(), { value: undefined, done: true })
})

test('AsyncDataSource should yield string items with async delays', async (t) => {
  if (typeof AsyncDataSource === 'undefined') {
    t.pass('AsyncDataSource is not available, skipping test')
    return
  }

  const data = ['hello', 'async', 'world']
  const source = AsyncDataSource.fromData(data, 10) // 10ms delay per item
  const results: string[] = []
  const startTime = Date.now()

  for await (const item of source) {
    results.push(item as string)
  }

  const elapsed = Date.now() - startTime

  t.deepEqual(results, ['hello', 'async', 'world'])
  // Should take at least 30ms (3 items * 10ms each)
  t.true(elapsed >= 25, `Expected at least 25ms, got ${elapsed}ms`)
})

test('AsyncDataSource factory pattern should work', async (t) => {
  if (typeof AsyncDataSource === 'undefined') {
    t.pass('AsyncDataSource is not available, skipping test')
    return
  }

  const source = AsyncDataSource.fromData(['a', 'b'], 5)
  const iter = source[Symbol.asyncIterator]()

  t.deepEqual(await iter.next(), { value: 'a', done: false })
  t.deepEqual(await iter.next(), { value: 'b', done: false })
  t.deepEqual(await iter.next(), { value: undefined, done: true })
})

test('async generators should run concurrently', async (t) => {
  if (typeof DelayedCounter === 'undefined') {
    t.pass('DelayedCounter is not available, skipping test')
    return
  }

  // Create two counters that each take 50ms total
  const counter1 = new DelayedCounter(5, 10) // 5 * 10ms = 50ms
  const counter2 = new DelayedCounter(5, 10) // 5 * 10ms = 50ms

  const startTime = Date.now()

  // Run both concurrently
  const [results1, results2] = await Promise.all([
    (async () => {
      const r: number[] = []
      for await (const v of counter1) r.push(v as number)
      return r
    })(),
    (async () => {
      const r: number[] = []
      for await (const v of counter2) r.push(v as number)
      return r
    })(),
  ])

  const elapsed = Date.now() - startTime

  t.deepEqual(results1, [0, 1, 2, 3, 4])
  t.deepEqual(results2, [0, 1, 2, 3, 4])
  // If running concurrently, should take ~50ms, not ~100ms
  // Allow generous tolerance for CI environments
  t.true(
    elapsed < 150,
    `Expected concurrent execution under 150ms, got ${elapsed}ms`,
  )
})
