import { join } from 'path'

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
  ClassWithFactory,
  CustomNumEnum,
  Context,
  enumToI32,
  listObjKeys,
  createObj,
  mapOption,
  readFile,
  throwError,
  readPackageJson,
  getPackageJsonName,
  getBuffer,
  readFileAsync,
  eitherStringOrNumber,
  returnEither,
  either3,
  either4,
  withoutAbortController,
  withAbortController,
  asyncMultiTwo,
  bigintAdd,
  createBigInt,
  createBigIntI64,
} from '../'

test('number', (t) => {
  t.is(add(1, 2), 3)
  t.is(fibonacci(5), 5)

  t.throws(
    // @ts-expect-error
    () => fibonacci(''),
    null,
    'Expect value to be Number, but received String',
  )
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

test('class factory', (t) => {
  const duck = ClassWithFactory.withName('Default')
  t.is(duck.name, 'Default')

  duck.name = '周黑鸭'
  t.is(duck.name, '周黑鸭')

  const doge = Animal.withKind(Kind.Dog)
  t.is(doge.name, 'Default')

  doge.name = '旺财'
  t.is(doge.name, '旺财')
})

test('class constructor return Result', (t) => {
  const c = new Context()
  t.is(c.method(), 'not empty')
})

test('class Factory return Result', (t) => {
  const c = Context.withData('not empty')
  t.is(c.method(), 'not empty')
})

test('callback', (t) => {
  getCwd((cwd) => {
    t.is(cwd, process.cwd())
  })

  t.throws(
    // @ts-expect-error
    () => getCwd(),
    null,
    'Expect value to be Function, but received Undefined',
  )

  readFile((err, content) => {
    t.is(err, undefined)
    t.is(content, 'hello world')
  })
})

test('object', (t) => {
  t.deepEqual(listObjKeys({ name: 'John Doe', age: 20 }), ['name', 'age'])
  t.deepEqual(createObj(), { test: 1 })
})

test('Option', (t) => {
  t.is(mapOption(null), null)
  t.is(mapOption(3), 4)
})

test('Result', (t) => {
  t.throws(() => throwError(), null, 'Manual Error')
})

test('serde-json', (t) => {
  const packageJson = readPackageJson()
  t.is(packageJson.name, 'napi-rs')
  t.is(packageJson.version, '0.0.0')
  t.is(packageJson.dependencies, null)
  t.snapshot(Object.keys(packageJson.devDependencies!).sort())

  t.is(getPackageJsonName(packageJson), 'napi-rs')
})

test('buffer', (t) => {
  t.is(getBuffer().toString('utf-8'), 'Hello world')
})

test('async', async (t) => {
  const bufPromise = readFileAsync(join(__dirname, '../package.json'))
  await t.notThrowsAsync(bufPromise)
  const buf = await bufPromise
  const { name } = JSON.parse(buf.toString())
  t.is(name, 'napi-examples')

  await t.throwsAsync(() => readFileAsync('some_nonexist_path.file'))
})

test('async move', async (t) => {
  t.is(await asyncMultiTwo(2), 4)
})

test('either', (t) => {
  t.is(eitherStringOrNumber(2), 2)
  t.is(eitherStringOrNumber('hello'), 'hello'.length)
})

test('return either', (t) => {
  t.is(returnEither(2), 2)
  t.is(returnEither(42), '42')
})

test('either3', (t) => {
  t.is(either3(2), 2)
  t.is(either3('hello'), 'hello'.length)
  t.is(either3(true), 1)
  t.is(either3(false), 0)
})

test('either4', (t) => {
  t.is(either4(2), 2)
  t.is(either4('hello'), 'hello'.length)
  t.is(either4(true), 1)
  t.is(either4(false), 0)
  t.is(either4({ v: 1 }), 1)
  t.is(either4({ v: 'world' }), 'world'.length)
})

test('async task without abort controller', async (t) => {
  t.is(await withoutAbortController(1, 2), 3)
})

const MaybeTest = typeof AbortController !== 'undefined' ? test : test.skip

MaybeTest('async task with abort controller', async (t) => {
  const ctrl = new AbortController()
  const promise = withAbortController(1, 2, ctrl.signal)
  try {
    ctrl.abort()
    await promise
    t.fail('Should throw AbortError')
  } catch (err: unknown) {
    t.is((err as Error).message, 'AbortError')
  }
})

MaybeTest('abort resolved task', async (t) => {
  const ctrl = new AbortController()
  await withAbortController(1, 2, ctrl.signal).then(() => ctrl.abort())
  t.pass('should not throw')
})

const BigIntTest = typeof BigInt !== 'undefined' ? test : test.skip

BigIntTest('BigInt add', (t) => {
  t.is(bigintAdd(BigInt(1), BigInt(2)), BigInt(3))
})

BigIntTest('create BigInt', (t) => {
  t.is(createBigInt(), BigInt('-3689348814741910323300'))
})

BigIntTest('create BigInt i64', (t) => {
  t.is(createBigIntI64(), BigInt(100))
})
