import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import { dispose, instantiate } from '../example.wasip1-deferred.js'

const wasmBytes = await readFile(
  new URL('../example.wasm32-wasip1.wasm', import.meta.url),
)
const wasmModule = await WebAssembly.compile(wasmBytes)
const first = await instantiate(wasmModule)

assert.equal(first.add(1, 2), 3)

let completed = false
process.once('beforeExit', () => {
  setImmediate(() => {
    void (async () => {
      const replacement = await instantiate(wasmModule)
      assert.notStrictEqual(
        replacement,
        first,
        'automatic cleanup must replace the disposed singleton',
      )
      assert.equal(replacement.add(20, 22), 42)
      await dispose()
      completed = true
      process.stdout.write('deferred beforeExit lifecycle passed\n')
    })().catch((error) => {
      setImmediate(() => {
        throw error
      })
    })
  })
})

process.once('exit', () => {
  assert.equal(completed, true)
})
