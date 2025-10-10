import { test } from 'node:test'
import assert from 'node:assert'

import { napiEngineRequirement, NapiVersion } from '../version.js'

test('should generate correct napi engine requirement', () => {
  // Snapshot: 
    (
      Object.values(NapiVersion.filter(
        (v) => typeof v === 'number',
      ) as NapiVersion[]
    ).map(napiEngineRequirement),
  )
})
