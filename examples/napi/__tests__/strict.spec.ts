import { Buffer } from 'node:buffer'

import { test, before, after, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert'

import {
  validateArray,
  validateTypedArray,
  validateTypedArraySlice,
  validateBufferSlice,
  validateBigint,
  validateBuffer,
  validateBoolean,
  validateDate,
  validateDateTime,
  createExternal,
  validateExternal,
  validateFunction,
  validateHashMap,
  validatePromise,
  validateString,
  validateSymbol,
  validateNull,
  validateUndefined,
  validateEnum,
  validateStringEnum,
  KindInValidate,
  StatusInValidate,
  returnUndefinedIfInvalid,
  returnUndefinedIfInvalidPromise,
  validateOptional,
  shutdownRuntime,
} from '../index.cjs'

after(() => {
  shutdownRuntime()
})

test('should validate array', () => {
  assert.strictEqual(validateArray([1, 2, 3]), 3)
  // @ts-expect-error
  assert.throws(() => validateArray(1), {
    message: 'Expected an array',
    code: 'InvalidArg',
  })
})

test('should validate arraybuffer', () => {
  assert.strictEqual(validateTypedArray(new Uint8Array([1, 2, 3])), 3)
  // @ts-expect-error
  assert.throws(() => validateTypedArray(1), {
    code: 'InvalidArg',
    message: 'Expected a TypedArray value',
  })

  assert.strictEqual(validateTypedArraySlice(new Uint8Array([1, 2, 3])), 3)

  // @ts-expect-error
  assert.throws(() => validateTypedArraySlice(1), {
    code: 'InvalidArg',
    message: 'Expected a TypedArray value',
  })

  assert.strictEqual(validateBufferSlice(Buffer.from('hello')), 5)
  // @ts-expect-error
  assert.throws(() => validateBufferSlice(2), {
    code: 'InvalidArg',
    message: 'Expected a Buffer value',
  })
})

test('should validate BigInt', () => {
  if (typeof BigInt === 'undefined') {
    t.pass('BigInt is not supported')
  } else {
    const fx = BigInt(1024 * 1024 * 1024 * 1024)
    assert.strictEqual(validateBigint(fx), fx)
    // @ts-expect-error
    assert.throws(() => validateBigint(1), {
      code: 'InvalidArg',
      message: 'Expect value to be BigInt, but received Number',
    })
  }
})

test('should validate buffer', () => {
  assert.strictEqual(validateBuffer(Buffer.from('hello')), 5)
  // @ts-expect-error
  assert.throws(() => validateBuffer(2), {
    code: 'InvalidArg',
    message: 'Expected a Buffer value',
  })
})

test('should validate boolean value', () => {
  assert.strictEqual(validateBoolean(true), false)
  assert.strictEqual(validateBoolean(false), true)
  // @ts-expect-error
  assert.throws(() => validateBoolean(1), {
    code: 'InvalidArg',
    message: 'Expect value to be Boolean, but received Number',
  })
})

test('should validate date', () => {
  if (Number(process.versions.napi) < 5) {
    return assert.ok(true)
  }
  const fx = new Date('2016-12-24')
  assert.strictEqual(validateDate(fx), fx.valueOf())
  assert.strictEqual(validateDateTime(fx), 1)
  // @ts-expect-error
  assert.throws(() => validateDate(1), {
    code: 'InvalidArg',
    message: 'Expected a Date object',
  })
  // @ts-expect-error
  assert.throws(() => validateDateTime(2), {
    code: 'InvalidArg',
    message: 'Expected a Date object',
  })
})

test('should validate External', () => {
  const fx = createExternal(1)
  assert.strictEqual(validateExternal(fx), 1)
  // @ts-expect-error
  assert.throws(() => validateExternal(1), {
    code: 'InvalidArg',
    message: 'Expect value to be External, but received Number',
  })
})

test('should validate function', () => {
  assert.strictEqual(
    validateFunction(() => 1),
    4,
  )
  // @ts-expect-error
  assert.throws(() => validateFunction(2), {
    code: 'InvalidArg',
    message: 'Expect value to be Function, but received Number',
  })
})

test('should validate Map', () => {
  assert.strictEqual(validateHashMap({ a: 1, b: 2 }), 2)
  // @ts-expect-error
  assert.throws(() => validateHashMap(), {
    code: 'InvalidArg',
    message: 'Expect value to be Object, but received Undefined',
  })
})

test('should validate promise', async () => {
  assert.strictEqual(
    await validatePromise(
      new Promise((resolve) => {
        setTimeout(() => {
          resolve(1)
        }, 100)
      }),
    ),
    2,
  )
  // @ts-expect-error
  await assert.rejects(() => validatePromise(1), {
    code: 'InvalidArg',
    message: 'Expected Promise object',
  })
})

test('should validate string', () => {
  assert.strictEqual(validateString('hello'), 'hello!')
  // @ts-expect-error
  assert.throws(() => validateString(1), {
    code: 'InvalidArg',
    message: 'Expect value to be String, but received Number',
  })
})

test('should validate symbol', () => {
  assert.doesNotThrow(() => validateSymbol(Symbol()))
  // @ts-expect-error
  assert.throws(() => validateSymbol(1), {
    code: 'InvalidArg',
    message: 'Expect value to be Symbol, but received Number',
  })
})

test('should validate null', () => {
  assert.doesNotThrow(() => validateNull(null))
  // @ts-expect-error
  assert.throws(() => validateNull(1), {
    code: 'InvalidArg',
    message: 'Expect value to be Null, but received Number',
  })
})

test('should validate undefined', () => {
  assert.doesNotThrow(() => validateUndefined(void 0))
  // @ts-expect-error
  assert.doesNotThrow(() => validateUndefined())
  // @ts-expect-error
  assert.throws(() => validateUndefined(1), {
    code: 'InvalidArg',
    message: 'Expect value to be Undefined, but received Number',
  })
})

test('should validate enum', () => {
  assert.strictEqual(validateEnum(KindInValidate.Cat), KindInValidate.Cat)
  // @ts-expect-error
  assert.throws(() => validateEnum('3'), {
    code: 'InvalidArg',
    message: 'Expect value to be Number, but received String',
  })

  assert.strictEqual(validateStringEnum(StatusInValidate.Poll), 'Poll')

  // @ts-expect-error
  assert.throws(() => validateStringEnum(1), {
    code: 'InvalidArg',
    message: 'Expect value to be String, but received Number',
  })
})

test('should return undefined if arg is invalid', () => {
  assert.strictEqual(returnUndefinedIfInvalid(true), false)
  // @ts-expect-error
  assert.strictEqual(returnUndefinedIfInvalid(1), undefined)
})

test('should return Promise.reject() if arg is not Promise', async () => {
  assert.strictEqual(await returnUndefinedIfInvalidPromise(Promise.resolve(true)), false)
  // @ts-expect-error
  await assert.rejects(() => returnUndefinedIfInvalidPromise(1))
})

test('should validate Option<T>', () => {
  assert.strictEqual(validateOptional(null, null), false)
  assert.strictEqual(validateOptional(null, false), false)
  assert.strictEqual(validateOptional('1', false), true)
  assert.strictEqual(validateOptional(null, true), true)
  // @ts-expect-error
  assert.throws(() => validateOptional(1, null))
  // @ts-expect-error
  assert.throws(() => validateOptional(null, 2))
  // @ts-expect-error
  assert.throws(() => validateOptional(1, 2))
})
