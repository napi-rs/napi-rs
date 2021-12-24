import { exec } from 'child_process'
import { join } from 'path'

import test from 'ava'

import {
  DEFAULT_COST,
  add,
  fibonacci,
  contains,
  concatLatin1,
  concatStr,
  concatUtf16,
  getNums,
  getWords,
  sumNums,
  getMapping,
  sumMapping,
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
  callThreadsafeFunction,
  threadsafeFunctionThrowError,
  asyncPlus100,
  getGlobal,
  getUndefined,
  getNull,
  setSymbolInObj,
  createSymbol,
  threadsafeFunctionFatalMode,
  createExternal,
  getExternal,
  mutateExternal,
  createExternalString,
  xxh2,
  xxh3,
  xxh64Alias,
  tsRename,
  convertU32Array,
  createExternalTypedArray,
  mutateTypedArray,
  receiveAllOptionalObject,
  fnReceivedAliased,
  ALIAS,
  AliasedStruct,
  appendBuffer,
  returnNull,
  returnUndefined,
  Dog,
  Bird,
} from '../'

test('export const', (t) => {
  t.is(DEFAULT_COST, 12)
})

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

test('map', (t) => {
  t.deepEqual(getMapping(), { a: 101, b: 102 })
  t.is(sumMapping({ a: 101, b: 102 }), 203)
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
  t.deepEqual(dog.returnOtherClass(), new Dog('Doge'))
  t.deepEqual(dog.returnOtherClassWithCustomConstructor(), new Bird('parrot'))
})

