import test from 'ava'

import {
  reflectObjectToJson,
  reflectUnknownToJson,
  reflectConstructorName,
  reflectHasTypeTagA,
  reflectHasTypeTagB,
  TypeTagA,
  TypeTagB,
} from '../index.cjs'

// The serde conversion and `constructor_name` are pure N-API and run everywhere.
// `has_type_tag` (and a couple of serde edge cases whose enumeration/bigint
// behavior on emnapi is host-dependent) are asserted native-only, matching
// type-tag.spec.ts.
const nativeOnly = process.env.WASI_TEST ? test.skip : test

// ---------------------------------------------------------------------------
// to_serde_json_value — structural round trips (every build).
// ---------------------------------------------------------------------------

test('to_serde_json_value round-trips objects, arrays and nesting', (t) => {
  const input = { a: 1, b: [1, 2, 3], c: { d: 'x', e: true, f: null } }
  t.deepEqual(reflectObjectToJson(input), input)
  t.deepEqual(reflectUnknownToJson([1, 'two', false, null]), [
    1,
    'two',
    false,
    null,
  ])
})

test('to_serde_json_value rejects undefined, functions and symbols', (t) => {
  // JSON has no representation for these; the bridge errors rather than (like
  // JSON.stringify) silently dropping them.
  t.throws(() => reflectUnknownToJson(undefined))
  t.throws(() => reflectUnknownToJson(() => {}))
  t.throws(() => reflectUnknownToJson(Symbol('s')))
})

nativeOnly(
  'to_serde_json_value converts BigInt losslessly, else to string',
  (t) => {
    t.is(reflectUnknownToJson(10n), 10)
    t.is(reflectUnknownToJson(2n ** 70n), (2n ** 70n).toString())
  },
)

nativeOnly(
  'to_serde_json_value walks enumerable props (Date -> {}, typed array -> index object, class instance -> Err)',
  (t) => {
    // A Date's prototype methods are non-enumerable built-ins and it has no
    // enumerable own properties, so the instant is lost.
    t.deepEqual(reflectObjectToJson(new Date(0) as any), {})
    // A typed array converts as an index-keyed object, never a JSON array (its
    // indices are own enumerable; its prototype methods are not).
    t.deepEqual(reflectObjectToJson(new Uint8Array([1, 2, 3]) as any), {
      '0': 1,
      '1': 2,
      '2': 3,
    })
    // A native class instance surfaces its enumerable prototype methods too, and
    // a method is a function the bridge cannot represent -> Err.
    t.throws(() => reflectObjectToJson(new TypeTagA(7) as any))
  },
)

nativeOnly('to_serde_json_value propagates a throwing getter', (t) => {
  const withThrowingGetter = {
    get boom(): number {
      throw new Error('getter blew up')
    },
  }
  t.throws(() => reflectObjectToJson(withThrowingGetter as any))
})

// ---------------------------------------------------------------------------
// constructor_name.
// ---------------------------------------------------------------------------

test('constructor_name returns the constructor name or null', (t) => {
  t.is(reflectConstructorName({}), 'Object')
  t.is(reflectConstructorName([] as any), 'Array')
  // A null-prototype object has no `constructor` at all.
  t.is(reflectConstructorName(Object.create(null)), null)
})

nativeOnly('constructor_name reflects a native class name', (t) => {
  t.is(reflectConstructorName(new TypeTagA(1) as any), 'TypeTagA')
})

test('constructor_name propagates a throwing constructor trap', (t) => {
  const proxy = new Proxy(
    {},
    {
      get(target, prop, receiver) {
        if (prop === 'constructor') {
          throw new Error('trap blew up')
        }
        return Reflect.get(target, prop, receiver)
      },
    },
  )
  t.throws(() => reflectConstructorName(proxy as any))
})

// ---------------------------------------------------------------------------
// has_type_tag — native only (the tag check is a no-op without napi8 / on wasm,
// where the method does not even exist).
// ---------------------------------------------------------------------------

nativeOnly(
  'has_type_tag is true for the exact class and a real JS subclass, false otherwise',
  (t) => {
    const a = new TypeTagA(1)
    t.true(reflectHasTypeTagA(a as any))
    t.false(reflectHasTypeTagB(a as any))

    const b = new TypeTagB(1)
    t.true(reflectHasTypeTagB(b as any))
    t.false(reflectHasTypeTagA(b as any))

    // a plain object carries no tag.
    t.false(reflectHasTypeTagA({} as any))

    // a real JS subclass runs the native super(), which stamps the base tag.
    class Sub extends TypeTagA {}
    t.true(reflectHasTypeTagA(new Sub(2) as any))
  },
)

nativeOnly('has_type_tag rejects a prototype-spoofed object', (t) => {
  // re-parenting a plain object onto the class prototype passes `instanceof`
  // but never stamps the tag, so the tag check still says no.
  const spoof = {}
  Object.setPrototypeOf(spoof, TypeTagA.prototype)
  t.true(spoof instanceof TypeTagA)
  t.false(reflectHasTypeTagA(spoof as any))
})
