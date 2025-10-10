import { test } from 'node:test'
import assert from 'node:assert'

import { napiVersion } from '../napi-version'

// @ts-expect-error
import bindings from '../../index.node'

test('should return false if value is not date', () => {
  if (napiVersion >= 5) {
    assert.strictEqual(bindings.testObjectIsDate({}, false))
    assert.strictEqual(bindings.testObjectIsDate(null, false))
    assert.strictEqual(bindings.testObjectIsDate(, false))
    assert.strictEqual(bindings.testObjectIsDate(10249892, false))
  } else {
    assert.strictEqual(bindings.testObjectIsDate, undefined)
  }
})

test('should return true if value is date', () => {
  if (napiVersion >= 5) {
    assert.ok(bindings.testObjectIsDate(new Date()))
  } else {
    assert.strictEqual(bindings.testObjectIsDate, undefined)
  }
})

test('should create date', () => {
  if (napiVersion >= 5) {
    const timestamp = new Date().valueOf()
    assert.deepStrictEqual(bindings.testCreateDate(timestamp), new Date(timestamp))
  } else {
    assert.strictEqual(bindings.testObjectIsDate, undefined)
  }
})

test('should get date value', () => {
  if (napiVersion >= 5) {
    const date = new Date()
    assert.strictEqual(bindings.testGetDateValue(date), date.valueOf())
  } else {
    assert.strictEqual(bindings.testObjectIsDate, undefined)
  }
})
