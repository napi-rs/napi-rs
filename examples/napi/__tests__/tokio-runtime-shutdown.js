import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const binding = require('../index.cjs')
const lifecycle = binding

const pendingInput = new Promise(() => {})
const generatedPromise = binding.asyncPlus100(pendingInput)

lifecycle.shutdownAsyncRuntimeForTest()

let timer
try {
  await assert.rejects(
    Promise.race([
      generatedPromise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('generated promise remained pending')),
          2000,
        )
      }),
    ]),
    /cancel/i,
  )
} finally {
  clearTimeout(timer)
}

let stoppedPromise
assert.doesNotThrow(() => {
  stoppedPromise = binding.asyncMultiTwo(2)
})
assert.ok(stoppedPromise instanceof Promise)
await assert.rejects(stoppedPromise, /stopped|shutting down/i)
