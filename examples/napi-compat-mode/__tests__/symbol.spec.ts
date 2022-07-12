import test from 'ava'

const bindings = require('../index.node')

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

test('should create symbol from JsString', (t) => {
  const fixture = 'N-API Symbol'
  const symbol = bindings.createSymbolFromJsString(fixture)
  t.true(typeof symbol === 'symbol')
  t.is(symbol.toString(), `Symbol(${fixture})`)
})
