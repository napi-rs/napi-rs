import test from 'ava'

const bindings = require('../index.node')

test('setProperty', (t) => {
  const obj = {}
  const key = 'jsPropertyKey'
  bindings.testSetProperty(obj, key)
  // @ts-expect-error
  t.snapshot(obj[key])
})

test('testGetProperty', (t) => {
  const name = Symbol('JsSymbol')
  const value = Symbol('JsValue')
  const obj = {
    [name]: value,
  }
  t.is(bindings.testGetProperty(obj, name), value)
})

test('setNamedProperty', (t) => {
  const obj = {}
  const property = Symbol('JsSymbol')
  bindings.testSetNamedProperty(obj, property)
  const keys = Object.keys(obj)
  const [key] = keys
  t.is(keys.length, 1)
  t.snapshot(key)
  // @ts-expect-error
  t.is(obj[key], property)
})

test('testGetNamedProperty', (t) => {
  const obj = {
    p: Symbol('JsSymbol'),
  }
  t.is(bindings.testGetNamedProperty(obj), obj.p)
})

test('testHasNamedProperty', (t) => {
  const obj = {
    a: 1,
    b: undefined,
  }

  t.true(bindings.testHasNamedProperty(obj, 'a'))
  t.true(bindings.testHasNamedProperty(obj, 'b'))
  t.false(bindings.testHasNamedProperty(obj, 'c'))
})

test('testHasOwnProperty', (t) => {
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

  t.false(bindings.testHasOwnProperty(child, 'a'))
  t.false(bindings.testHasOwnProperty(child, 'b'))
  t.true(bindings.testHasOwnProperty(child, 'd'))
})

test('testHasOwnPropertyJs', (t) => {
  const obj = {
    a: '1',
    b: undefined,
  }

  const child = Object.create(obj)

  child.c = 'k1'

  t.false(bindings.testHasOwnPropertyJs(child, 'a'))
  t.false(bindings.testHasOwnPropertyJs(child, 'b'))
  t.true(bindings.testHasOwnPropertyJs(child, 'c'))
})

test('testHasProperty', (t) => {
  const obj = {
    a: '1',
    b: undefined,
  }

  const child = Object.create(obj)

  child.c = 'k1'

  t.true(bindings.testHasProperty(child, 'a'))
  t.true(bindings.testHasProperty(child, 'b'))
  t.true(bindings.testHasProperty(child, 'c'))
  t.false(bindings.testHasProperty(child, '__NOT_EXISTED__'))
})

test('testHasPropertJs', (t) => {
  const key = Symbol('JsString')
  const obj = {
    [key]: 1,
    a: 0,
    b: undefined,
    2: 'c',
  }
  t.true(bindings.testHasPropertyJs(obj, key))
  t.true(bindings.testHasPropertyJs(obj, 'a'))
  t.true(bindings.testHasPropertyJs(obj, 'b'))
  t.true(bindings.testHasPropertyJs(obj, 2))
  t.false(bindings.testHasPropertyJs(obj, {}))
  t.false(bindings.testHasPropertyJs(obj, Symbol('JsString')))
})

test('testDeleteProperty', (t) => {
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
  t.true(bindings.testDeleteProperty(obj, k1))
  t.true(bindings.testDeleteProperty(obj, k2))
  t.false(bindings.testDeleteProperty(obj, k3))
  t.true(bindings.testDeleteProperty(obj, 'k4'))
  t.true(bindings.testDeleteProperty(obj, '__NOT_EXISTED__'))
  t.true(bindings.testDeleteProperty(obj, k1))
  t.deepEqual(obj, { [k3]: 'k3' })
})

test('testDeleteNamedProperty', (t) => {
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
  t.true(bindings.testDeleteNamedProperty(obj, k1))
  t.true(bindings.testDeleteNamedProperty(obj, k2))
  t.false(bindings.testDeleteNamedProperty(obj, k3))
  t.true(bindings.testDeleteNamedProperty(obj, 'k4'))
  t.true(bindings.testDeleteNamedProperty(obj, '__NOT_EXISTED__'))
  t.true(bindings.testDeleteNamedProperty(obj, k1))
  t.deepEqual(obj, { [k3]: 'k3' })
})

test('testGetPropertyNames', (t) => {
  const k1 = Symbol()
  const k2 = 2
  const k3 = 'k3'
  const obj = {
    [k1]: 1,
    [k2]: 1,
    [k3]: 1,
  }
  t.snapshot(
    bindings
      .testGetPropertyNames(obj)
      .map((v: string | number) => v.toString()),
  )
})

test('testGetPrototype', (t) => {
  class A {}
  class B extends A {}
  const obj = new B()
  t.is(bindings.testGetPrototype(obj), Object.getPrototypeOf(obj))
})

test('testSetElement', (t) => {
  const arr: any[] = []
  bindings.testSetElement(arr, 1, 1)
  bindings.testSetElement(arr, 5, 'foo')
  t.snapshot(arr)
})

test('testHasElement', (t) => {
  const arr: number[] = []
  arr[1] = 1
  arr[4] = 0
  t.false(bindings.testHasElement(arr, 0))
  t.true(bindings.testHasElement(arr, 1))
  t.false(bindings.testHasElement(arr, 2))
  t.false(bindings.testHasElement(arr, 3))
  t.true(bindings.testHasElement(arr, 4))
})

test('testGetElement', (t) => {
  const arr = [Symbol(), Symbol()]
  t.is(bindings.testGetElement(arr, 0), arr[0])
  t.is(bindings.testGetElement(arr, 1), arr[1])
})

test('testDeleteElement', (t) => {
  const arr = [0, 1, 2, 3]
  bindings.testDeleteElement(arr, 1)
  bindings.testDeleteElement(arr, 2)
  t.snapshot(arr)
})

test('testDefineProperties', (t) => {
  const obj: any = {}
  bindings.testDefineProperties(obj)
  t.is(obj.count, 0)
  obj.add(10)
  t.is(obj.count, 10)
  const descriptor = Object.getOwnPropertyDescriptor(obj, 'ro')
  t.is(descriptor?.value ?? descriptor?.get?.(), 'readonly')
})

test('is promise', (t) => {
  t.false(bindings.testIsPromise(1))
  t.false(bindings.testIsPromise('hello'))
  t.false(bindings.testIsPromise({}))
  t.false(bindings.testIsPromise(new Date()))
  t.false(bindings.testIsPromise(Symbol()))

  t.true(bindings.testIsPromise(Promise.resolve()))
  t.true(bindings.testIsPromise(Promise.reject().catch(() => {})))
  t.true(
    bindings.testIsPromise(
      new Promise<void>((resolve) => {
        resolve()
      }),
    ),
  )
})
