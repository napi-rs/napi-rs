import test from 'ava'

import { napiEngineRequirement, SUPPORTED_NAPI_VERSIONS } from '../version.js'

test('should generate correct napi engine requirement', (t) => {
  t.snapshot(SUPPORTED_NAPI_VERSIONS.map(napiEngineRequirement))
})
