import { test } from 'node:test'
import assert from 'node:assert'

import { napiVersion } from '../napi-version'

// @ts-expect-error
import bindings from '../../index.node'

test('should call callback with the first arguments as an Error', async () => {
  if (napiVersion < 4) {
    assert.strictEqual(bindings.testTsfnError, undefined)
    return
  }
  await new Promise<void>((resolve, reject) => {
    bindings.testTsfnError((err: Error) => {
      try {
        assert.strictEqual(err instanceof Error, true)
        assert.strictEqual(err.message, 'invalid')
        resolve()
      } catch (err) {
        reject(err)
      }
    })
  })
})
