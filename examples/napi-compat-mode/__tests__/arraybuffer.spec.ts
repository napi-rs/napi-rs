import ava from 'ava'

import { napiVersion } from './napi-version'

const bindings = require('../index.node')

const test = napiVersion >= 6 ? ava : ava.skip

test('should get arraybuffer length', (t) => {
  const fixture = Buffer.from('wow, hello')
  t.is(bindings.getArraybufferLength(fixture.buffer), fixture.buffer.byteLength)
})

test('should be able to mutate Uint8Array', (t) => {
  const fixture = new Uint8Array([0, 1, 2])
  bindings.mutateUint8Array(fixture)
  t.is(fixture[0], 42)
})

test('should be able to mutate Uint16Array', (t) => {
  const fixture = new Uint16Array([0, 1, 2])
  bindings.mutateUint16Array(fixture)
  t.is(fixture[0], 65535)
})

test('should be able to mutate Int16Array', (t) => {
  const fixture = new Int16Array([0, 1, 2])
  bindings.mutateInt16Array(fixture)
  t.is(fixture[0], 32767)
})

test('should be able to mutate Float32Array', (t) => {
  const fixture = new Float32Array([0, 1, 2])
  bindings.mutateFloat32Array(fixture)
  t.true(Math.abs(fixture[0] - 3.33) <= 0.0001)
})

test('should be able to mutate Float64Array', (t) => {
  const fixture = new Float64Array([0, 1, 2])
  bindings.mutateFloat64Array(fixture)
  t.true(Math.abs(fixture[0] - Math.PI) <= 0.0000001)
})

test('should be able to mutate BigInt64Array', (t) => {
  const fixture = new BigInt64Array([BigInt(0), BigInt(1), BigInt(2)])
  bindings.mutateI64Array(fixture)
  t.deepEqual(fixture[0], BigInt('9223372036854775807'))
})
