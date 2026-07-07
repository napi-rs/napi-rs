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

for (const name of ['value', 'done']) {
  const descriptor = Object.create(null)
  descriptor.configurable = true
  descriptor.set = () => {
    setterCalls.push(name)
    throw new Error(`inherited ${name} setter must not run`)
  }
  Object.defineProperty(Object.prototype, name, descriptor)
}

let syncNext
let syncReturn
let asyncNext
let asyncReturn
try {
  const syncIterator = new binding.ComplexTypeGenerator()
  syncNext = syncIterator.next({ first: 2, second: 3 })
  syncReturn = syncIterator.return(['complete', 7])

  const asyncIterator = new binding.AsyncComplexTypeGenerator()[
    Symbol.asyncIterator
  ]()
  asyncNext = await asyncIterator.next({ first: 2, second: 3 })
  asyncReturn = await asyncIterator.return([8, 13])
} finally {
  restoreProperty('value', originalValue)
  restoreProperty('done', originalDone)
}

assert.deepEqual(syncNext, { done: false, value: [0, 5] })
assert.deepEqual(syncReturn, { done: true, value: ['complete', 7] })
assert.deepEqual(asyncNext, { done: false, value: [0, 5] })
assert.deepEqual(asyncReturn, { done: true, value: [8, 13] })
assert.deepEqual(setterCalls, [])
binding.shutdownRuntime()
console.log('Iterator result own properties passed')
