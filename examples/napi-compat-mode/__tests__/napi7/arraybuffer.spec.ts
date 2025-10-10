import { test } from 'node:test'
import assert from 'node:assert'

import { napiVersion } from '../napi-version'

// @ts-expect-error
import bindings from '../../index.node'

const testFn = napiVersion >= 7 ? test : test.skip

test('should be able to detach ArrayBuffer', () => {
  const buf = Buffer.from('hello world')
  const ab = buf.buffer.slice(0, buf.length)
  try {
    bindings.testDetachArrayBuffer(ab)
    assert.strictEqual(ab.byteLength, 0)
  } catch (e) {
    assert.strictEqual((e as any).code, 'DetachableArraybufferExpected')
  }
})

test('is detached arraybuffer should work fine', () => {
  const buf = Buffer.from('hello world')
  const ab = buf.buffer.slice(0, buf.length)
  try {
    bindings.testDetachArrayBuffer(ab)
    const nonDetachedArrayBuffer = new ArrayBuffer(10)
    assert.ok(bindings.testIsDetachedArrayBuffer(ab))
    assert.strictEqual(bindings.testIsDetachedArrayBuffer(nonDetachedArrayBuffer, false))
  } catch (e) {
    assert.strictEqual((e as any).code, 'DetachableArraybufferExpected')
  }
})
