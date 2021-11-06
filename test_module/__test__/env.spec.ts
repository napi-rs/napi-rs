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
