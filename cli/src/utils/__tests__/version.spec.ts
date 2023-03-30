import test from 'ava'

import { napiEngineRequirement, NapiVersion } from '../version.js'

test('should generate correct napi engine requirement', (t) => {
  t.snapshot(
    (
      Object.values(NapiVersion).filter(
        (v) => typeof v === 'number',
      ) as NapiVersion[]
    ).map(napiEngineRequirement),
  )
})
