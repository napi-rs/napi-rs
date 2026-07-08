import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import { dispose, instantiate } from '../example.wasip1-deferred.js'

const wasmBytes = await readFile(
  new URL('../example.wasm32-wasip1.wasm', import.meta.url),
)
const wasmModule = await WebAssembly.compile(wasmBytes)
const originalInstantiate = WebAssembly.instantiate
const initializationError = new Error(
  'intentional deferred initialization failure',
)
let beforeExitScheduled = false
let beforeExitEmitted = false

const scheduleBeforeExit = (event) => {
  if (event !== 'beforeExit' || beforeExitScheduled) {
    return
  }
  beforeExitScheduled = true
  queueMicrotask(() => {
    beforeExitEmitted = true
    process.emit('beforeExit', 0)
  })
}

process.on('newListener', scheduleBeforeExit)
WebAssembly.instantiate = () => Promise.reject(initializationError)
try {
  await assert.rejects(instantiate(wasmModule), (error) => {
    assert.strictEqual(error, initializationError)
    return true
  })
  await new Promise((resolve) => setImmediate(resolve))
} finally {
  process.removeListener('newListener', scheduleBeforeExit)
  WebAssembly.instantiate = originalInstantiate
}

assert.equal(beforeExitScheduled, true)
assert.equal(beforeExitEmitted, true)

const replacement = await instantiate(wasmModule)
assert.doesNotThrow(() => replacement.getStrFromObject())
await dispose()
process.stdout.write('deferred pending failure lifecycle passed\n')
