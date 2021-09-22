import test from 'ava'

const bindings = require('../index.node')

test('either should work', (t) => {
  const fixture = 'napi'
  t.is(bindings.eitherNumberString(1), 101)
  t.is(bindings.eitherNumberString(fixture), `Either::B(${fixture})`)
})

test('dynamic argument length should work', (t) => {
  t.is(bindings.dynamicArgumentLength(1), 101)
  t.is(bindings.dynamicArgumentLength(), 42)
})
