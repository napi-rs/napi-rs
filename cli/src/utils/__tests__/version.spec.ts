import test from 'ava'
import { subset } from 'semver'

import {
  MINIMUM_WASI_NODE_VERSION,
  napiEngineRequirement,
  restrictWasiNodeEngine,
  SUPPORTED_NAPI_VERSIONS,
} from '../version.js'

test('should generate correct napi engine requirement', (t) => {
  t.snapshot(SUPPORTED_NAPI_VERSIONS.map(napiEngineRequirement))
})

test('should intersect every compatible branch in a node engine range', (t) => {
  t.is(
    restrictWasiNodeEngine('>=12 <16 || >=18'),
    '>=14.18.0 <16.0.0-0 || >=18.0.0',
  )
})

test('should not admit prereleases excluded by the WASI node floor', (t) => {
  for (const [source, expected] of [
    ['>=14.18.0-rc.1 <15 || >=20.0.0-rc.1', '>=14.18.0 <15.0.0-0 || >=20.0.0'],
    ['>=18.0.0-rc.1', '>=18.0.0'],
    ['<20.0.0-rc.1', '>=14.18.0 <20.0.0-0'],
  ]) {
    const restricted = restrictWasiNodeEngine(source)
    t.is(restricted, expected)
    t.true(subset(restricted, source))
    t.true(subset(restricted, MINIMUM_WASI_NODE_VERSION))
  }
})
