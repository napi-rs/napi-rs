import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { setImmediate } from 'node:timers/promises'

const require = createRequire(import.meta.url)
const binding = require('../index.cjs')
const mode = process.argv[2]

if (typeof global.gc !== 'function') {
  throw new Error('Async iterator callback lifetime test requires --expose-gc')
}
if (mode !== 'detached' && mode !== 'rebound') {
  throw new Error(`Unknown async iterator callback lifetime mode: ${mode}`)
}

async function forceCompactingGc() {
  for (let round = 0; round < 8; round += 1) {
    await setImmediate()
    const pressure = Array.from({ length: 10_000 }, (_, index) => ({
      index,
      payload: `${round}:${index}`,
    }))
    assert.equal(pressure.length, 10_000)
    global.gc()
  }
  await setImmediate()
}

function invoke(callback, args = []) {
  const receiver = mode === 'rebound' ? { unrelated: true } : undefined
  return Reflect.apply(callback, receiver, args)
}

function takeFactoryCallback() {
  let owner = new binding.AsyncGeneratorSetupFailure('none')
  const ownerRef = new WeakRef(owner)
  const callback = owner[Symbol.asyncIterator]
  owner = null
  return { callback, ownerRef }
}

function takeIteratorCallback(method) {
  let owner = new binding.AsyncGeneratorSetupFailure('none')
  let iterator = owner[Symbol.asyncIterator]()
  const ownerRef = new WeakRef(owner)
  const callback = iterator[method]
  owner = null
  iterator = null
  return { callback, ownerRef }
}

const factory = takeFactoryCallback()
await forceCompactingGc()
const iterator = invoke(factory.callback)
assert.deepEqual(await iterator.next(), { value: 1, done: false })
assert.notEqual(factory.ownerRef.deref(), undefined)

for (const [method, args, expected] of [
  ['next', [], { value: 1, done: false }],
  ['return', [0], { value: 0, done: true }],
  ['throw', [new Error('ignored')], { value: undefined, done: true }],
]) {
  const retained = takeIteratorCallback(method)
  await forceCompactingGc()
  assert.deepEqual(await invoke(retained.callback, args), expected)
  assert.notEqual(retained.ownerRef.deref(), undefined)
}

binding.shutdownRuntime()
console.log(`Async iterator callback lifetime passed: ${mode}`)
