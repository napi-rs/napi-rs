const test = require('ava')

const bindings = require('../index.node')

test('should get buffer length', (t) => {
  const fixture = Buffer.from('wow, hello')
  t.is(bindings.getBufferLength(fixture), fixture.length)
})

test('should stringify buffer', (t) => {
  const fixture = 'wow, hello'
  t.is(bindings.bufferToString(Buffer.from(fixture)), fixture)
})
