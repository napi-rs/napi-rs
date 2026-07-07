import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { setImmediate } from 'node:timers/promises'

const require = createRequire(import.meta.url)
const binding = require('../index.cjs')

if (typeof global.gc !== 'function') {
  throw new Error('ClassInstance later-turn test requires --expose-gc')
}

async function enterLaterTurnAndCompact() {
  await setImmediate()
  for (let round = 0; round < 8; round += 1) {
    const pressure = Array.from({ length: 10_000 }, (_, index) => ({
      index,
      payload: `${round}:${index}`,
    }))
    assert.equal(pressure.length, 10_000)
    global.gc()
    await setImmediate()
  }
}

let animal = new binding.Animal(binding.Kind.Dog, 'later-turn')
const animalWeak = new WeakRef(animal)

binding.stashClassInstanceForLaterTurn(animal)
animal = null
await enterLaterTurnAndCompact()
const returned = binding.takeClassInstanceFromLaterTurn()
assert.equal(returned, animalWeak.deref())
await enterLaterTurnAndCompact()
assert.equal(returned.name, 'later-turn')

binding.stashClassInstanceForLaterTurn(returned)
await enterLaterTurnAndCompact()
const assigned = {}
binding.assignClassInstanceFromLaterTurn.call(assigned, false)
assert.equal(assigned.laterTurnClassInstance, returned)

binding.stashClassInstanceForLaterTurn(returned)
await enterLaterTurnAndCompact()
const assignedWithAttributes = {}
binding.assignClassInstanceFromLaterTurn.call(assignedWithAttributes, true)
assert.equal(
  assignedWithAttributes.laterTurnClassInstanceWithAttributes,
  returned,
)

console.log('ClassInstance later-turn identity passed')
