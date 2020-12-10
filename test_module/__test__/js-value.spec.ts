import test from 'ava'

const bindings = require('../index.node')

test('instanceof', (t) => {
  const day = new Date()
  t.true(bindings.instanceof(day, Date))
  t.false(bindings.instanceof(day, Number))
  t.false(bindings.instanceof(1, Date))
})

test('is_error', (t) => {
  t.true(bindings.isError(new Error()))
  t.true(bindings.isError(new TypeError()))
  t.true(bindings.isError(new SyntaxError()))
  t.false(bindings.isError('111'))
  t.false(bindings.isError(2))
  t.false(bindings.isError(Symbol()))
})

test('is_typedarray', (t) => {
  t.true(bindings.isTypedarray(new Uint8Array()))
  t.true(bindings.isTypedarray(new Uint16Array()))
  t.true(bindings.isTypedarray(new Uint32Array()))
  t.true(bindings.isTypedarray(new Int8Array()))
  t.true(bindings.isTypedarray(new Int16Array()))
  t.true(bindings.isTypedarray(new Int32Array()))
  t.true(bindings.isTypedarray(Buffer.from('123')))
  t.false(bindings.isTypedarray(Buffer.from('123').buffer))
  t.false(bindings.isTypedarray([]))
})

test('is_dataview', (t) => {
  const data = new Uint8Array(100)
  t.true(bindings.isDataview(new DataView(data.buffer)))
  t.false(bindings.isDataview(Buffer.from('123')))
})

test('strict_equals', (t) => {
  const a = {
    foo: 'bar',
  }
  const b = { ...a }
  t.false(bindings.strictEquals(a, b))
  t.false(bindings.strictEquals(1, '1'))
  t.false(bindings.strictEquals(null, undefined))
  t.false(bindings.strictEquals(NaN, NaN))
  t.true(bindings.strictEquals(a, a))
})

test('cast_unknown', (t) => {
  const f = {}
  const r = bindings.castUnknown(f)
  t.is(f, r)
})

test('cast_unknown will not throw', (t) => {
  const f = 1
  t.notThrows(() => bindings.castUnknown(f))
})