test('class factory', (t) => {
  const duck = ClassWithFactory.withName('Default')
  t.is(duck.name, 'Default')

  const ret = duck.setName('D')
  t.is(ret.name, 'D')
  t.is(ret, duck)

  duck.name = '周黑鸭'
  t.is(duck.name, '周黑鸭')

  const doge = Animal.withKind(Kind.Dog)
  t.is(doge.name, 'Default')

  doge.name = '旺财'
  t.is(doge.name, '旺财')

  const error = t.throws(() => new ClassWithFactory())
  t.true(
    error.message.startsWith(
      'Class contains no `constructor`, can not new it!',
    ),
  )
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

test('global', (t) => {
  t.is(getGlobal(), global)
})

test('get undefined', (t) => {
  for (const _ of Array.from({ length: 100 })) {
    t.is(getUndefined(), undefined)
  }
})

test('get null', (t) => {
  for (const _ of Array.from({ length: 100 })) {
    t.is(getNull(), null)
  }
})

test('return Null', (t) => {
  t.is(returnNull(), null)
})

test('return Undefined', (t) => {
  t.is(returnUndefined(), undefined)
})

test('pass symbol in', (t) => {
  const sym = Symbol('test')
  const obj = setSymbolInObj(sym)
  t.is(obj[sym], 'a symbol')
})

test('create symbol', (t) => {
  t.is(createSymbol().toString(), 'Symbol(a symbol)')
})

test('Option', (t) => {
  t.is(mapOption(null), null)
  t.is(mapOption(3), 4)
})

test('Result', (t) => {
  t.throws(() => throwError(), null, 'Manual Error')
})

test('function ts type override', (t) => {
  t.deepEqual(tsRename({ foo: 1, bar: 2, baz: 2 }), ['foo', 'bar', 'baz'])
})

test('option object', (t) => {
  t.notThrows(() => receiveAllOptionalObject())
  t.notThrows(() => receiveAllOptionalObject({}))
})

test('aliased rust struct and enum', (t) => {
  const a: ALIAS = ALIAS.A
  const b: AliasedStruct = {
    a,
    b: 1,
  }
  t.notThrows(() => fnReceivedAliased(b, ALIAS.B))
})

test('serde-json', (t) => {
  const packageJson = readPackageJson()
  t.is(packageJson.name, 'napi-rs')
  t.is(packageJson.version, '0.0.0')
  t.is(packageJson.dependencies, undefined)
  t.snapshot(Object.keys(packageJson.devDependencies!).sort())

  t.is(getPackageJsonName(packageJson), 'napi-rs')
})

test('buffer', (t) => {
  let buf = getBuffer()
  t.is(buf.toString('utf-8'), 'Hello world')
  buf = appendBuffer(buf)
  t.is(buf.toString('utf-8'), 'Hello world!')
})

test('convert typedarray to vec', (t) => {
  const input = new Uint32Array([1, 2, 3, 4, 5])
  t.deepEqual(convertU32Array(input), Array.from(input))
})

test('create external TypedArray', (t) => {
  t.deepEqual(createExternalTypedArray(), new Uint32Array([1, 2, 3, 4, 5]))
})

test('mutate TypedArray', (t) => {
  const input = new Float32Array([1, 2, 3, 4, 5])
  mutateTypedArray(input)
  t.deepEqual(input, new Float32Array([2.0, 4.0, 6.0, 8.0, 10.0]))
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

test('external', (t) => {
  const FX = 42
  const ext = createExternal(FX)
  t.is(getExternal(ext), FX)
  mutateExternal(ext, FX + 1)
  t.is(getExternal(ext), FX + 1)
  // @ts-expect-error
  t.throws(() => getExternal({}))
  const ext2 = createExternalString('wtf')
  // @ts-expect-error
  const e = t.throws(() => getExternal(ext2))
  t.is(e.message, 'T on `get_value_external` is not the type of wrapped object')
})

const AbortSignalTest =
  typeof AbortController !== 'undefined' ? test : test.skip

AbortSignalTest('async task without abort controller', async (t) => {
  t.is(await withoutAbortController(1, 2), 3)
})

AbortSignalTest('async task with abort controller', async (t) => {
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

AbortSignalTest('abort resolved task', async (t) => {
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

BigIntTest('js mod test', (t) => {
  t.is(xxh64Alias(Buffer.from('hello world')), BigInt('1116'))
  t.is(xxh3.xxh3_64(Buffer.from('hello world')), BigInt('1116'))
  t.is(xxh3.xxh128(Buffer.from('hello world')), BigInt('1116'))
  t.is(xxh2.xxh2Plus(1, 2), 3)
  t.is(xxh2.xxh3Xxh64Alias(Buffer.from('hello world')), BigInt('1116'))
  t.is(xxh3.ALIGNMENT, 16)
  const xx3 = new xxh3.Xxh3()
  xx3.update(Buffer.from('hello world'))
  t.is(xx3.digest(), BigInt('1116'))
})

const Napi4Test = Number(process.versions.napi) >= 4 ? test : test.skip

Napi4Test('call thread safe function', (t) => {
  let i = 0
  let value = 0
  return new Promise((resolve) => {
    callThreadsafeFunction((err, v) => {
      t.is(err, null)
      i++
      value += v
      if (i === 100) {
        resolve()
        t.is(
          value,
          Array.from({ length: 100 }, (_, i) => i + 1).reduce((a, b) => a + b),
        )
      }
    })
  })
})

Napi4Test('throw error from thread safe function', async (t) => {
  const throwPromise = new Promise((_, reject) => {
    threadsafeFunctionThrowError(reject)
  })
  const err = await t.throwsAsync(throwPromise)
  t.is(err.message, 'ThrowFromNative')
})

Napi4Test('resolve value from thread safe function fatal mode', async (t) => {
  const tsfnFatalMode = new Promise<boolean>((resolve) => {
    threadsafeFunctionFatalMode(resolve)
  })
  t.true(await tsfnFatalMode)
})

Napi4Test('throw error from thread safe function fatal mode', (t) => {
  const p = exec('node ./tsfn-error.js', {
    cwd: __dirname,
  })
  let stderr = Buffer.from([])
  p.stderr?.on('data', (data) => {
    stderr = Buffer.concat([stderr, Buffer.from(data)])
  })
  return new Promise<void>((resolve) => {
    p.on('exit', (code) => {
      t.is(code, 1)
      t.true(
        stderr
          .toString('utf8')
          .includes(`[Error: Generic tsfn error] { code: 'GenericFailure' }`),
      )
      resolve()
    })
  })
})

Napi4Test('await Promise in rust', async (t) => {
  const fx = 20
  const result = await asyncPlus100(
    new Promise((resolve) => {
      setTimeout(() => resolve(fx), 50)
    }),
  )
  t.is(result, fx + 100)
})

Napi4Test('Promise should reject raw error in rust', async (t) => {
  const fxError = new Error('What is Happy Planet')
  const err = await t.throwsAsync(() => asyncPlus100(Promise.reject(fxError)))
  t.is(err, fxError)
})
