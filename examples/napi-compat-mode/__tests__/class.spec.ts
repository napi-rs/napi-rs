import test from 'ava'

const bindings = require('../index.node')

test('should create class', (t) => {
  const TestClass = bindings.createTestClass()
  const fixture = 20
  const testClass = new TestClass(fixture)
  t.is(testClass.count, fixture)
  const add = 101
  testClass.addCount(add)
  t.is(testClass.count, fixture + add)
})

test('should be able to manipulate wrapped native value', (t) => {
  const TestClass = bindings.createTestClass()
  const fixture = 20
  const testClass = new TestClass(fixture)
  const add = 101
  t.is(testClass.addNativeCount(add), fixture + add + 100)
})

test('should be able to re-create wrapped native value', (t) => {
  const TestClass = bindings.createTestClass()
  const fixture = 20
  const testClass = new TestClass(fixture)
  const add = 101
  t.is(testClass.addNativeCount(add), fixture + add + 100)
  testClass.renewWrapped()
  t.is(testClass.addNativeCount(0), 42)
})

test('should be able to new class instance in native side', (t) => {
  const instance = bindings.newTestClass()
  t.is(instance.count, 42)
})
