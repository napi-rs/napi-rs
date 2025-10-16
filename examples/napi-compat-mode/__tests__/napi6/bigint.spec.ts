import { test } from 'node:test'
import assert from 'node:assert'

import { napiVersion } from '../napi-version'

// @ts-expect-error
import bindings from '../../index.node'

test('should create bigints', () => {
  if (napiVersion >= 6) {
    assert.strictEqual(bindings.testCreateBigintFromI64(), BigInt('9223372036854775807'))
    assert.strictEqual(bindings.testCreateBigintFromMinI64(), BigInt('-9223372036854775808'))
    assert.strictEqual(bindings.testCreateBigintFromNegativeI64(), BigInt('-10'))
    assert.strictEqual(bindings.testCreateBigintFromU64(), BigInt('18446744073709551615'))
    assert.strictEqual(
      bindings.testCreateBigintFromI128(),
      BigInt('170141183460469231731687303715884105727'),
    )
    assert.strictEqual(
      bindings.testCreateBigintFromMinI128(),
      BigInt('-170141183460469231731687303715884105728'),
    )
    assert.strictEqual(bindings.testCreateBigintFromNegativeI128(), BigInt('-10'))
    assert.strictEqual(
      bindings.testCreateBigintFromU128(),
      BigInt('340282366920938463463374607431768211455'),
    )
    assert.strictEqual(
      bindings.testCreateBigintFromWords(),
      BigInt('-340282366920938463463374607431768211455'),
    )
  } else {
    assert.strictEqual(bindings.testCreateBigintFromI64, undefined)
  }
})

test('should get integers from bigints', () => {
  if (napiVersion >= 6) {
    assert.strictEqual(bindings.testGetBigintI64(BigInt('-123')), -123)
    assert.strictEqual(bindings.testGetBigintU64(BigInt(123)), 123)
    assert.deepStrictEqual(bindings.testGetBigintWords(), [
      BigInt('9223372036854775807'),
      BigInt('9223372036854775807'),
    ])
  } else {
    assert.strictEqual(bindings.testGetBigintI64, undefined)
  }
})
