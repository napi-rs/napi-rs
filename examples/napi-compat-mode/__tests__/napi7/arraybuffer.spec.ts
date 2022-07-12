import ava from 'ava'

import { napiVersion } from '../napi-version'

const bindings = require('../../index.node')

const test = napiVersion >= 7 ? ava : ava.skip

test('should be able to detach ArrayBuffer', (t) => {
  const buf = Buffer.from('hello world')
  const ab = buf.buffer.slice(0, buf.length)
  try {
    bindings.testDetachArrayBuffer(ab)
    t.is(ab.byteLength, 0)
  } catch (e) {
    t.is((e as any).code, 'DetachableArraybufferExpected')
  }
})

test('is detached arraybuffer should work fine', (t) => {
  const buf = Buffer.from('hello world')
  const ab = buf.buffer.slice(0, buf.length)
  try {
    bindings.testDetachArrayBuffer(ab)
    const nonDetachedArrayBuffer = new ArrayBuffer(10)
    const detachedArrayBuffer = new ArrayBuffer(0)
    t.true(bindings.testIsDetachedArrayBuffer(ab))
    t.false(bindings.testIsDetachedArrayBuffer(nonDetachedArrayBuffer))
    t.true(bindings.testIsDetachedArrayBuffer(detachedArrayBuffer))
  } catch (e) {
    t.is((e as any).code, 'DetachableArraybufferExpected')
  }
})
