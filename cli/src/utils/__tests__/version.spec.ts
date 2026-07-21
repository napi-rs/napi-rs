import test from 'ava'

import {
  MINIMUM_WASI_NODE_VERSION,
  napiEngineRequirement,
  restrictWasiNodeEngine,
  SUPPORTED_NAPI_VERSIONS,
} from '../version.js'

test('should generate correct napi engine requirement', (t) => {
  t.snapshot(SUPPORTED_NAPI_VERSIONS.map(napiEngineRequirement))
})

test('should keep node engine ranges inside the WASI floor', (t) => {
  t.is(restrictWasiNodeEngine('^22.14.0'), '^22.14.0')
  t.is(restrictWasiNodeEngine('>=24'), '>=24')
})

test('should return the WASI floor for superset node engine ranges', (t) => {
  t.is(restrictWasiNodeEngine('>=18'), MINIMUM_WASI_NODE_VERSION)
  t.is(restrictWasiNodeEngine('>=12 <14 || >=18'), MINIMUM_WASI_NODE_VERSION)
})

test('should preserve partial intersections with the WASI floor', (t) => {
  t.is(restrictWasiNodeEngine('>=22'), '>=22.13.0 <23.0.0-0 || >=23.5.0')
  t.is(restrictWasiNodeEngine('<21'), '>=20.19.0 <21.0.0-0')
})

test('should reject node engine ranges disjoint from the WASI floor', (t) => {
  for (const nodeRange of ['>=21 <22', '<20', '13.0.0', '21.0.0']) {
    const error = t.throws(() => restrictWasiNodeEngine(nodeRange))
    t.true(
      error.message.includes(`"${nodeRange}"`),
      `error should name the rejected range ${nodeRange}`,
    )
    t.true(
      error.message.includes(`"${MINIMUM_WASI_NODE_VERSION}"`),
      'error should name the supported WASI versions',
    )
  }
})

test('should fall back to the WASI floor for malformed node engine ranges', (t) => {
  t.is(restrictWasiNodeEngine('not-a-range'), MINIMUM_WASI_NODE_VERSION)
})

test('napi engine requirements always intersect the WASI floor', (t) => {
  for (const napiVersion of SUPPORTED_NAPI_VERSIONS) {
    t.notThrows(() =>
      restrictWasiNodeEngine(napiEngineRequirement(napiVersion)),
    )
  }
})
