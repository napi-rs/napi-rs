import { test } from 'node:test'
import assert from 'node:assert'

// @ts-expect-error
import bindings from '../../index.node'

test('should resolve deferred from background thread', async () => {
  const promise = bindings.testDeferred(false)
  t.assert(promise instanceof Promise)

  const result = await promise
  assert.strictEqual(result, 15)
})

test('should reject deferred from background thread', async () => {
  await assert.rejects(() => bindings.testDeferred(true), { message: 'Fail' })
})
