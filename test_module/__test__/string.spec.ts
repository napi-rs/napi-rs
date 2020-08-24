import test from 'ava'

const bindings = require('../index.node')

test('should be able to concat string', (t) => {
  const fixture = 'JavaScript 🌳 你好 napi'
  t.snapshot(bindings.concatString(fixture))
})
