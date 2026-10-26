import test from 'ava'

import {
  Fib,
  Fib2,
  Fib3,
  Fib4,
  AsyncFib,
  DelayedCounter,
  SleepOverlapProbe,
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

    t.true(iterator instanceof Iterator)
    t.not(Object.getPrototypeOf(iterator), Iterator.prototype)
    t.true(
      Object.getPrototypeOf(Object.getPrototypeOf(iterator)) ===
        Iterator.prototype,
    )
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
  t.is(iterator, fib)
  t.deepEqual(iterator.next(), {
    done: false,
    value: { number: 1 },
  })
})

test('generator should preserve class methods while inheriting Iterator helpers', (t) => {
  const fib = new Fib4(0, 1)

  t.is(typeof fib.toJSON, 'function')
  t.deepEqual(fib.toJSON(), [0, 1])
  t.is(JSON.stringify(fib), '[0,1]')

  if (typeof Iterator !== 'undefined') {
    t.true(fib instanceof Iterator)
    t.true(Object.getPrototypeOf(fib) === Fib4.prototype)
    t.true(Object.getPrototypeOf(Fib4.prototype) === Iterator.prototype)
    t.is(typeof fib.map, 'function')
  }
})

test('generator subclasses should preserve the prototype chain', (t) => {
  class Child extends Fib4 {}

  Object.freeze(Child.prototype)

  const child = new Child(0, 1)

  t.is(typeof child.toJSON, 'function')
  t.deepEqual(child.toJSON(), [0, 1])
  t.is(JSON.stringify(child), '[0,1]')

  if (typeof Iterator !== 'undefined') {
    t.true(child instanceof Iterator)
    t.true(Object.getPrototypeOf(child) === Child.prototype)
    t.true(Object.getPrototypeOf(Child.prototype) === Fib4.prototype)
    t.true(Object.getPrototypeOf(Fib4.prototype) === Iterator.prototype)
    t.is(typeof child.map, 'function')
  }
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

test('async generator should support throw()', async (t) => {
  if (typeof AsyncFib === 'undefined') {
    t.pass(
      'AsyncFib is not available (tokio_rt feature not enabled), skipping test',
    )
    return
  }
  const fib = new AsyncFib()
  const iter = fib[Symbol.asyncIterator]()
  t.deepEqual(await iter.next(), { value: 1, done: false })
  // throw() should reject with the error passed to it
  await t.throwsAsync(() => iter.throw!(new Error('test error')))
})

test('async generator throw() rejects with the identical value', async (t) => {
  if (typeof AsyncFib === 'undefined') {
    t.pass(
      'AsyncFib is not available (tokio_rt feature not enabled), skipping test',
    )
    return
  }
  // `throw()` accepts any value. Capturing it used to go through
  // `napi_create_reference`, which rejects primitives, so the thrown value was
  // replaced by a reference-creation failure. Assert identity, not the message:
  // a synthesized `Error` carrying the same message would pass a message check.
  const thrown: unknown[] = [
    'boom',
    42,
    null,
    undefined,
    false,
    7n,
    Symbol('marker'),
    { tag: 'marker' },
    [1, 2, 3],
    new TypeError('a real error'),
  ]
  for (const value of thrown) {
    const fib = new AsyncFib()
    const iter = fib[Symbol.asyncIterator]()
    t.deepEqual(await iter.next(), { value: 1, done: false })
    const settled = await iter.throw!(value).then(
      (resolved) => ({ rejected: false, value: resolved as unknown }),
      (reason: unknown) => ({ rejected: true, value: reason }),
    )
    t.true(settled.rejected, `${String(value)} should reject`)
    t.is(settled.value, value, `${String(value)} should reject with itself`)
  }
})

// Truly async generator tests - these use actual async delays
test('DelayedCounter should yield values with real async delays', async (t) => {
  if (typeof DelayedCounter === 'undefined') {
    t.pass(
      'DelayedCounter is not available (tokio_rt feature not enabled), skipping test',
    )
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
    t.pass(
      'DelayedCounter is not available (tokio_rt feature not enabled), skipping test',
    )
    return
  }

  const counter = new DelayedCounter(2, 5)
  const iter = counter[Symbol.asyncIterator]()

  t.deepEqual(await iter.next(), { value: 0, done: false })
  t.deepEqual(await iter.next(), { value: 1, done: false })
  // After max is reached, should return done: true
  t.deepEqual(await iter.next(), { value: undefined, done: true })
  // Verify idempotency: subsequent calls should continue returning done: true
  t.deepEqual(await iter.next(), { value: undefined, done: true })
})

test('AsyncDataSource should yield string items with async delays', async (t) => {
  if (typeof AsyncDataSource === 'undefined') {
    t.pass(
      'AsyncDataSource is not available (tokio_rt feature not enabled), skipping test',
    )
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
    t.pass(
      'AsyncDataSource is not available (tokio_rt feature not enabled), skipping test',
    )
    return
  }

  const source = AsyncDataSource.fromData(['a', 'b'], 5)
  const iter = source[Symbol.asyncIterator]()

  t.deepEqual(await iter.next(), { value: 'a', done: false })
  t.deepEqual(await iter.next(), { value: 'b', done: false })
  t.deepEqual(await iter.next(), { value: undefined, done: true })
})

const CONCURRENCY_YIELDS = 5
const CONCURRENCY_DELAY_MS = 10

async function drainDelayedCounter(
  label: string,
  order: string[],
  probe: SleepOverlapProbe,
): Promise<number[]> {
  const values: number[] = []
  for await (const value of DelayedCounter.withProbe(
    CONCURRENCY_YIELDS,
    CONCURRENCY_DELAY_MS,
    probe,
  )) {
    order.push(label)
    values.push(value)
  }
  return values
}

test('async generators should run concurrently', async (t) => {
  if (typeof DelayedCounter === 'undefined') {
    t.pass(
      'DelayedCounter is not available (tokio_rt feature not enabled), skipping test',
    )
    return
  }

  // Wall-clock budgets cannot express "these ran concurrently": one runner
  // stall during the concurrent run eats the whole saving. So each counter
  // reports its sleeps to a probe, and the test asserts on how many sleeps were
  // pending at the same time, which does not depend on how fast the machine is.

  const serialProbe = new SleepOverlapProbe()
  const serialOrder: string[] = []
  const serial1 = await drainDelayedCounter('a', serialOrder, serialProbe)
  const serial2 = await drainDelayedCounter('b', serialOrder, serialProbe)

  const concurrentProbe = new SleepOverlapProbe()
  const concurrentOrder: string[] = []
  const [results1, results2] = await Promise.all([
    drainDelayedCounter('a', concurrentOrder, concurrentProbe),
    drainDelayedCounter('b', concurrentOrder, concurrentProbe),
  ])

  const expected = [0, 1, 2, 3, 4]
  t.deepEqual(serial1, expected)
  t.deepEqual(serial2, expected)
  t.deepEqual(results1, expected)
  t.deepEqual(results2, expected)

  // The serial baseline is what "not concurrent" looks like: every value of the
  // first counter lands before the first value of the second, and no two sleeps
  // are ever pending together.
  t.is(serialOrder.join(''), 'aaaaabbbbb')
  t.is(serialProbe.maxInFlight, 1)

  // Concurrently, the two counters make progress against each other, so the
  // second one yields before the first one is done. This alone catches a
  // generator that blocks the runtime, and it does not depend on the clock.
  t.true(
    concurrentOrder.indexOf('b') < concurrentOrder.lastIndexOf('a'),
    `Expected the two counters to interleave, got ${concurrentOrder.join('')}`,
  )

  // The remaining claim — that the sleeps overlap rather than merely
  // interleaving — is not true on the WASI lane, and the reason is below
  // napi-rs, so asserting it there would only be asserting a Tokio bug.
  //
  // Tokio parks a worker on its next timer deadline through
  // `runtime::park::Inner::park_timeout`, which is
  //
  //     #[cfg(all(target_family = "wasm", not(target_feature = "atomics")))]
  //     { std::thread::sleep(dur) }   // "Wasm without atomics doesn't have threads"
  //
  // and `target_feature = "atomics"` is never set on `wasm32-wasip1-threads`:
  // it is an *unstable* target feature, and rustc does not surface unstable
  // target features to `cfg` even when the target compiles with them. So on
  // the one wasm target that does have threads, Tokio's timer park is an
  // uninterruptible sleep. `available_parallelism()` is 1 under Node's WASI,
  // so the single worker owns the time driver, and a task injected from the
  // JavaScript thread is not polled until whatever sleep is already in flight
  // runs out — measured on this lane, a task submitted 30ms into a 200ms sleep
  // waits ~165ms for its first poll. Two DelayedCounters therefore add up
  // instead of overlapping there.
  //
  // The interleaving assertion above still runs on every target, including
  // this one, and still fails there if a generator blocks the runtime.
  if (process.env.WASI_TEST) {
    t.log(
      `WASI: sleeps do not overlap here (tokio-rs/tokio park_timeout is thread::sleep on wasm); at most ${concurrentProbe.maxInFlight} pending at once`,
    )
    return
  }

  // Both counters' sleeps were pending at the same moment at least once.
  t.true(
    concurrentProbe.maxInFlight >= 2,
    `Expected the two counters' sleeps to overlap, but at most ${concurrentProbe.maxInFlight} was pending at once`,
  )
})
