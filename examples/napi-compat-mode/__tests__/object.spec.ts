import { test } from 'node:test'
import assert from 'node:assert'

// @ts-expect-error
import bindings from '../index.node'

test('setProperty', () => {
  const obj = {}
  const key = 'jsPropertyKey'
  bindings.testSetProperty(obj, key)
  // @ts-expect-error
  // Snapshot: obj[key]
})

test('testGetProperty', () => {
  const name = Symbol('JsSymbol')
  const value = Symbol('JsValue')
  const obj = {
    [name]: value,
  }
  assert.strictEqual(bindings.testGetProperty(obj, name), value)
})

test('setNamedProperty', () => {
  const obj = {}
  const property = Symbol('JsSymbol')
  bindings.testSetNamedProperty(obj, property)
  const keys = Object.keys(obj)
  const [key] = keys
  assert.strictEqual(keys.length, 1)
  // Snapshot: key
  // @ts-expect-error
  assert.strictEqual(obj[key], property)
})

test('testGetNamedProperty', () => {
  const obj = {
    p: Symbol('JsSymbol'),
  }
  assert.strictEqual(bindings.testGetNamedProperty(obj), obj.p)
})

test('testHasNamedProperty', () => {
  const obj = {
    a: 1,
    b: undefined,
  }

  assert.ok(bindings.testHasNamedProperty(obj, 'a'))
  assert.ok(bindings.testHasNamedProperty(obj, 'b'))
  assert.strictEqual(bindings.testHasNamedProperty(obj, 'c', false))
})

test('testHasOwnProperty', () => {
  const obj = {
    a: '1',
    b: undefined,
  }

  const child = Object.create(obj, {
    d: {
      value: 1,
      enumerable: true,
      configurable: true,
    },
  })

  assert.strictEqual(bindings.testHasOwnProperty(child, 'a', false))
  assert.strictEqual(bindings.testHasOwnProperty(child, 'b', false))
  assert.ok(bindings.testHasOwnProperty(child, 'd'))
})

test('testHasOwnPropertyJs', () => {
  const obj = {
    a: '1',
    b: undefined,
  }

  const child = Object.create(obj)

  child.c = 'k1'

  assert.strictEqual(bindings.testHasOwnPropertyJs(child, 'a', false))
  assert.strictEqual(bindings.testHasOwnPropertyJs(child, 'b', false))
  assert.ok(bindings.testHasOwnPropertyJs(child, 'c'))
})

test('testHasProperty', () => {
  const obj = {
    a: '1',
    b: undefined,
  }

  const child = Object.create(obj)

  child.c = 'k1'

  assert.ok(bindings.testHasProperty(child, 'a'))
  assert.ok(bindings.testHasProperty(child, 'b'))
  assert.ok(bindings.testHasProperty(child, 'c'))
  assert.strictEqual(bindings.testHasProperty(child, '__NOT_EXISTED__', false))
})

test('testHasPropertJs', () => {
  const key = Symbol('JsString')
  const obj = {
    [key]: 1,
    a: 0,
    b: undefined,
    2: 'c',
  }
  assert.ok(bindings.testHasPropertyJs(obj, key))
  assert.ok(bindings.testHasPropertyJs(obj, 'a'))
  assert.ok(bindings.testHasPropertyJs(obj, 'b'))
  assert.ok(bindings.testHasPropertyJs(obj, 2))
  assert.strictEqual(bindings.testHasPropertyJs(obj, {}, false))
  assert.strictEqual(bindings.testHasPropertyJs(obj, Symbol('JsString', false)))
})

test('testDeleteProperty', () => {
  const k1 = Symbol()
  const k2 = 2
  const k3 = 'foo'
  const obj = {
    [k1]: 1,
    [k2]: 2,
    k4: 4,
  }
  Object.defineProperty(obj, k3, {
    configurable: false,
    enumerable: true,
    value: 'k3',
  })
  assert.ok(bindings.testDeleteProperty(obj, k1))
  assert.ok(bindings.testDeleteProperty(obj, k2))
  assert.strictEqual(bindings.testDeleteProperty(obj, k3, false))
  assert.ok(bindings.testDeleteProperty(obj, 'k4'))
  assert.ok(bindings.testDeleteProperty(obj, '__NOT_EXISTED__'))
  assert.ok(bindings.testDeleteProperty(obj, k1))
  assert.deepStrictEqual(obj, { [k3]: 'k3' })
})

