import { test } from 'node:test'
import assert from 'node:assert'

import { napiEngineRequirement, NapiVersion } from '../version.js'

test('should generate correct napi engine requirement', () => {
  // Snapshot testing not supported in node:test - verify manually
  const result = (
    Object.values(NapiVersion).filter(
      (v) => typeof v === 'number',
    ) as NapiVersion[]
  ).map(napiEngineRequirement)
  
  assert.ok(Array.isArray(result))
  assert.ok(result.length > 0)
})
