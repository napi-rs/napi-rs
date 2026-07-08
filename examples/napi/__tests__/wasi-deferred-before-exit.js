import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import {
  createInstance,
  dispose,
  instantiate,
} from '../example.wasip1-deferred.js'

const wasmBytes = await readFile(
  new URL('../example.wasm32-wasip1.wasm', import.meta.url),
)
const wasmModule = await WebAssembly.compile(wasmBytes)
const first = await instantiate(wasmModule)
const independent = await createInstance(wasmModule)

assert.doesNotThrow(() => first.getStrFromObject())
assert.doesNotThrow(() => independent.exports.getStrFromObject())

let completed = false
process.once('beforeExit', () => {
  // This call must observe singleton disposal synchronously started by the
  // loader's earlier beforeExit listener.
  const replacementPromise = instantiate(wasmModule)
  void (async () => {
    try {
      const replacement = await replacementPromise
      assert.notStrictEqual(
        replacement,
        first,
        'automatic cleanup must replace the disposed singleton',
      )
      assert.doesNotThrow(() => replacement.getStrFromObject())
      assert.doesNotThrow(
        () => independent.exports.getStrFromObject(),
        'independent instances must remain live across beforeExit',
      )
      await independent.dispose()
      await dispose()
      completed = true
      process.stdout.write('deferred beforeExit lifecycle passed\n')
    } catch (error) {
      process.exitCode = 1
      console.error(error)
    }
  })()
})

process.once('exit', () => {
  assert.equal(completed, true)
})
