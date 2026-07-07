import { createRequire } from 'node:module'

import test from 'ava'

const require = createRequire(import.meta.url)
import { Buffer as NodeBuffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'

import test from 'ava'

const isThreadlessWasiBufferTest = Boolean(
  process.env.NAPI_RS_TEST_THREADLESS_WASI_BUFFER,
)

test.skipIf(!isThreadlessWasiBufferTest)(
  'threadless WASI rejects built-in Tokio async exports without trapping',
  async (t) => {
    const binding = require('../example.wasip1.cjs')

    t.is(binding.add(1, 2), 3)
    await t.throwsAsync(() => binding.asyncPlus100(Promise.resolve(1)), {
      message:
        'Built-in Tokio async tasks require a threaded WASI target. Use wasm32-wasip1-threads, or enable async-runtime and register a custom AsyncRuntime backend for wasm32-wasip1.',
    })
    t.is(binding.add(2, 3), 5)
  'deferred WASI loader exposes Buffer values without installing a global',
  async (t) => {
    const globalBufferDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      'Buffer',
    )
    if (!globalBufferDescriptor) {
      t.fail('Expected Node.js to provide a global Buffer before the test')
      return
    }

    const wasmBytes = await readFile(
      new URL('../example.wasm32-wasip1.wasm', import.meta.url),
    )
    const wasmModule = await WebAssembly.compile(wasmBytes)

    try {
      t.true(Reflect.deleteProperty(globalThis, 'Buffer'))
      const deferred = await import(
        new URL('../example.wasip1-deferred.js', import.meta.url).href
      )
      const instance = await deferred.createInstance(wasmModule)

      try {
        const value = instance.exports.getBuffer()
        t.true(NodeBuffer.isBuffer(value))
        t.is(value.toString(), 'Hello world')
        t.false(Object.hasOwn(globalThis, 'Buffer'))
      } finally {
        instance.dispose()
      }
    } finally {
      Object.defineProperty(globalThis, 'Buffer', globalBufferDescriptor)
    }
  },
)
