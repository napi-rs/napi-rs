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
  t.is(restrictWasiNodeEngine('>=12 <16 || >=18'), MINIMUM_WASI_NODE_VERSION)
})

test('should not admit prereleases excluded by the WASI node floor', (t) => {
  for (const [source, expected] of [
    ['>=20.19.0-rc.1 <21', '>=20.19.0 <21.0.0-0'],
    ['>=22.13.0-rc.1 <23', '>=22.13.0 <23.0.0-0'],
    ['>=23.5.0-rc.1', '>=23.5.0'],
  ]) {
    const restricted = restrictWasiNodeEngine(source)
    t.is(restricted, expected)
    t.true(subset(restricted, source))
    t.true(subset(restricted, MINIMUM_WASI_NODE_VERSION))
  }
})

test('should exclude unsupported Node release lines', (t) => {
  t.is(restrictWasiNodeEngine('>=21 <22'), MINIMUM_WASI_NODE_VERSION)
  t.is(
    restrictWasiNodeEngine('>=20.0.0 <23'),
    '>=20.19.0 <21.0.0-0 || >=22.13.0 <23.0.0-0',
  )
})
