import assert from 'node:assert/strict'

import { asyncPlus100, shutdownAsyncRuntimeForTest } from '../index.cjs'

const pendingInput = new Promise(() => {})
const generatedPromise = asyncPlus100(pendingInput)

shutdownAsyncRuntimeForTest()

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
