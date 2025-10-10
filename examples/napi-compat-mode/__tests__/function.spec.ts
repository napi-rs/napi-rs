import { test } from 'node:test'
import assert from 'node:assert'

// @ts-expect-error
import bindings from '../index.node'

test('should call the function', () => {
  bindings.testCallFunction((arg1: string, arg2: string) => {
    assert.strictEqual(`${arg1} ${arg2}`, 'hello world')
  })
})

test('should call function with ref args', () => {
  bindings.testCallFunctionWithRefArguments((arg1: string, arg2: string) => {
    assert.strictEqual(`${arg1} ${arg2}`, 'hello world')
  })
})

test('should set "this" properly', () => {
  const obj = {}
  bindings.testCallFunctionWithThis.call(obj, function (this: typeof obj) {
    assert.strictEqual(this, obj)
  })
})

test('should handle errors', () => {
  bindings.testCallFunctionError(
    () => {
      throw new Error('Testing')
    },
    (err: Error) => {
      assert.strictEqual(err.message, 'Testing')
    },
  )
})

test('should be able to create function from closure', () => {
  for (let i = 0; i < 100; i++) {
    assert.strictEqual(
      bindings.testCreateFunctionFromClosure()(
        ...Array.from({ length: i }, (_, i) => i),
      ),
      `arguments length: ${i}`,
    )
  }
})

test('should be able to create nest function from closure', () => {
  let callbackExecuted = false

  const mockObject = {
    on: (event: string, callback: Function) => {
      assert.strictEqual(event, 'on', 'Event name should be "on"')
      callback()
      callbackExecuted = true
    },
  }

  const handle = bindings.testNestCreateFunctionFromClosure()
  handle(mockObject)
  assert.ok(callbackExecuted, 'Nested callback should have been executed')
})
