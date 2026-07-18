import test from 'ava'

import { TypeTagA, TypeTagB, makeTypeTagA } from '../index.cjs'

// Object type tags are a NATIVE-only guarantee. On wasm, `tag_object` /
// `validate_type_tag` are no-ops (see
// crates/napi/src/bindgen_runtime/type_tag.rs): the per-class anchor address is
// an instance-local linear-memory offset there, not a process-global identity,
// and Node-API type-tag support on wasm/emnapi is host-dependent. So a
// wrong-class / receiver-spoof / prototype-spoof / same-js_name-collision
// argument is NOT rejected on wasm. The four rejection tests below are therefore
// native-only; the positive round-trip tests run everywhere.
const napi8NativeOnlyTest = process.env.WASI_TEST ? test.skip : test

// 1. Normal usage still works: construct via `new` (W1), via factory (W2), via
//    a by-value return (W3); call `&self` methods and a method taking a
//    `&OtherClass` param. All succeed and round-trip.
test('normal usage still works across all construction paths', (t) => {
  const viaNew = new TypeTagA(1)
  t.is(viaNew.getValue(), 1)

  const viaFactory = TypeTagA.fromValue(2)
  t.is(viaFactory.getValue(), 2)

  const viaReturn = makeTypeTagA(3)
  t.is(viaReturn.getValue(), 3)

  // method taking `&TypeTagB` with the correct class round-trips
  const b = new TypeTagB(10)
  t.is(viaNew.addOther(b), 11)
  t.is(b.getValue(), 10)

  // method taking `&mut TypeTagB` with the correct class round-trips
  t.is(viaNew.bumpOther(b), 12) // b.value 10 -> 11, plus a.value 1
  t.is(b.getValue(), 11)
})

// 2. Wrong-class arg throws: a method wanting `&TypeTagB` given a wrapped
//    `TypeTagA` (`as unknown as TypeTagB`) -> catchable Error, no crash.
napi8NativeOnlyTest(
  'wrong-class argument throws instead of a type-confused cast',
  (t) => {
    const a = new TypeTagA(1)
    const notB = new TypeTagA(99)

    const err = t.throws(() => a.addOther(notB as unknown as TypeTagB))
    t.truthy(err)
    t.regex(String((err as Error).message), /not an instance of class/)

    // `&mut` param path is guarded too.
    const errMut = t.throws(() => a.bumpOther(notB as unknown as TypeTagB))
    t.truthy(errMut)
    t.regex(String((errMut as Error).message), /not an instance of class/)
  },
)

// 3. Receiver spoof throws: `TypeTagA.prototype.getValue.call(wrongThis)` ->
//    catchable Error, never a type-confused cast / crash.
//
//    Note on layering: napi-rs registers classes with `napi_define_class`, whose
//    instance methods carry a V8 signature bound to the *constructing* template
//    (a `setPrototypeOf` swap does not fool it). So for an unrelated wrapped
//    class, V8 rejects the receiver ("Illegal invocation") before the native
//    callback runs; the `unwrap_raw` tag check we added sits behind that as
//    defense-in-depth (it becomes decisive if a receiver ever reaches the
//    callback with a mismatched wrap). Either way: a catchable Error, no UB.
napi8NativeOnlyTest(
  'receiver spoof via .call(wrongThis) throws a catchable error',
  (t) => {
    const b = new TypeTagB(2)

    const err = t.throws(() => TypeTagA.prototype.getValue.call(b))
    t.truthy(err)

    // a plain, never-wrapped object re-parented onto TypeTagA.prototype is also
    // rejected -- still a catchable Error, never a crash.
    const spoof = {}
    Object.setPrototypeOf(spoof, TypeTagA.prototype)
    t.true(spoof instanceof TypeTagA) // instanceof fooled
    t.truthy(t.throws(() => TypeTagA.prototype.getValue.call(spoof)))
  },
)

// 4. Prototype spoof throws: an object that passes `instanceof TypeTagB` but
//    is not a real TypeTagB is rejected as a `&TypeTagB` argument. `instanceof`
//    (and thus `#[napi(strict)]`) would PASS; the unforgeable tag must still
//    reject it. We use a real wrapped TypeTagA re-parented onto TypeTagB.prototype
//    so `napi_unwrap` succeeds and only the tag distinguishes it.
napi8NativeOnlyTest(
  'prototype-spoofed argument is rejected by the tag (instanceof would pass)',
  (t) => {
    const a = new TypeTagA(1)

    const fakeB = new TypeTagA(50)
    Object.setPrototypeOf(fakeB, TypeTagB.prototype)
    t.true(fakeB instanceof TypeTagB) // instanceof fooled

    const err = t.throws(() => a.addOther(fakeB as unknown as TypeTagB))
    t.truthy(err)
    t.regex(String((err as Error).message), /not an instance of class/)

    // A never-wrapped plain object re-parented onto TypeTagB.prototype is rejected
    // too (catchable Error, no crash).
    const spoofB = {}
    Object.setPrototypeOf(spoofB, TypeTagB.prototype)
    t.true(spoofB instanceof TypeTagB)
    t.truthy(t.throws(() => a.addOther(spoofB as unknown as TypeTagB)))
  },
)

// 5. Subclassing still works: `class Sub extends TypeTagA {}`; `new Sub()`;
//    call a TypeTagA method -> OK (super() stamped with TypeTagA's tag).
test('subclass instances still pass the tag check', (t) => {
  class Sub extends TypeTagA {
    constructor() {
      super(7)
    }
  }

  const sub = new Sub()
  t.is(sub.getValue(), 7)

  const b = new TypeTagB(3)
  t.is(sub.addOther(b), 10)
})
