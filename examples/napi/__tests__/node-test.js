import {
  test,
  after as afterAll,
  afterEach,
  before as beforeAll,
  beforeEach,
} from 'node:test'
import assert from 'node:assert'

// node:test doesn't have expect-style assertions like Bun/Jest
// We need to wrap node:assert to provide an expect-like interface
const expect = (actual) => ({
  toEqual: (expected) => assert.deepStrictEqual(actual, expected),
  toBe: (expected, message) => assert.strictEqual(actual, expected, message),
  toMatch: (expected) => assert.match(actual, expected),
  toThrow: (expected) => {
    if (typeof actual === 'function') {
      if (expected) {
        assert.throws(actual, expected)
      } else {
        assert.throws(actual)
      }
    } else {
      throw new Error('toThrow requires a function')
    }
  },
  not: {
    toEqual: (expected) => assert.notDeepStrictEqual(actual, expected),
    toBe: (expected) => assert.notStrictEqual(actual, expected),
    toThrow: (expected) => {
      if (typeof actual === 'function') {
        if (expected) {
          assert.doesNotThrow(actual, expected)
        } else {
          assert.doesNotThrow(actual)
        }
      } else {
        throw new Error('toThrow requires a function')
      }
    },
  },
})

export { test, afterAll, afterEach, beforeAll, beforeEach, expect }
