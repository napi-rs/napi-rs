import test from 'ava'

import { napiVersion } from '../napi-version'

const bindings = require('../../index.node')

test('should create bigints', (t) => {
  if (napiVersion >= 6) {
    t.is(bindings.testCreateBigintFromI64(), BigInt('9223372036854775807'))
    t.is(bindings.testCreateBigintFromU64(), BigInt('18446744073709551615'))
    t.is(
      bindings.testCreateBigintFromI128(),
      BigInt('170141183460469231731687303715884105727'),
    )
    t.is(
      bindings.testCreateBigintFromU128(),
      BigInt('340282366920938463463374607431768211455'),
    )
    t.is(
      bindings.testCreateBigintFromWords(),
      BigInt('-340282366920938463463374607431768211455'),
    )
  } else {
    t.is(bindings.testCreateBigintFromI64, undefined)
  }
})

test('should get integers from bigints', (t) => {
  if (napiVersion >= 6) {
    t.is(bindings.testGetBigintI64(BigInt('-123')), -123)
    t.is(bindings.testGetBigintU64(BigInt(123)), 123)
    t.deepEqual(bindings.testGetBigintWords(), [
      BigInt('9223372036854775807'),
      BigInt('9223372036854775807'),
    ])
  } else {
    t.is(bindings.testGetBigintI64, undefined)
  }
})
