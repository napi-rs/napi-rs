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
): Promise<number[]> {
  const values: number[] = []
  for await (const value of new DelayedCounter(
    CONCURRENCY_YIELDS,
    CONCURRENCY_DELAY_MS,
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

  // A fixed millisecond budget cannot express "these ran concurrently". Each
  // `next()` costs a promise, a tokio wake-up and a threadsafe-function hop on
  // top of its `delay_ms` sleep, and on an emulated target that per-yield cost
  // dwarfs the sleeping and swings with whatever else the runner is doing: the
  // QEMU armv7 job has measured this exact loop anywhere from 132ms to 362ms
  // across CI runs with nothing in the async-generator path changing between
  // them. A budget tight enough to catch serialisation there is a budget the
  // slow end of that range trips on its own.
  //
  // So measure both shapes in the same process moments apart and assert on the
  // thing concurrency actually buys — the sleeps overlap instead of adding up —
  // which is a property of the ratio, not of the absolute numbers.

  // Warm the path first so the serial baseline is not paying one-time costs the
  // concurrent run would then get for free.
  await drainDelayedCounter('warmup', [])

  const serialOrder: string[] = []
  const serialStart = Date.now()
  const serial1 = await drainDelayedCounter('a', serialOrder)
  const serial2 = await drainDelayedCounter('b', serialOrder)
  const serialElapsed = Date.now() - serialStart

  const concurrentOrder: string[] = []
  const concurrentStart = Date.now()
  const [results1, results2] = await Promise.all([
    drainDelayedCounter('a', concurrentOrder),
    drainDelayedCounter('b', concurrentOrder),
  ])
  const concurrentElapsed = Date.now() - concurrentStart

  const expected = [0, 1, 2, 3, 4]
  t.deepEqual(serial1, expected)
  t.deepEqual(serial2, expected)
  t.deepEqual(results1, expected)
  t.deepEqual(results2, expected)

  // The serial baseline is what "not concurrent" looks like on this machine
  // right now: every value of the first counter lands before the first value of
  // the second.
  t.is(serialOrder.join(''), 'aaaaabbbbb')

  // Concurrently, the two counters make progress against each other, so the
  // second one yields before the first one is done. This alone catches a
  // generator that blocks the runtime, and it does not depend on the clock.
  t.true(
    concurrentOrder.indexOf('b') < concurrentOrder.lastIndexOf('a'),
    `Expected the two counters to interleave, got ${concurrentOrder.join('')}`,
  )

  const saved = serialElapsed - concurrentElapsed

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
  // waits ~165ms for its first poll. Nothing else on the path is at fault:
  // eight 50ms sleeps joined *inside* one task still finish in 51ms, and eight
  // spawned from within the runtime in 53ms; only the cross-thread wake-up is
  // lost. Two DelayedCounters therefore add up instead of overlapping, on this
  // branch and on `main` alike (serial 153ms vs concurrent 153ms for both).
  // Patching that single `cfg` in a local Tokio checkout takes the same
  // measurement to serial 184ms / concurrent 98ms.
  //
  // Lowering the threshold until this passes would mean shipping a
  // "concurrency" assertion that accepts fully serialised execution, so the
  // saving is asserted only where the executor can actually overlap timers.
  // The interleaving assertion above still runs on every target, including
  // this one, and still fails there if a generator blocks the runtime.
  if (process.env.WASI_TEST) {
    t.log(
      `WASI: sleeps do not overlap here (tokio-rs/tokio park_timeout is thread::sleep on wasm); serial ${serialElapsed}ms, concurrent ${concurrentElapsed}ms, saved ${saved}ms`,
    )
    return
  }

  // Running both counters serially sleeps 2 * (CONCURRENCY_YIELDS + 1) *
  // delay; running them concurrently sleeps half of that, so concurrency is
  // worth at least CONCURRENCY_YIELDS * CONCURRENCY_DELAY_MS of wall clock
  // however slow the per-yield machinery is. Requiring half of that leaves
  // room for a scheduling hiccup while still going to zero the moment the two
  // counters stop overlapping.
  const minimumSaving = (CONCURRENCY_YIELDS * CONCURRENCY_DELAY_MS) / 2
  t.true(
    saved > minimumSaving,
    `Expected concurrent execution to save more than ${minimumSaving}ms over the serial baseline, but serial took ${serialElapsed}ms and concurrent took ${concurrentElapsed}ms (saved ${saved}ms)`,
  )
})