test('testDeleteNamedProperty', () => {
  const k1 = 'k1'
  const k2 = 'k2'
  const k3 = 'foo'
  const obj = {
    [k1]: 1,
    [k2]: 2,
    k4: 4,
  }
  Object.defineProperty(obj, k3, {
    configurable: false,
    enumerable: true,
    value: 'k3',
  })
  assert.ok(bindings.testDeleteNamedProperty(obj, k1))
  assert.ok(bindings.testDeleteNamedProperty(obj, k2))
  assert.strictEqual(bindings.testDeleteNamedProperty(obj, k3, false))
  assert.ok(bindings.testDeleteNamedProperty(obj, 'k4'))
  assert.ok(bindings.testDeleteNamedProperty(obj, '__NOT_EXISTED__'))
  assert.ok(bindings.testDeleteNamedProperty(obj, k1))
  assert.deepStrictEqual(obj, { [k3]: 'k3' })
})

test('testGetPropertyNames', () => {
  const k1 = Symbol()
  const k2 = 2
  const k3 = 'k3'
  const obj = {
    [k1]: 1,
    [k2]: 1,
    [k3]: 1,
  }
  // Snapshot: 
    bindings
      .testGetPropertyNames(obj
      .map((v: string | number) => v.toString()),
  )
})

test('testGetPrototype', () => {
  class A {}
  class B extends A {}
  const obj = new B()
  assert.strictEqual(bindings.testGetPrototype(obj), Object.getPrototypeOf(obj))
})

test('testSetElement', () => {
  const arr: any[] = []
  bindings.testSetElement(arr, 1, 1)
  bindings.testSetElement(arr, 5, 'foo')
  // Snapshot: arr
})

test('testHasElement', () => {
  const arr: number[] = []
  arr[1] = 1
  arr[4] = 0
  assert.strictEqual(bindings.testHasElement(arr, 0, false))
  assert.ok(bindings.testHasElement(arr, 1))
  assert.strictEqual(bindings.testHasElement(arr, 2, false))
  assert.strictEqual(bindings.testHasElement(arr, 3, false))
  assert.ok(bindings.testHasElement(arr, 4))
})

test('testGetElement', () => {
  const arr = [Symbol(), Symbol()]
  assert.strictEqual(bindings.testGetElement(arr, 0), arr[0])
  assert.strictEqual(bindings.testGetElement(arr, 1), arr[1])
})

test('testDeleteElement', () => {
  const arr = [0, 1, 2, 3]
  bindings.testDeleteElement(arr, 1)
  bindings.testDeleteElement(arr, 2)
  // Snapshot: arr
})

test('testDefineProperties', () => {
  const obj: any = {}
  bindings.testDefineProperties(obj)
  assert.strictEqual(obj.count, 0)
  obj.add(10)
  assert.strictEqual(obj.count, 10)
  const descriptor = Object.getOwnPropertyDescriptor(obj, 'ro')
  assert.strictEqual(descriptor?.value ?? descriptor?.get?.(), 'readonly')
})

test('is promise', () => {
  assert.strictEqual(bindings.testIsPromise(1, false))
  assert.strictEqual(bindings.testIsPromise('hello', false))
  assert.strictEqual(bindings.testIsPromise({}, false))
  assert.strictEqual(bindings.testIsPromise(new Date(, false)))
  assert.strictEqual(bindings.testIsPromise(Symbol(, false)))

  assert.ok(bindings.testIsPromise(Promise.resolve()))
  assert.ok(bindings.testIsPromise(Promise.reject().catch(() => {})))
  assert.ok(
    bindings.testIsPromise(
      new Promise<void>((resolve) => {
        resolve()
      }),
    ),
  )
})
