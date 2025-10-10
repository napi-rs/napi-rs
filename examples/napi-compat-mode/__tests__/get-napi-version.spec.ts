import { test } from 'node:test'
import assert from 'node:assert'

// @ts-expect-error
import bindings from '../index.node'

test('should get napi version', () => {
  const napiVersion = bindings.getNapiVersion()
  assert.ok(typeof napiVersion === 'number')
  assert.strictEqual(`${napiVersion}`, process.versions.napi!)
})
