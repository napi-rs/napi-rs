import test from 'ava'

const bindings = require('../index.node')

test('should be able to create array', (t) => {
  const arr: number[] = bindings.testCreateArray()
  t.true(arr instanceof Array)
  t.true(Array.isArray(arr))
  arr.push(1, 2, 3)
  t.deepEqual(arr, [1, 2, 3])
})

test('should be able to create array with length', (t) => {
  const len = 100
  const arr: number[] = bindings.testCreateArrayWithLength(len)
  t.true(arr instanceof Array)
  t.true(Array.isArray(arr))
  t.is(arr.length, len)
})

test('should be able to set element', (t) => {
  const obj = {}
  const index = 29
  const arr: unknown[] = []
  bindings.testSetElement(arr, index, obj)
  t.is(arr[index], obj)
})

test('should be able to use has_element', (t) => {
  const arr: any[] = [1, '3', undefined]
  const index = 29
  arr[index] = {}
  t.true(bindings.testHasElement(arr, 0))
  t.true(bindings.testHasElement(arr, 1))
  t.true(bindings.testHasElement(arr, 2))
  t.false(bindings.testHasElement(arr, 3))
  t.false(bindings.testHasElement(arr, 10))
  t.true(bindings.testHasElement(arr, index))
})

test('should be able to delete element', (t) => {
  const arr: number[] = [0, 1, 2, 3]
  for (const [index] of arr.entries()) {
    t.true(bindings.testDeleteElement(arr, index))
    t.true(arr[index] === undefined)
  }
})
