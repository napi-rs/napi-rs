import { test } from 'node:test'
import assert from 'node:assert'

// @ts-expect-error
import bindings from '../index.node'

test('should create class', () => {
  const TestClass = bindings.createTestClass()
  const fixture = 20
  const testClass = new TestClass(fixture)
  assert.strictEqual(testClass.count, fixture)
  const add = 101
  testClass.addCount(add)
  assert.strictEqual(testClass.count, fixture + add)
})

test('should be able to manipulate wrapped native value', () => {
  const TestClass = bindings.createTestClass()
  const fixture = 20
  const testClass = new TestClass(fixture)
  const add = 101
  assert.strictEqual(testClass.addNativeCount(add), fixture + add + 100)
})

test('should be able to re-create wrapped native value', () => {
  const TestClass = bindings.createTestClass()
  const fixture = 20
  const testClass = new TestClass(fixture)
  const add = 101
  assert.strictEqual(testClass.addNativeCount(add), fixture + add + 100)
  testClass.renewWrapped()
  assert.strictEqual(testClass.addNativeCount(0), 42)
})
