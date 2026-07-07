import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const binding = require('../index.cjs')
const originalValue = Object.getOwnPropertyDescriptor(Object.prototype, 'value')
const originalDone = Object.getOwnPropertyDescriptor(Object.prototype, 'done')
const setterCalls = []

function restoreProperty(name, descriptor) {
  if (descriptor) {
    Object.defineProperty(Object.prototype, name, descriptor)
  } else {
    Reflect.deleteProperty(Object.prototype, name)
  }
}

function poisonResultSetters() {
  for (const name of ['value', 'done']) {
    const descriptor = Object.create(null)
    descriptor.configurable = true
    descriptor.set = () => {
      setterCalls.push(name)
      throw new Error(`inherited ${name} setter must not run`)
    }
    Object.defineProperty(Object.prototype, name, descriptor)
  }
}

let syncNext
let syncReturn
let asyncNext
poisonResultSetters()
try {
  const syncIterator = new binding.ComplexTypeGenerator()
  syncNext = syncIterator.next({ first: 2, second: 3 })
  syncReturn = syncIterator.return(['complete', 7])
} finally {
  restoreProperty('value', originalValue)
  restoreProperty('done', originalDone)
}

// Create emnapi's internal deferred before poisoning Object.prototype. The
// delayed generator keeps the actual iterator-result object construction inside
// the poisoned window without making the test depend on Deferred internals.
const asyncIterator = new binding.DelayedCounter(1, 20)[Symbol.asyncIterator]()
const asyncNextPromise = asyncIterator.next()
poisonResultSetters()
try {
  asyncNext = await asyncNextPromise
} finally {
  restoreProperty('value', originalValue)
  restoreProperty('done', originalDone)
}

assert.deepEqual(syncNext, { done: false, value: [0, 5] })
assert.deepEqual(syncReturn, { done: true, value: ['complete', 7] })
assert.deepEqual(asyncNext, { done: false, value: 0 })
assert.deepEqual(setterCalls, [])
binding.shutdownRuntime()
console.log('Iterator result own properties passed')
