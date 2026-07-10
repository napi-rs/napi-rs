import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import { Context } from '@emnapi/runtime'

const wasmBytes = await readFile(
  new URL('../example.wasm32-wasip1.wasm', import.meta.url),
)
const wasmModule = await WebAssembly.compile(wasmBytes)
const originalRunCleanup = Context.prototype.runCleanup
const cleanupError = new Error('intentional cleanup failure')
let cleanupAttempts = 0
let cleanupFailuresRemaining = 2
let dispose
let cleanupContext

Context.prototype.runCleanup = function failingRunCleanup(...args) {
  cleanupAttempts += 1
  cleanupContext = this
  if (cleanupFailuresRemaining > 0) {
    cleanupFailuresRemaining -= 1
    throw cleanupError
  }
  return Reflect.apply(originalRunCleanup, this, args)
}

try {
  const deferred = await import('../example.wasip1-deferred.js')
  dispose = deferred.dispose

  const first = await deferred.instantiate(wasmModule)
  assert.doesNotThrow(() => first.getStrFromObject())

  await assert.rejects(dispose(), (error) => {
    assert.strictEqual(error, cleanupError)
    return true
  })
  assert.equal(cleanupContext.canCallIntoJs(), false)

  await assert.rejects(deferred.instantiate(wasmModule), (error) => {
    assert.strictEqual(error, cleanupError)
    return true
  })
  assert.equal(cleanupAttempts, 2)

  const [replacement, sharedReplacement] = await Promise.all([
    deferred.instantiate(wasmModule),
    deferred.instantiate(wasmModule),
  ])
  assert.strictEqual(replacement, sharedReplacement)
  assert.notStrictEqual(replacement, first)
  assert.doesNotThrow(() => replacement.getStrFromObject())
  assert.equal(cleanupAttempts, 3)

  await dispose()
  assert.equal(cleanupAttempts, 4)
} finally {
  Context.prototype.runCleanup = originalRunCleanup
  await dispose?.().catch(() => {})
}

process.stdout.write('deferred failed-dispose lifecycle passed\n')
