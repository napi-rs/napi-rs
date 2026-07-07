import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const binding = require('../index.cjs')

async function rejectionOf(factory, property) {
  let error
  try {
    await factory()
    assert.fail(`Expected ${property} installation to reject`)
  } catch (caught) {
    error = caught
  }
  return error
}

async function rejectsExact(factory, property) {
  const originalSymbol = globalThis.Symbol
  const rejection = { property }
  globalThis.Symbol = new Proxy(originalSymbol, {
    get(target, key, receiver) {
      if (key === property) {
        throw rejection
      }
      return Reflect.get(target, key, receiver)
    },
  })

  try {
    const actual = await rejectionOf(factory, property)
    assert.equal(actual, rejection)
  } finally {
    globalThis.Symbol = originalSymbol
  }
}

async function rejectsStatus(factory, property) {
  const originalSymbol = globalThis.Symbol
  globalThis.Symbol = {}

  try {
    assert.match(
      String(await rejectionOf(factory, property)),
      new RegExp(`Failed to define Symbol\\.${property}`),
    )
  } finally {
    globalThis.Symbol = originalSymbol
  }
}

const cases = [
  ['iterator', () => new binding.GeneratorLifecycleProbe()],
  ['iterator', () => binding.Fib2.create(0)],
  ['iterator', binding.createGeneratorLifecycleProbe],
  ['asyncIterator', () => new binding.AsyncFib()],
  ['asyncIterator', () => binding.AsyncDataSource.fromData([], 0)],
  ['asyncIterator', () => new binding.AsyncIteratorConstructor(0, 1)],
  ['asyncIterator', () => binding.createAsyncIteratorIntoInstance(0, 1)],
  ['asyncIterator', binding.createAsyncGeneratorSetupFailure],
]

for (const [property, factory] of cases) {
  await rejectsExact(factory, property)
  await rejectsStatus(factory, property)
}

binding.shutdownRuntime()
console.log('Iterator installation failures rejected')
