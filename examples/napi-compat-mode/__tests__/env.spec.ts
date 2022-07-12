import test from 'ava'

const bindings = require('../index.node')

test('should be able to access env variable from native', (t) => {
  t.is(bindings.getEnvVariable(), 'napi-rs')
})

test('should be able to throw syntax error', (t) => {
  const msg = 'Custom Syntax Error'
  try {
    bindings.throwSyntaxError(msg)
    throw new Error('Unreachable')
  } catch (e) {
    t.true(e instanceof SyntaxError)
    t.is((e as SyntaxError).message, msg)
  }
})

test('should be able to coerceToBool', (t) => {
  t.true(bindings.coerceToBool(true))
  t.true(bindings.coerceToBool(1))
  t.true(bindings.coerceToBool({}))
  t.true(bindings.coerceToBool(Symbol()))
  t.false(bindings.coerceToBool(0))
  t.false(bindings.coerceToBool(undefined))
  t.false(bindings.coerceToBool(null))
  t.false(bindings.coerceToBool(NaN))
})
