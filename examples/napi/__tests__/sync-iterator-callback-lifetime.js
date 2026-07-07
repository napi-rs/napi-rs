import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { setImmediate } from 'node:timers/promises'

const require = createRequire(import.meta.url)
const binding = require('../index.cjs')

if (typeof global.gc !== 'function') {
  throw new Error('Sync iterator callback lifetime test requires --expose-gc')
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

function takeCallback(method) {
  let owner = new binding.GeneratorLifecycleProbe()
  const ownerRef = new WeakRef(owner)
  const callback = owner[method]
  owner = null
  return { callback, ownerRef }
}

for (const [method, args, expected] of [
  ['next', [], { done: false, value: 1 }],
  ['return', ['done'], { done: true, value: 'done:1' }],
]) {
  const retained = takeCallback(method)
  await forceCompactingGc()

  const retainedOwner = retained.ownerRef.deref()
  assert.notEqual(retainedOwner, undefined)
  assert.throws(
    () => Reflect.apply(retained.callback, undefined, args),
    /Invalid generator receiver|incompatible receiver/,
  )

  const unrelated = new binding.GeneratorLifecycleProbe()
  assert.throws(
    () => Reflect.apply(retained.callback, unrelated, args),
    /incompatible receiver/,
  )
  assert.deepEqual(unrelated.next(), { done: false, value: 1 })

  assert.deepEqual(
    Reflect.apply(retained.callback, retainedOwner, args),
    expected,
  )
}

const retainedThrow = takeCallback('throw')
await forceCompactingGc()
const throwOwner = retainedThrow.ownerRef.deref()
assert.notEqual(throwOwner, undefined)
const marker = { reason: 'exact throw value' }
assert.throws(
  () => Reflect.apply(retainedThrow.callback, undefined, [marker]),
  /incompatible receiver/,
)
const unrelatedThrowOwner = new binding.GeneratorLifecycleProbe()
assert.throws(
  () => Reflect.apply(retainedThrow.callback, unrelatedThrowOwner, [marker]),
  /incompatible receiver/,
)
assert.deepEqual(unrelatedThrowOwner.next(), { done: false, value: 1 })
let thrown
try {
  Reflect.apply(retainedThrow.callback, throwOwner, [marker])
} catch (error) {
  thrown = error
}
assert.equal(thrown, marker)

binding.shutdownRuntime()
console.log('Sync iterator callback lifetime passed')
