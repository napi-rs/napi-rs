import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import test from 'ava'

import {
  Fib,
  Fib2,
  Fib3,
  Fib4,
  ComplexTypeGenerator,
  GeneratorLifecycleProbe,
  ReentrantGenerator,
  AsyncFib,
  AsyncComplexTypeGenerator,
  AsyncReentrantGenerator,
  AsyncGeneratorSetupFailure,
  AsyncIteratorAdmissionProbe,
  DelayedCounter,
  createDelayedCounterPair,
  AsyncDataSource,
  shutdownRuntime,
  throwAsyncError,
} from '../index.cjs'

const __dirname = dirname(fileURLToPath(import.meta.url))

async function waitFor(
  predicate: () => boolean,
  message: string,
): Promise<void> {
  const deadline = Date.now() + 5_000
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error(message)
    }
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('Expected Promise to reject')
}

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
      value: undefined,
    })
    t.deepEqual(iterator.next(), {
      done: true,
      value: undefined,
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
      value: undefined,
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

test('generator supports compound associated types through public N-API', (t) => {
  const iterator = new ComplexTypeGenerator()

  t.deepEqual(iterator.next({ first: 2, second: 3 }), {
    done: false,
    value: [0, 5],
  })
  t.deepEqual(iterator.return?.(['complete', 7]), {
    done: true,
    value: ['complete', 7],
  })
})

test('generator persists natural completion and invokes return hook once', (t) => {
  const naturallyCompleted = new GeneratorLifecycleProbe()

  t.deepEqual(naturallyCompleted.next(), { done: false, value: 1 })
  t.deepEqual(naturallyCompleted.next(), { done: true, value: undefined })
  t.is(naturallyCompleted.nextCalls, 2)
  t.deepEqual(naturallyCompleted.next(), { done: true, value: undefined })
  t.is(naturallyCompleted.nextCalls, 2)
  t.deepEqual(naturallyCompleted.return!('after'), {
    done: true,
    value: 'after',
  })
  t.is(naturallyCompleted.completeCalls, 0)

  const returned = new GeneratorLifecycleProbe()
  t.deepEqual(returned.return!('first'), {
    done: true,
    value: 'first:1',
  })
  t.is(returned.completeCalls, 1)
  t.deepEqual(returned.return!('second'), {
    done: true,
    value: 'second',
  })
  t.is(returned.completeCalls, 1)

  const stateDescriptor = Object.getOwnPropertyDescriptor(
    returned,
    '[[GeneratorState]]',
  )
  t.false(stateDescriptor?.writable)
  t.false(stateDescriptor?.enumerable)
  t.false(stateDescriptor?.configurable)
  t.false(Reflect.set(returned, '[[GeneratorState]]', false))
  t.throws(() => {
    Object.defineProperty(returned, '[[GeneratorState]]', { value: false })
  })
  t.deepEqual(returned.return!('third'), {
    done: true,
    value: 'third',
  })
  t.is(returned.completeCalls, 1)
})

test('iterator installation failures reject async results', (t) => {
  const result = spawnSync(
    process.execPath,
    [join(__dirname, 'iterator-installation-failure.js')],
    {
      encoding: 'utf8',
      env: process.env,
      timeout: 30_000,
    },
  )
  const output = `${result.stdout}\n${result.stderr}`
  t.is(result.error, undefined, result.error?.stack)
  t.is(result.signal, null, output)
  t.is(result.status, 0, output)
})

test('generator rejects a reentrant mutable borrow and remains usable', (t) => {
  const iterator = new ReentrantGenerator()
  let nestedError: unknown

  t.deepEqual(
    iterator.next(() => {
      try {
        iterator.next()
      } catch (error) {
        nestedError = error
      }
    }),
    { done: false, value: 1 },
  )
  t.regex(String(nestedError), /cannot be borrowed mutably/)
  t.deepEqual(iterator.next(), { done: false, value: 2 })
})

test('generator rejects invalid next input without advancing', (t) => {
  const iterator = new Fib4(0, 1)

  t.throws(() => iterator.next(Symbol('invalid') as never), {
    message: /Failed to convert napi value Symbol/,
  })
  t.deepEqual(iterator.next(), { done: false, value: { number: 1 } })
  t.deepEqual(iterator.next(), { done: false, value: { number: 1 } })
})

test('generator rejects a forged receiver without advancing', (t) => {
  const iterator = new Fib4(0, 1)
  const next = iterator.next
  const forgedReceiver = Object.defineProperty({}, '[[GeneratorState]]', {
    value: false,
    writable: true,
  })

  t.throws(() => next.call(forgedReceiver, 5), {
    message: /incompatible receiver/,
  })
  t.deepEqual(iterator.toJSON(), [0, 1])
  t.deepEqual(iterator.next(), { done: false, value: { number: 1 } })
})

test('generator rejects explicit undefined return without closing', (t) => {
  const iterator = new GeneratorLifecycleProbe()

  t.throws(() => iterator.return!(undefined as never), {
    message: /Failed to convert JavaScript value `Undefined`/,
  })
  t.is(iterator.completeCalls, 0)
  t.deepEqual(iterator.next(), { done: false, value: 1 })
})

test('generator default throw preserves arbitrary values and closes', (t) => {
  for (const value of [
    { reason: 'object rejection' },
    42,
    'string rejection',
    undefined,
    null,
    Symbol('symbol rejection'),
  ]) {
    const iterator = new Fib()
    let rejection: unknown
    try {
      iterator.throw!(value)
      t.fail('throw() must throw')
    } catch (error) {
      rejection = error
    }
    t.is(rejection, value)
    t.deepEqual(iterator.next(), { done: true, value: undefined })
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

test('returned async generator should itself be async iterable', async (t) => {
  const iterator = new AsyncFib()[Symbol.asyncIterator]()
  const values: number[] = []

  t.is(iterator[Symbol.asyncIterator](), iterator)
  for await (const value of iterator) {
    values.push(value)
    if (values.length === 3) {
      break
    }
  }
  t.deepEqual(values, [1, 1, 2])
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

test('async generator queues return behind pending next and remains closed', async (t) => {
  const iterator = new DelayedCounter(3, 25)[Symbol.asyncIterator]()
  const settlementOrder: string[] = []
  const next = iterator.next().then((result) => {
    settlementOrder.push('next')
    return result
  })
  const returned = iterator.return!('stop').then((result) => {
    settlementOrder.push('return')
    return result
  })

  t.deepEqual(await next, { value: 0, done: false })
  t.deepEqual(await returned, { value: 'stop', done: true })
  t.deepEqual(settlementOrder, ['next', 'return'])
  t.deepEqual(await iterator.next(), { value: undefined, done: true })
})

test('async generator preserves each return value after closing', async (t) => {
  const iterator = new DelayedCounter(3, 0)[Symbol.asyncIterator]()

  t.deepEqual(await iterator.return!('first'), {
    value: 'first',
    done: true,
  })
  t.deepEqual(await iterator.return!('second'), {
    value: 'second',
    done: true,
  })
})

test('queued async returns recover terminal ownership after conversion failures', async (t) => {
  const succeeding = new AsyncComplexTypeGenerator()[Symbol.asyncIterator]()
  const failed = succeeding.return!(Symbol('invalid') as never)
  const returned = succeeding.return!([8, 13])
  const skipped = succeeding.next({ first: 2, second: 3 })

  await t.throwsAsync(failed, {
    message: /Failed to get Array length/,
  })
  t.deepEqual(await returned, { value: [8, 13], done: true })
  t.deepEqual(await skipped, { value: undefined, done: true })

  const recovering = new AsyncComplexTypeGenerator()[Symbol.asyncIterator]()
  const firstFailure = recovering.return!(Symbol('first') as never)
  const secondFailure = recovering.return!(Symbol('second') as never)
  const follower = recovering.next({ first: 2, second: 3 })

  await t.throwsAsync(firstFailure, {
    message: /Failed to get Array length/,
  })
  await t.throwsAsync(secondFailure, {
    message: /Failed to get Array length/,
  })
  t.deepEqual(await follower, { value: [0, 5], done: false })
  t.deepEqual(await recovering.next(), { value: [5, 6], done: false })
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

test('async generator default throw preserves arbitrary rejection values', async (t) => {
  let messageReads = 0
  const throwingMessage = Object.defineProperty({}, 'message', {
    get() {
      messageReads++
      throw new Error('rejection message must not be read')
    },
  })
  const values = [
    { reason: 'object rejection' },
    throwingMessage,
    42,
    'string rejection',
    undefined,
    null,
    Symbol('symbol rejection'),
  ]

  for (const value of values) {
    const iterator = new AsyncFib()[Symbol.asyncIterator]()
    let rejection: unknown
    try {
      await iterator.throw!(value)
      t.fail('throw() must reject')
    } catch (error) {
      rejection = error
    }
    t.is(rejection, value)
  }
  t.is(messageReads, 0)
})

test('async generator skipped throw preserves value without coercion', async (t) => {
  let coercions = 0
  const value = {
    [Symbol.toPrimitive]() {
      coercions++
      return 'coerced skipped throw'
    },
  }
  const iterator = new AsyncFib()[Symbol.asyncIterator]()
  await iterator.return!()

  const rejection = await rejectionOf(iterator.throw!(value))
  t.is(rejection, value)
  t.is(coercions, 0)
})

test('async generator queues throw behind pending next and closes on rejection', async (t) => {
  const iterator = new DelayedCounter(3, 25)[Symbol.asyncIterator]()
  const thrown = new Error('queued throw')
  const settlementOrder: string[] = []
  const next = iterator.next().then((result) => {
    settlementOrder.push('next')
    return result
  })
  const throwing = iterator.throw!(thrown).catch((error) => {
    settlementOrder.push('throw')
    throw error
  })

  t.deepEqual(await next, { value: 0, done: false })
  const rejection = await t.throwsAsync(throwing)
  t.is(rejection, thrown)
  t.deepEqual(settlementOrder, ['next', 'throw'])
  t.deepEqual(await iterator.next(), { value: undefined, done: true })
})

test('async generator supports compound associated types through public N-API', async (t) => {
  const iterator = new AsyncComplexTypeGenerator()[Symbol.asyncIterator]()

  t.deepEqual(await iterator.next({ first: 2, second: 3 }), {
    done: false,
    value: [0, 5],
  })
  t.deepEqual(await iterator.return?.([8, 13]), {
    done: true,
    value: [8, 13],
  })
})

test('async return keeps priority over next reentered by conversion', async (t) => {
  const iterator = new AsyncComplexTypeGenerator()[Symbol.asyncIterator]()
  let nested: Promise<IteratorResult<number[]>> | undefined
  const value = [8, 13] as [number, number]
  Object.defineProperty(value, 0, {
    get() {
      nested = iterator.next({ first: 2, second: 3 })
      return 8
    },
  })

  const returned = iterator.return!(value)

  t.is(nested, undefined)
  t.deepEqual(await returned, { done: true, value: [8, 13] })
  t.deepEqual(await nested!, { done: true, value: undefined })
})

test('failed async return conversion reopens its terminal reservation', async (t) => {
  const iterator = new AsyncComplexTypeGenerator()[Symbol.asyncIterator]()
  const marker = { reason: 'return conversion failed' }
  let nested: Promise<IteratorResult<number[]>> | undefined
  const value = [8, 13] as [number, number]
  Object.defineProperty(value, 0, {
    get() {
      nested = iterator.next({ first: 2, second: 3 })
      throw marker
    },
  })

  const returned = iterator.return!(value)

  t.is(nested, undefined)
  t.is(await rejectionOf(returned), marker)
  t.deepEqual(await nested!, { done: false, value: [0, 5] })
  t.deepEqual(await iterator.next(), { done: false, value: [5, 6] })
})

test('async generator queues a reentrant next request and remains usable', async (t) => {
  const iterator = new AsyncReentrantGenerator()[Symbol.asyncIterator]()
  let nestedPromise: Promise<IteratorResult<number>> | undefined

  t.deepEqual(
    await iterator.next(() => {
      nestedPromise = iterator.next()
    }),
    { done: false, value: 1 },
  )
  t.deepEqual(await nestedPromise!, { done: false, value: 2 })
  t.deepEqual(await iterator.next(), { done: false, value: 3 })
})

test('async generator admits concurrent next hooks in FIFO order', async (t) => {
  const probe = new AsyncIteratorAdmissionProbe(['value', 'value', 'value'])
  const iterator = probe[Symbol.asyncIterator]()
  const requests = [iterator.next(), iterator.next(), iterator.next()]

  await waitFor(
    () => probe.events.length === 1,
    'first async iterator next hook was not admitted',
  )
  t.deepEqual(probe.events, ['next:0:value'])

  for (let index = 0; index < requests.length; index++) {
    probe.release(1)
    t.deepEqual(await requests[index], { done: false, value: index })
    if (index + 1 < requests.length) {
      await waitFor(
        () => probe.events.length === index + 2,
        `async iterator next hook ${index + 1} was not admitted`,
      )
      t.deepEqual(
        probe.events,
        Array.from(
          { length: index + 2 },
          (_, eventIndex) => `next:${eventIndex}:value`,
        ),
      )
    }
  }
})

test('async generator admits return only after a pending next settles', async (t) => {
  const probe = new AsyncIteratorAdmissionProbe(['value'])
  const iterator = probe[Symbol.asyncIterator]()
  const next = iterator.next()
  const returned = iterator.return!('stop')

  await waitFor(
    () => probe.events.length === 1,
    'pending next hook was not admitted before return',
  )
  t.deepEqual(probe.events, ['next:0:value'])

  probe.release(1)
  t.deepEqual(await next, { done: false, value: 0 })
  await waitFor(
    () => probe.events.length === 2,
    'return hook was not admitted after next settled',
  )
  t.deepEqual(probe.events, ['next:0:value', 'return:stop'])
  t.deepEqual(await returned, { done: true, value: 'stop' })
})

test('async generator admits throw only after a pending next settles', async (t) => {
  const probe = new AsyncIteratorAdmissionProbe(['value'])
  const iterator = probe[Symbol.asyncIterator]()
  const thrown = new Error('admitted throw')
  const next = iterator.next()
  const throwing = iterator.throw!(thrown)

  await waitFor(
    () => probe.events.length === 1,
    'pending next hook was not admitted before throw',
  )
  t.deepEqual(probe.events, ['next:0:value'])

  probe.release(1)
  t.deepEqual(await next, { done: false, value: 0 })
  const rejection = await t.throwsAsync(throwing)
  t.is(rejection, thrown)
  t.deepEqual(probe.events, ['next:0:value', 'throw'])
})

function poisonObjectPrototypeSetters(keys: PropertyKey[]) {
  const originalDescriptors = new Map(
    keys.map((key) => [
      key,
      Object.getOwnPropertyDescriptor(Object.prototype, key),
    ]),
  )
  const setterCalls: PropertyKey[] = []

  for (const key of keys) {
    Object.defineProperty(Object.prototype, key, {
      configurable: true,
      set() {
        setterCalls.push(key)
        throw new Error(`inherited ${String(key)} setter must not run`)
      },
    })
  }

  return {
    setterCalls,
    restore() {
      for (const key of keys) {
        const descriptor = originalDescriptors.get(key)
        if (descriptor) {
          Object.defineProperty(Object.prototype, key, descriptor)
        } else {
          Reflect.deleteProperty(Object.prototype, key)
        }
      }
    },
  }
}

test.serial('generator installation ignores inherited setters', (t) => {
  const poisoned = poisonObjectPrototypeSetters([
    Symbol.iterator,
    Symbol.asyncIterator,
    'next',
    'return',
    'throw',
  ])

  try {
    const sync = new Fib4(0, 1)
    const syncFactoryDescriptor = Object.getOwnPropertyDescriptor(
      sync,
      Symbol.iterator,
    )
    t.is(typeof syncFactoryDescriptor?.value, 'function')
    t.true(syncFactoryDescriptor?.writable)
    t.true(syncFactoryDescriptor?.enumerable)
    t.true(syncFactoryDescriptor?.configurable)
    t.is(sync[Symbol.iterator](), sync)
    for (const key of ['next', 'return', 'throw'] as const) {
      const descriptor = Object.getOwnPropertyDescriptor(sync, key)
      t.is(typeof descriptor?.value, 'function')
      t.true(descriptor?.writable)
      t.true(descriptor?.enumerable)
      t.true(descriptor?.configurable)
    }
    const syncResult = sync.next()
    t.is(syncResult.done, false)
    t.is((syncResult.value as { number: number }).number, 1)

    const owner = new AsyncFib()
    const factoryDescriptor = Object.getOwnPropertyDescriptor(
      owner,
      Symbol.asyncIterator,
    )
    t.is(typeof factoryDescriptor?.value, 'function')
    t.true(factoryDescriptor?.writable)
    t.true(factoryDescriptor?.enumerable)
    t.true(factoryDescriptor?.configurable)

    const iterator = owner[Symbol.asyncIterator]()
    for (const key of ['next', 'return', 'throw'] as const) {
      const descriptor = Object.getOwnPropertyDescriptor(iterator, key)
      t.is(typeof descriptor?.value, 'function')
      t.true(descriptor?.writable)
      t.true(descriptor?.enumerable)
      t.true(descriptor?.configurable)
    }
    const iteratorDescriptor = Object.getOwnPropertyDescriptor(
      iterator,
      Symbol.asyncIterator,
    )
    t.is(typeof iteratorDescriptor?.value, 'function')
    t.true(iteratorDescriptor?.writable)
    t.true(iteratorDescriptor?.enumerable)
    t.true(iteratorDescriptor?.configurable)
    t.is(iteratorDescriptor?.value.call(iterator), iterator)
    t.is(poisoned.setterCalls.length, 0)
  } finally {
    poisoned.restore()
  }
})

test.serial(
  'async generator value holders ignore inherited setters',
  async (t) => {
    const iterator = new AsyncFib()[Symbol.asyncIterator]()
    const keys: PropertyKey[] = ['[[ErrorValue]]', '[[RequestValue]]']
    const poisoned = poisonObjectPrototypeSetters(keys)

    try {
      const nextResult = await iterator.next(7)
      t.is(nextResult.value, 7)
      t.is(nextResult.done, false)
      const rejection = { reason: 'exact inherited-setter rejection' }
      t.is(await rejectionOf(iterator.throw!(rejection)), rejection)
      t.is(poisoned.setterCalls.length, 0)
    } finally {
      poisoned.restore()
    }
  },
)

test('iterator results ignore inherited setters', (t) => {
  const result = spawnSync(
    process.execPath,
    [join(__dirname, 'iterator-result-own-properties.js')],
    {
      encoding: 'utf8',
      env: process.env,
      timeout: 30_000,
    },
  )
  const output = `${result.stdout}\n${result.stderr}`
  t.is(result.error, undefined, result.error?.stack)
  t.is(result.signal, null, output)
  t.is(result.status, 0, output)
  t.regex(result.stdout, /Iterator result own properties passed/)
})

test.serial(
  'deferred trace rejection ignores inherited code setters',
  async (t) => {
    const originalCode = Object.getOwnPropertyDescriptor(
      Error.prototype,
      'code',
    )
    let setterCalls = 0
    Object.defineProperty(Error.prototype, 'code', {
      configurable: true,
      set() {
        setterCalls++
        throw new Error('inherited code setter must not run')
      },
    })

    try {
      const rejection = (await rejectionOf(throwAsyncError())) as Error & {
        code: string
      }
      t.is(rejection.message, 'Async Error')
      t.is(rejection.code, 'InvalidArg')
      t.is(setterCalls, 0)
      t.true(Object.hasOwn(rejection, 'code'))
    } finally {
      if (originalCode) {
        Object.defineProperty(Error.prototype, 'code', originalCode)
      } else {
        delete (Error.prototype as Error & { code?: string }).code
      }
    }
  },
)

test('deferred trace releases its rejection reference after settlement', (t) => {
  const result = spawnSync(
    process.execPath,
    ['--expose-gc', join(__dirname, 'deferred-trace-release.js')],
    {
      encoding: 'utf8',
      env: process.env,
      timeout: 30_000,
    },
  )
  const output = `${result.stdout}\n${result.stderr}`
  t.is(result.error, undefined, result.error?.stack)
  t.is(result.signal, null, output)
  t.is(result.status, 0, output)
  t.regex(result.stdout, /Deferred trace release passed/)
})

test('async generator hands off after a queued setup failure', async (t) => {
  if (process.env.WASI_TEST) {
    t.pass('WASI panic behavior is covered by native async iterator tests')
    return
  }
  const probe = new AsyncIteratorAdmissionProbe([
    'value',
    'setup-panic',
    'value',
  ])
  const iterator = probe[Symbol.asyncIterator]()
  const first = iterator.next()
  const failing = iterator.next()
  const follower = iterator.next()

  await waitFor(
    () => probe.events.length === 1,
    'first hook was not admitted before queued setup failure',
  )
  probe.release(1)
  t.deepEqual(await first, { done: false, value: 0 })
  await t.throwsAsync(failing, {
    message: /queued async iterator setup panic/,
  })
  t.deepEqual(await follower, { done: true, value: undefined })
  t.deepEqual(probe.events, ['next:0:value', 'next:1:setup-panic'])
})

test('async generator hands off after a queued argument conversion failure', async (t) => {
  const probe = new AsyncIteratorAdmissionProbe(['value', 'value', 'value'])
  const iterator = probe[Symbol.asyncIterator]()
  const first = iterator.next()
  const failing = iterator.next(Symbol('invalid') as never)
  const follower = iterator.next()

  await waitFor(
    () => probe.events.length === 1,
    'first hook was not admitted before queued argument conversion failure',
  )
  probe.release(1)
  t.deepEqual(await first, { done: false, value: 0 })
  await t.throwsAsync(failing, {
    message: /Failed to convert napi value Symbol/,
  })
  await waitFor(
    () => probe.events.length === 2,
    'follower was not admitted after argument conversion failure',
  )
  probe.release(1)
  t.deepEqual(await follower, { done: false, value: 1 })
  t.deepEqual(probe.events, ['next:0:value', 'next:1:value'])
})

for (const outcome of ['error', 'panic'] as const) {
  test(`async generator hands off after a queued async ${outcome}`, async (t) => {
    if (outcome === 'panic' && process.env.WASI_TEST) {
      t.pass('WASI panic behavior is covered by native async iterator tests')
      return
    }
    const probe = new AsyncIteratorAdmissionProbe(['value', outcome, 'value'])
    const iterator = probe[Symbol.asyncIterator]()
    const first = iterator.next()
    const failing = iterator.next()
    const follower = iterator.next()

    await waitFor(
      () => probe.events.length === 1,
      `first hook was not admitted before queued async ${outcome}`,
    )
    probe.release(1)
    t.deepEqual(await first, { done: false, value: 0 })
    await waitFor(
      () => probe.events.length === 2,
      `queued async ${outcome} hook was not admitted`,
    )
    probe.release(1)
    await t.throwsAsync(failing, {
      message:
        outcome === 'error'
          ? /queued async iterator error/
          : /queued async iterator poll panic/,
    })
    t.deepEqual(await follower, { done: true, value: undefined })
    t.deepEqual(probe.events, ['next:0:value', `next:1:${outcome}`])
  })
}

test('async generator setup failures return rejected Promises', async (t) => {
  const invalidNextIterator = new AsyncGeneratorSetupFailure('none')[
    Symbol.asyncIterator
  ]()
  let invalidNextPromise: Promise<IteratorResult<number>> | undefined
  t.notThrows(() => {
    invalidNextPromise = invalidNextIterator.next(Symbol('invalid') as never)
  })
  t.true(invalidNextPromise instanceof Promise)
  await t.throwsAsync(invalidNextPromise!, {
    message: /Failed to convert napi value Symbol/,
  })
  t.deepEqual(await invalidNextIterator.next(), { done: false, value: 1 })

  const invalidReturnIterator = new AsyncGeneratorSetupFailure('none')[
    Symbol.asyncIterator
  ]()
  let invalidReturnPromise: Promise<IteratorResult<number>> | undefined
  t.notThrows(() => {
    invalidReturnPromise = invalidReturnIterator.return!(
      Symbol('invalid') as never,
    )
  })
  t.true(invalidReturnPromise instanceof Promise)
  await t.throwsAsync(invalidReturnPromise!, {
    message: /Failed to convert napi value Symbol/,
  })
  t.deepEqual(await invalidReturnIterator.next(), { done: false, value: 1 })

  const promiseReturnIterator = new AsyncGeneratorSetupFailure('none')[
    Symbol.asyncIterator
  ]()
  await t.throwsAsync(
    promiseReturnIterator.return!(Promise.resolve(1) as never),
    {
      message: /Failed to convert napi value Object/,
    },
  )
  t.deepEqual(await promiseReturnIterator.next(), { done: false, value: 1 })

  const pendingException = { reason: 'pending async generator exception' }
  const pendingExceptionIterator = new AsyncGeneratorSetupFailure(
    'throw-pending-exception',
  )[Symbol.asyncIterator]()
  const throwingValue = {
    [Symbol.toPrimitive]() {
      throw pendingException
    },
  }
  let pendingExceptionPromise: Promise<IteratorResult<number>> | undefined
  t.notThrows(() => {
    pendingExceptionPromise = pendingExceptionIterator.throw!(throwingValue)
  })
  t.true(pendingExceptionPromise instanceof Promise)
  t.is(await rejectionOf(pendingExceptionPromise!), pendingException)

  const handledThrowIterator = new AsyncGeneratorSetupFailure('none')[
    Symbol.asyncIterator
  ]()
  t.deepEqual(await handledThrowIterator.throw!('handled'), {
    done: true,
    value: undefined,
  })
  t.deepEqual(await handledThrowIterator.next(), {
    done: true,
    value: undefined,
  })

  const yieldingThrowIterator = new AsyncGeneratorSetupFailure('throw-value')[
    Symbol.asyncIterator
  ]()
  const yieldingThrow = yieldingThrowIterator.throw!('handled')
  const yieldingThrowFollower = yieldingThrowIterator.next()
  t.deepEqual(await yieldingThrow, {
    done: false,
    value: 1,
  })
  t.deepEqual(await yieldingThrowFollower, {
    done: false,
    value: 1,
  })

  if (process.env.WASI_TEST) {
    return
  }

  for (const [method, message] of [
    ['next', /next setup panic/],
    ['return', /return setup panic/],
    ['throw', /throw setup panic/],
  ] as const) {
    const iterator = new AsyncGeneratorSetupFailure(method)[
      Symbol.asyncIterator
    ]()
    let promise: Promise<IteratorResult<number>> | undefined
    t.notThrows(() => {
      if (method === 'next') {
        promise = iterator.next()
      } else if (method === 'return') {
        promise = iterator.return!(0)
      } else {
        promise = iterator.throw!(new Error('trigger throw hook'))
      }
    })
    t.true(promise instanceof Promise)
    await t.throwsAsync(promise!, { message })
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

test('async generators should run concurrently', async (t) => {
  if (typeof createDelayedCounterPair === 'undefined') {
    t.pass(
      'createDelayedCounterPair is not available (tokio_rt feature not enabled), skipping test',
    )
    return
  }

  t.timeout(30_000)
  const [counter1, counter2] = createDelayedCounterPair(5, 0)

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

  t.deepEqual(results1, [0, 1, 2, 3, 4])
  t.deepEqual(results2, [0, 1, 2, 3, 4])
})
