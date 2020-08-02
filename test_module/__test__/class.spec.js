const test = require('ava')

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
