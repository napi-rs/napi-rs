import { createRequire } from 'node:module'

import { bench } from 'vitest'

const require = createRequire(import.meta.url)

const { TestClass } = require('./index.node')

function createClass() {
  const testObject = new TestClass()

  Object.defineProperty(testObject, '_miterLimit', {
    value: 10,
    configurable: false,
    enumerable: false,
    writable: true,
  })

  Object.defineProperty(testObject, '_lineJoin', {
    value: 'miter',
    configurable: false,
    enumerable: false,
    writable: true,
  })

  return testObject
}

bench('Get Set from native#u32', () => {
  const o = createClass()
  o.miterNative
  o.miterNative = 1
})

bench('Get Set from JavaScript#u32', () => {
  const o = createClass()
  o.miter
  o.miter = 1
})

bench('Get Set from native#string', () => {
  const o = createClass()
  o.lineJoinNative
  o.lineJoinNative = 'bevel'
})

bench('Get Set from JavaScript#string', () => {
  const o = createClass()
  o.lineJoin
  o.lineJoin = 'bevel'
})
