import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { setTimeout as delay } from 'node:timers/promises'

const require = createRequire(import.meta.url)
const binding = require('../index.cjs')
const mode = process.argv[2]

if (typeof global.gc !== 'function') {
  throw new Error('async factory lifecycle test requires --expose-gc')
}

async function forceGcUntil(references, message) {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    global.gc()
    const pressure = new ArrayBuffer(1024 * 1024)
    assert.equal(pressure.byteLength, 1024 * 1024)
    await delay(10)
    if (references.every((reference) => reference.deref() === undefined)) {
      return
    }
  }
  throw new Error(message)
}

function createReceiver() {
  let receiver = function AsyncFactoryReceiver() {}
  const reference = new WeakRef(receiver)
  return {
    reference,
    run(callback) {
      const result = callback(receiver)
      receiver = undefined
      return result
    },
  }
}

async function verifyOutOfOrderSettlement() {
  let resolveFirst
  let resolveSecond
  const firstGate = new Promise((resolve) => {
    resolveFirst = resolve
  })
  const secondGate = new Promise((resolve) => {
    resolveSecond = resolve
  })

  const first = binding.ClassWithFactory.withNameAfter('first', firstGate)
  const second = binding.ClassWithFactory.withNameAfter('second', secondGate)

  resolveFirst()
  assert.equal((await first).name, 'first')
  resolveSecond()
  assert.equal((await second).name, 'second')
}

function createConversionFailureReference() {
  const receiver = createReceiver()
  receiver.run((thisArg) => {
    assert.throws(() =>
      binding.ClassWithFactory.withNameAfter.call(
        thisArg,
        42,
        Promise.resolve(),
      ),
    )
  })
  return receiver.reference
}

async function verifyConversionFailureRelease() {
  const references = Array.from(
    { length: 32 },
    createConversionFailureReference,
  )
  await delay(0)
  await forceGcUntil(
    references,
    'async factory receivers remained referenced after argument conversion failed',
  )
}

async function verifyFutureErrorRelease() {
  const fixtures = Array.from({ length: 32 }, () => {
    const receiver = createReceiver()
    const promise = receiver.run((thisArg) =>
      binding.ClassWithFactory.failAfter.call(thisArg, Promise.resolve()),
    )
    return { promise, reference: receiver.reference }
  })

  await Promise.all(
    fixtures.map(({ promise }) =>
      assert.rejects(promise, /intentional async factory failure/),
    ),
  )
  await forceGcUntil(
    fixtures.map(({ reference }) => reference),
    'async factory receivers remained referenced after the future rejected',
  )
}

async function verifyCancellationRelease() {
  const fixtures = Array.from({ length: 32 }, () => {
    const receiver = createReceiver()
    const promise = receiver.run((thisArg) =>
      binding.ClassWithFactory.pending.call(thisArg),
    )
    return {
      reference: receiver.reference,
      rejection: assert.rejects(promise, /cancel/i),
    }
  })

  binding.shutdownAsyncRuntimeForTest()
  await Promise.all(fixtures.map(({ rejection }) => rejection))
  await forceGcUntil(
    fixtures.map(({ reference }) => reference),
    'async factory receivers remained referenced after runtime cancellation',
  )
}

const testCase = {
  'out-of-order': verifyOutOfOrderSettlement,
  'conversion-failure': verifyConversionFailureRelease,
  'future-error': verifyFutureErrorRelease,
  cancellation: verifyCancellationRelease,
}[mode]

assert.ok(testCase, `unknown async factory lifecycle mode: ${mode}`)
await testCase()
console.log(`async factory lifecycle passed: ${mode}`)
