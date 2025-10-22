import test from 'ava'

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
