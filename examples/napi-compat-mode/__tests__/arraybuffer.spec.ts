import { test } from 'node:test'
import assert from 'node:assert'

import { napiVersion } from './napi-version'

// @ts-expect-error
import bindings from '../index.node'

const testFn = napiVersion >= 6 ? test : test.skip

test('should get arraybuffer length', () => {
  const fixture = Buffer.from('wow, hello')
  assert.strictEqual(bindings.getArraybufferLength(fixture.buffer), fixture.buffer.byteLength)
})

test('should be able to mutate Uint8Array', () => {
  const fixture = new Uint8Array([0, 1, 2])
  bindings.mutateUint8Array(fixture)
  assert.strictEqual(fixture[0], 42)
})

test('should be able to mutate Uint8Array in its middle', () => {
  const fixture = new Uint8Array([0, 1, 2])
  const view = new Uint8Array(fixture.buffer, 1, 1)
  bindings.mutateUint8Array(view)
  assert.strictEqual(fixture[1], 42)
})

test('should be able to mutate Uint16Array', () => {
  const fixture = new Uint16Array([0, 1, 2])
  bindings.mutateUint16Array(fixture)
  assert.strictEqual(fixture[0], 65535)
})

test('should be able to mutate Int16Array', () => {
  const fixture = new Int16Array([0, 1, 2])
  bindings.mutateInt16Array(fixture)
  assert.strictEqual(fixture[0], 32767)
})

test('should be able to mutate Float32Array', () => {
  const fixture = new Float32Array([0, 1, 2])
  bindings.mutateFloat32Array(fixture)
  assert.ok(Math.abs(fixture[0] - 3.33) <= 0.0001)
})

test('should be able to mutate Float64Array', () => {
  const fixture = new Float64Array([0, 1, 2])
  bindings.mutateFloat64Array(fixture)
  assert.ok(Math.abs(fixture[0] - Math.PI) <= 0.0000001)
})

test('should be able to mutate BigInt64Array', () => {
  const fixture = new BigInt64Array([BigInt(0), BigInt(1), BigInt(2)])
  bindings.mutateI64Array(fixture)
  assert.deepStrictEqual(fixture[0], BigInt('9223372036854775807'))
})
