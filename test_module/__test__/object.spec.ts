import test from 'ava'

const bindings = require('../index.node')

test('setProperty', (t) => {
  const obj = {}
  const key = 'jsPropertyKey'
  bindings.testSetProperty(obj, key)
  t.snapshot(obj[key])
})

test('setNamedProperty', (t) => {
  const obj = {}
  const property = Symbol('JsSymbol')
  bindings.testSetNamedProperty(obj, property)
  const keys = Object.keys(obj)
  const [key] = keys
  t.is(keys.length, 1)
  t.snapshot(key)
  t.is(obj[key], property)
})

test('testGetNamedProperty', (t) => {
  const obj = {
    p: Symbol('JsSymbol'),
  }
  t.is(bindings.testGetNamedProperty(obj), obj.p)
})

test('testHasNamedProperty', (t) => {
  const obj = {
    a: 1,
    b: undefined,
  }

  t.true(bindings.testHasNamedProperty(obj, 'a'))
  t.true(bindings.testHasNamedProperty(obj, 'b'))
  t.false(bindings.testHasNamedProperty(obj, 'c'))
})
