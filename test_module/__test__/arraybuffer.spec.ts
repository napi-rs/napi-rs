import test from 'ava'

const bindings = require('../index.node')

test('should get arraybuffer length', (t) => {
  const fixture = Buffer.from('wow, hello')
  t.is(bindings.getArraybufferLength(fixture.buffer), fixture.buffer.byteLength)
})
