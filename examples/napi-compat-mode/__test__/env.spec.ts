import test from 'ava'

const bindings = require('../index.node')

test('should be able to access env variable from native', (t) => {
  t.is(bindings.getEnvVariable(), 'napi-rs')
})
