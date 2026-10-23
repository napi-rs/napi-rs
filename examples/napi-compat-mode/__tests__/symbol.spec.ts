import test from 'ava'

import { napiVersion } from './napi-version'

// @ts-expect-error
import bindings from '../index.node'

test('should create named symbol', (t) => {
  const symbol = bindings.createNamedSymbol()
  t.true(typeof symbol === 'symbol')
  t.is(symbol.toString(), 'Symbol(native)')
})

test('should create unnamed symbol', (t) => {
  const symbol = bindings.createUnnamedSymbol()
  t.true(typeof symbol === 'symbol')
  t.is(symbol.toString(), 'Symbol()')
})

if (napiVersion >= 9) {
  for (const name of ['napi.test.property', '', '内部\0属性']) {
    test(`define_properties resolves symbol name ${JSON.stringify(name)}`, (t) => {
      const object: Record<PropertyKey, unknown> = {}
      bindings.testDefineSymbolProperty(object, name)
      t.deepEqual(Object.getOwnPropertySymbols(object), [Symbol.for(name)])
      t.is(object[Symbol.for(name)], 'readonly')
      t.is(object[name], undefined)
      t.is(object[Symbol(name)], undefined)
    })
  }
}
