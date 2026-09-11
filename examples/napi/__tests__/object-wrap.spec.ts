import {
  ThingList,
  TypeTagA,
  UnwrapForgerySurface,
  objectRemoveWrappedA,
  objectRewrapAfterRemove,
  objectRewrapWithDifferentType,
  objectWrapMismatchKeepsWrap,
  objectWrapRoundtrip,
  objectWrapWithA,
  removeWrappedObjectAsU8Rejected,
  unwrapObjectAsARejected,
  unwrapObjectAsTypeTagARejected,
  unwrapObjectAsU8Rejected,
} from '../index.cjs'

import { test } from './test.framework.js'

// `Object::wrap` records every payload pointer in a process-local registry;
// `unwrap`/`remove_wrapped` accept only registered pointers, so objects not
// produced by `Object::wrap` (class instances, plain objects, previously
// detached or finalized payloads) are rejected without the payload being
// dereferenced. These tests pin the public contract: unwrap/remove_wrapped
// only succeed for the exact `T` the object was wrapped with, and failures
// never detach or corrupt the existing wrap.

test('object wrap/unwrap/remove_wrapped round-trip', (t) => {
  t.is(objectWrapRoundtrip(), 42)
})

// Regression: a `remove_wrapped` type mismatch must not detach the payload —
// `unwrap` with the correct type afterwards must still succeed.
test('failed remove_wrapped leaves the wrap intact', (t) => {
  t.is(objectWrapMismatchKeepsWrap(), 7)
})

test('object can be re-wrapped after remove_wrapped', (t) => {
  t.is(objectRewrapAfterRemove(), 2)
})

test('object can be re-wrapped with a different type after remove_wrapped', (t) => {
  t.is(objectRewrapWithDifferentType(), 9)
})

// Lifecycle regression: a payload detached by `remove_wrapped` leaves the
// registry, so when the same JS object later gets a class payload wrapped onto
// it (constructor callback runs with `this` = obj), `unwrap` must reject both
// the old type and the class type — the class payload was never registered.
test('payload detached then replaced by a class payload is rejected', (t) => {
  const obj = {}
  objectWrapWithA(obj)
  objectRemoveWrappedA(obj)
  // Wraps a bare class payload onto the previously wrapped object.
  t.notThrows(() => TypeTagA.call(obj, 123))
  t.true(unwrapObjectAsARejected(obj))
  t.true(unwrapObjectAsTypeTagARejected(obj))
})

test('class instances are rejected by unwrap/remove_wrapped', (t) => {
  const instance = new TypeTagA(1)
  t.true(unwrapObjectAsU8Rejected(instance))
  t.true(removeWrappedObjectAsU8Rejected(instance))
})

test('empty class instances are rejected without crashing', (t) => {
  // `#[napi] struct Thing;` wraps a 1-byte placeholder; unwrapping it as
  // anything must be a catchable rejection, never a memory error.
  const thing = new ThingList().thing
  t.true(unwrapObjectAsU8Rejected(thing))
  t.true(removeWrappedObjectAsU8Rejected(thing))
})

test('never-wrapped plain objects are rejected', (t) => {
  t.true(unwrapObjectAsU8Rejected({}))
  t.true(removeWrappedObjectAsU8Rejected({}))
})

test('field bytes written from JS do not confuse unwrap', (t) => {
  const target = new UnwrapForgerySurface()
  // Overwrite the first 16 bytes of the native allocation (two f64 fields)
  // with arbitrary bit patterns; unwrap must still reject the object.
  const bits = new DataView(new ArrayBuffer(16))
  bits.setBigUint64(0, 0xdeadbeefcafebaben, true)
  bits.setBigUint64(8, 0x0123456789abcdefn, true)
  target.first = bits.getFloat64(0, true)
  target.second = bits.getFloat64(8, true)
  t.true(unwrapObjectAsU8Rejected(target))
  t.true(removeWrappedObjectAsU8Rejected(target))
})
