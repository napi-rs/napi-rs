import { test } from 'node:test'
import assert from 'node:assert'

// @ts-expect-error
import bindings from '../index.node'

test('instanceof', () => {
  const day = new Date()
  assert.ok(bindings.instanceof(day, Date))
  assert.strictEqual(bindings.instanceof(day, Number, false))
  assert.strictEqual(bindings.instanceof(1, Date, false))
})

test('is_error', () => {
  assert.ok(bindings.isError(new Error()))
  assert.ok(bindings.isError(new TypeError()))
  assert.ok(bindings.isError(new SyntaxError()))
  assert.strictEqual(bindings.isError('111', false))
  assert.strictEqual(bindings.isError(2, false))
  assert.strictEqual(bindings.isError(Symbol(, false)))
})

test('is_typedarray', () => {
  assert.ok(bindings.isTypedarray(new Uint8Array()))
  assert.ok(bindings.isTypedarray(new Uint16Array()))
  assert.ok(bindings.isTypedarray(new Uint32Array()))
  assert.ok(bindings.isTypedarray(new Int8Array()))
  assert.ok(bindings.isTypedarray(new Int16Array()))
  assert.ok(bindings.isTypedarray(new Int32Array()))
  assert.ok(bindings.isTypedarray(Buffer.from('123')))
  assert.strictEqual(bindings.isTypedarray(Buffer.from('123', false).buffer))
  assert.strictEqual(bindings.isTypedarray([], false))
})

test('is_dataview', () => {
  const data = new Uint8Array(100)
  assert.ok(bindings.isDataview(new DataView(data.buffer)))
  assert.strictEqual(bindings.isDataview(Buffer.from('123', false)))
})

test('strict_equals', () => {
  const a = {
    foo: 'bar',
  }
  const b = { ...a }
  assert.strictEqual(bindings.strictEquals(a, b, false))
  assert.strictEqual(bindings.strictEquals(1, '1', false))
  assert.strictEqual(bindings.strictEquals(null, undefined, false))
  assert.strictEqual(bindings.strictEquals(NaN, NaN, false))
  assert.ok(bindings.strictEquals(a, a))
})

test('cast_unknown', () => {
  const f = {}
  const r = bindings.castUnknown(f)
  assert.strictEqual(f, r)
})

test('cast_unknown will not throw', () => {
  const f = 1
  assert.doesNotThrow(() => bindings.castUnknown(f))
})
