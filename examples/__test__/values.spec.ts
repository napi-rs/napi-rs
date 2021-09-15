import test from 'ava'

import {
  add,
  fibonacci,
  contains,
  concatLatin1,
  concatStr,
  concatUtf16,
  getNums,
  getWords,
  sumNums,
  getCwd,
  Animal,
  Kind,
  CustomNumEnum,
  enumToI32,
  listObjKeys,
  createObj,
} from '../'

test('number', (t) => {
  t.is(add(1, 2), 3)
  t.is(fibonacci(5), 5)
})

test('string', (t) => {
  t.true(contains('hello', 'ell'))
  t.false(contains('John', 'jn'))

  t.is(concatStr('æ¶½¾DEL'), 'æ¶½¾DEL + Rust 🦀 string!')
  t.is(concatLatin1('æ¶½¾DEL'), 'æ¶½¾DEL + Rust 🦀 string!')
  t.is(
    concatUtf16('JavaScript 🌳 你好 napi'),
    'JavaScript 🌳 你好 napi + Rust 🦀 string!',
  )
})

test('array', (t) => {
  t.deepEqual(getNums(), [1, 1, 2, 3, 5, 8])
  t.deepEqual(getWords(), ['foo', 'bar'])

  t.is(sumNums([1, 2, 3, 4, 5]), 15)
})

test('enum', (t) => {
  t.deepEqual([Kind.Dog, Kind.Cat, Kind.Duck], [0, 1, 2])
  t.is(enumToI32(CustomNumEnum.Eight), 8)
})

test('class', (t) => {
  const dog = new Animal(Kind.Dog, '旺财')

  t.is(dog.name, '旺财')
  t.is(dog.kind, Kind.Dog)
  t.is(dog.whoami(), 'Dog: 旺财')

  dog.name = '可乐'
  t.is(dog.name, '可乐')
})

test('callback', (t) => {
  getCwd((cwd) => {
    t.is(cwd, process.cwd())
  })
})

test('object', (t) => {
  t.deepEqual(listObjKeys({ name: 'John Doe', age: 20 }), ['name', 'age'])
  t.deepEqual(createObj(), { test: 1 })
})
