import { test } from 'node:test'
import assert from 'node:assert'

// @ts-expect-error
import bindings from '../index.node'

test('should be able to create array', () => {
  const arr: number[] = bindings.testCreateArray()
  assert.ok(arr instanceof Array)
  assert.ok(Array.isArray(arr))
  arr.push(1, 2, 3)
  assert.deepStrictEqual(arr, [1, 2, 3])
})

test('should be able to create array with length', () => {
  const len = 100
  const arr: number[] = bindings.testCreateArrayWithLength(len)
  assert.ok(arr instanceof Array)
  assert.ok(Array.isArray(arr))
  assert.strictEqual(arr.length, len)
})

test('should be able to set element', () => {
  const obj = {}
  const index = 29
  const arr: unknown[] = []
  bindings.testSetElement(arr, index, obj)
  assert.strictEqual(arr[index], obj)
})

test('should be able to use has_element', () => {
  const arr: any[] = [1, '3', undefined]
  const index = 29
  arr[index] = {}
  assert.ok(bindings.testHasElement(arr, 0))
  assert.ok(bindings.testHasElement(arr, 1))
  assert.ok(bindings.testHasElement(arr, 2))
  assert.strictEqual(bindings.testHasElement(arr, 3), false)
  assert.strictEqual(bindings.testHasElement(arr, 10), false)
  assert.ok(bindings.testHasElement(arr, index))
})

test('should be able to delete element', (t) => {
  const arr: number[] = [0, 1, 2, 3]
  for (const [index] of arr.entries()) {
    t.true(bindings.testDeleteElement(arr, index))
    t.true(arr[index] === undefined)
  }
})
