import {
  ThingList,
  TypeTagA,
  UnwrapForgerySurface,
  objectWrapMismatchKeepsWrap,
  objectWrapRoundtrip,
  objectRewrapAfterRemove,
  removeWrappedObjectAsU8Rejected,
  unwrapObjectAsU8Rejected,
} from '../index.cjs'

import { test } from './test.framework.js'

// `Object::wrap` stamps the JS object with an unforgeable per-type wrap tag
// (a no-op without napi8 / on wasm, where the in-memory `TypeId` check remains
// the only guard). These tests pin the public contract: unwrap/remove_wrapped
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
