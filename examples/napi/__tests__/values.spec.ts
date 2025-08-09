import { Buffer } from 'node:buffer'
import { exec } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createReadStream } from 'node:fs'
import { readFile as nodeReadFile } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { Subject, take } from 'rxjs'
import Sinon, { spy } from 'sinon'

import 'core-js/features/promise/with-resolvers.js'

import {
  DEFAULT_COST,
  add,
  fibonacci,
  call0,
  call1,
  call2,
  apply0,
  apply1,
  callFunction,
  callFunctionWithArg,
  callFunctionWithArgAndCtx,
  createReferenceOnFunction,
  referenceAsCallback,
  contains,
  concatLatin1,
  concatStr,
  concatUtf16,
  roundtripStr,
  getNums,
  getWords,
  getTuple,
  getMapping,
  sumMapping,
  sumNums,
  getBtreeMapping,
  sumBtreeMapping,
  getIndexMapping,
  sumIndexMapping,
  indexmapPassthrough,
  passSetToJs,
  passSetToRust,
  btreeSetToJs,
  btreeSetToRust,
  getCwd,
  Animal,
  Kind,
  NinjaTurtle,
  ClassWithFactory,
  CustomNumEnum,
  Context,
  GetterSetterWithClosures,
  enumToI32,
  listObjKeys,
  createObj,
  mapOption,
  readFile,
  throwError,
  throwErrorWithCause,
  jsErrorCallback,
  customStatusCode,
  panic,
  readPackageJson,
  PackageJsonReader,
  getPackageJsonName,
  getBuffer,
  getEmptyBuffer,
  getEmptyTypedArray,
  asyncBufferToArray,
  readFileAsync,
  eitherStringOrNumber,
  returnEither,
  either3,
  either4,
  eitherPromiseInEitherA,
  eitherF64OrU32,
  withoutAbortController,
  withAbortController,
  asyncTaskReadFile,
  asyncTaskOptionalReturn,
  asyncTaskFinally,
  asyncResolveArray,
  asyncMultiTwo,
  bigintAdd,
  createBigInt,
  createBigIntI64,
  bigintGetU64AsString,
  callThreadsafeFunction,
  threadsafeFunctionThrowError,
  threadsafeFunctionThrowErrorWithStatus,
  threadsafeFunctionBuildThrowErrorWithStatus,
  threadsafeFunctionClosureCapture,
  tsfnCallWithCallback,
  tsfnAsyncCall,
  tsfnThrowFromJs,
  asyncPlus100,
  getGlobal,
  getUndefined,
  getNull,
  setSymbolInObj,
  createSymbol,
  createSymbolFor,
  createSymbolRef,
  threadsafeFunctionFatalMode,
  createExternal,
  getExternal,
  mutateExternal,
  createExternalString,
  createExternalRef,
  xxh2,
  xxh3,
  xxh64Alias,
  tsRename,
  acceptArraybuffer,
  acceptSlice,
  u8ArrayToArray,
  i8ArrayToArray,
  u16ArrayToArray,
  i16ArrayToArray,
  u32ArrayToArray,
  i32ArrayToArray,
  u64ArrayToArray,
  i64ArrayToArray,
  f32ArrayToArray,
  f64ArrayToArray,
  acceptUint8ClampedSlice,
  acceptUint8ClampedSliceAndBufferSlice,
  convertU32Array,
  createExternalTypedArray,
  mutateTypedArray,
  receiveAllOptionalObject,
  objectGetNamedPropertyShouldPerformTypecheck,
  fnReceivedAliased,
  ALIAS,
  appendBuffer,
  returnNull,
  returnUndefined,
  Dog,
  Bird,
  Assets,
  receiveStrictObject,
  receiveClassOrNumber,
  JsClassForEither,
  receiveMutClassOrNumber,
  getStrFromObject,
  testSerdeRoundtrip,
  testSerdeBigNumberPrecision,
  testSerdeBufferBytes,
  getBigintJsonValue,
  createObjWithProperty,
  receiveObjectOnlyFromJs,
  dateToNumber,
  chronoUtcDateToMillis,
  chronoLocalDateToMillis,
  chronoDateWithTimezoneToMillis,
  chronoDateFixtureReturn1,
  chronoDateFixtureReturn2,
  derefUint8Array,
  chronoDateAdd1Minute,
  bufferPassThrough,
  arrayBufferPassThrough,
  JsRepo,
  JsRemote,
  CssStyleSheet,
  CatchOnConstructor,
  CatchOnConstructor2,
  asyncReduceBuffer,
  callbackReturnPromise,
  callbackReturnPromiseAndSpawn,
  returnEitherClass,
  eitherFromOption,
  eitherFromObjects,
  overrideIndividualArgOnFunction,
  overrideIndividualArgOnFunctionWithCbArg,
  createObjectWithClassField,
  receiveObjectWithClassField,
  AnotherClassForEither,
  receiveDifferentClass,
  getNumArr,
  getNestedNumArr,
  CustomFinalize,
  plusOne,
  Width,
  captureErrorInCallback,
  bigintFromI128,
  bigintFromI64,
  acceptThreadsafeFunction,
  acceptThreadsafeFunctionFatal,
  acceptThreadsafeFunctionTupleArgs,
  promiseInEither,
  runScript,
  tsfnReturnPromise,
  tsfnReturnPromiseTimeout,
  returnFromSharedCrate,
  chronoNativeDateTime,
  chronoNativeDateTimeReturn,
  throwAsyncError,
  getModuleFileName,
  throwSyntaxError,
  type AliasedStruct,
  returnObjectOnlyToJs,
  buildThreadsafeFunctionFromFunction,
  buildThreadsafeFunctionFromFunctionCalleeHandle,
  createOptionalExternal,
  getOptionalExternal,
  mutateOptionalExternal,
  panicInAsync,
  CustomStruct,
  ClassWithLifetime,
  uInit8ArrayFromString,
  callThenOnPromise,
  callCatchOnPromise,
  callFinallyOnPromise,
  StructuredKind,
  validateStructuredEnum,
  createArraybuffer,
  getBufferSlice,
  createExternalBufferSlice,
  createBufferSliceFromCopiedData,
  Reader,
  withinAsyncRuntimeIfAvailable,
  errorMessageContainsNullByte,
  returnCString,
  receiveBufferSliceWithLifetime,
  generateFunctionAndCallIt,
  getMyVec,
  setNullByteProperty,
  getNullByteProperty,
  receiveBindingVitePluginMeta,
  createObjectRef,
  objectWithCApis,
  getMappingWithHasher,
  getIndexMappingWithHasher,
  passSetWithHasherToJs,
  Rule,
  callRuleHandler,
  acceptStream,
  createReadableStream,
  createReadableStreamWithObject,
  createReadableStreamFromClass,
  spawnThreadInThread,
  esmResolve,
  mergeTupleArray,
  TupleToArray,
  ClassInArray,
  getClassFromArray,
  extendsJavascriptError,
  shutdownRuntime,
  callAsyncWithUnknownReturnValue,
  shorterScope,
  shorterEscapableScope,
  tsfnThrowFromJsCallbackContainsTsfn,
  MyJsNamedClass,
  JSOnlyMethodsClass,
  RustOnlyMethodsClass,
  OriginalRustNameForJsNamedStruct,
  ComplexClass,
  createUint8ClampedArrayFromData,
  arrayBufferFromData,
  uint8ArrayFromData,
  createUint8ClampedArrayFromExternal,
  uint8ArrayFromExternal,
  Thing,
  ThingList,
  createFunction,
  spawnFutureLifetime,
  promiseRawReturnClassInstance,
  ClassReturnInPromise,
  acceptUntypedTypedArray,
  defineClass,
  callbackInSpawn,
  arrayParams,
} from '../index.cjs'
// import other stuff in `#[napi(module_exports)]`
import nativeAddon from '../index.cjs'

import { test } from './test.framework.js'

const __dirname = join(fileURLToPath(import.meta.url), '..')

const Napi4Test = Number(process.versions.napi) >= 4 ? test : test.skip

test.after(() => {
  shutdownRuntime()
})

test('export const', (t) => {
  t.is(DEFAULT_COST, 12)
})

test('number', (t) => {
  t.is(add(1, 2), 3)
  t.is(fibonacci(5), 5)

  t.throws(
    // @ts-expect-error
    () => fibonacci(''),
    void 0,
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
  t.is(
    roundtripStr('what up?!\u0000after the NULL'),
    'what up?!\u0000after the NULL',
  )
  t.is(returnCString(), 'Hello from C string!')
})

test('array', (t) => {
  t.deepEqual(getNums(), [1, 1, 2, 3, 5, 8])
  t.deepEqual(getWords(), ['foo', 'bar'])
  t.deepEqual(getTuple([1, 'test', 2]), 3)

  t.is(sumNums([1, 2, 3, 4, 5]), 15)
  t.deepEqual(getNumArr(), [1, 2])
  t.deepEqual(getNestedNumArr(), [[[1]], [[1]]])
})

test('map', (t) => {
  t.deepEqual(getMapping(), { a: 101, b: 102, '\0c': 103 })
  t.deepEqual(getMappingWithHasher(), { a: 101, b: 102 })
  t.is(sumMapping({ a: 101, b: 102, '\0c': 103 }), 306)
  t.deepEqual(getBtreeMapping(), { a: 101, b: 102, '\0c': 103 })
  t.is(sumBtreeMapping({ a: 101, b: 102, '\0c': 103 }), 306)
  t.deepEqual(getIndexMapping(), { a: 101, b: 102, '\0c': 103 })
  t.deepEqual(getIndexMappingWithHasher(), { a: 101, b: 102 })
  t.is(sumIndexMapping({ a: 101, b: 102, '\0c': 103 }), 306)
  t.deepEqual(indexmapPassthrough({ a: 101, b: 102, '\0c': 103 }), {
    a: 101,
    b: 102,
    '\0c': 103,
  })
})

test('set', (t) => {
  t.notThrows(() => {
    passSetToRust(new Set(['a', 'b', 'c']))
    btreeSetToRust(new Set(['a', 'b', 'c']))
  })
  t.deepEqual(Array.from(passSetToJs()).sort(), ['a', 'b', 'c'])
  t.deepEqual(Array.from(passSetWithHasherToJs()).sort(), ['a', 'b', 'c'])
  t.deepEqual(Array.from(btreeSetToJs()).sort(), ['a', 'b', 'c'])
})

test('enum', (t) => {
  t.deepEqual([Kind.Dog, Kind.Cat, Kind.Duck], [0, 1, 2])
  t.is(enumToI32(CustomNumEnum.Eight), 8)
})

test('structured enum', (t) => {
  const hello: StructuredKind = {
    type2: 'Hello',
  }
  const greeting: StructuredKind = {
    type2: 'Greeting',
    name: 'Napi-rs',
  }
  const birthday: StructuredKind = {
    type2: 'Birthday',
    name: 'Napi-rs',
    age: 10,
  }
  const tuple: StructuredKind = {
    type2: 'Tuple',
    field0: 1,
    field1: 2,
  }
  t.deepEqual(hello, validateStructuredEnum(hello))
  t.deepEqual(greeting, validateStructuredEnum(greeting))
  t.deepEqual(birthday, validateStructuredEnum(birthday))
  t.deepEqual(tuple, validateStructuredEnum(tuple))
  t.throws(() => validateStructuredEnum({ type2: 'unknown' } as any))
  t.throws(() => validateStructuredEnum({ type2: 'Greeting' } as any))
})

test('function call', async (t) => {
  t.is(
    call0((...args) => {
      console.error(args)
      t.is(args.length, 0)
      return 42
    }),
    42,
  )
  t.is(
    call1((a) => a + 10, 42),
    52,
  )
  t.is(
    call2((a, b) => a + b, 42, 10),
    52,
  )
  const ctx = new Animal(Kind.Dog, '旺财')
  apply0(ctx, function (this: Animal) {
    this.name = '可乐'
  })
  t.is(ctx.name, '可乐')
  const ctx2 = new Animal(Kind.Dog, '旺财')
  apply1(
    ctx2,
    function (this: Animal, name: string) {
      this.name = name
    },
    '可乐',
  )
  t.is(ctx2.name, '可乐')
  t.is(
    callFunction(() => 42),
    42,
  )
  t.is(
    callFunctionWithArg((a, b) => a + b, 42, 10),
    52,
  )
  const ctx3 = new Animal(Kind.Dog, '旺财')
  callFunctionWithArgAndCtx(
    ctx3,
    function (this: Animal, name: string) {
      this.name = name
    },
    '可乐',
  )
  t.is(ctx3.name, '可乐')
  const cbSpy = spy()
  await createReferenceOnFunction(cbSpy)
  t.is(cbSpy.callCount, 1)
  t.is(
    referenceAsCallback((a, b) => a + b, 42, 10),
    52,
  )
  const fn = createFunction()
  t.is(fn(42), 242)
})

test('class', (t) => {
  const dog = new Animal(Kind.Dog, '旺财')

  t.is(dog.name, '旺财')
  t.is(dog.kind, Kind.Dog)
  t.is(dog.whoami(), 'Dog: 旺财')

  t.notThrows(() => {
    const rawMethod = dog.whoami
    dog.whoami = function (...args) {
      return rawMethod.apply(this, args)
    }
  })

  dog.name = '可乐'
  t.is(dog.name, '可乐')
  t.deepEqual(dog.returnOtherClass(), new Dog('Doge'))
  t.deepEqual(dog.returnOtherClassWithCustomConstructor(), new Bird('parrot'))
  t.is(
    dog.overrideIndividualArgOnMethod('Jafar', { n: 'Iago' }).name,
    'Jafar-Iago',
  )
  t.is(dog.returnOtherClassWithCustomConstructor().getCount(), 1234)
  t.is(dog.type, Kind.Dog)
  dog.type = Kind.Cat
  t.is(dog.type, Kind.Cat)
  const assets = new Assets()
  t.is(assets.get(1)?.filePath, 1)
  const turtle = NinjaTurtle.newRaph()
  t.is(turtle.returnThis(), turtle)
  t.is(NinjaTurtle.isInstanceOf(turtle), true)
  // Inject this to function
  const width = new Width(1)
  t.is(plusOne.call(width), 2)
  t.throws(() => {
    // @ts-expect-error
    plusOne.call('')
  })

  t.notThrows(() => {
    new CatchOnConstructor()
  })

  const classWithLifetime = new ClassWithLifetime()
  t.deepEqual(classWithLifetime.getName(), 'alie')
  t.deepEqual(Object.keys(classWithLifetime), ['inner'])

  if (!process.env.TEST_ZIG_CROSS) {
    t.throws(
      () => {
        new CatchOnConstructor2()
      },
      (() =>
        process.env.WASI_TEST
          ? undefined
          : {
              message: 'CatchOnConstructor2 panic',
            })(),
    )
  }
})

test('class with js_name', (t) => {
  // Test class instantiation and basic functionality
  const instance = new MyJsNamedClass('test_value')
  t.is(instance.getValue(), 'test_value')
  t.is(instance.multiplyValue(3), 'test_valuetest_valuetest_value')

  // Test type alias compatibility - OriginalRustNameForJsNamedStruct should be assignable from MyJsNamedClass
  const instanceForTypeCheck: OriginalRustNameForJsNamedStruct =
    new MyJsNamedClass('type_test')
  t.is(
    instanceForTypeCheck.getValue(),
    'type_test',
    'Type alias OriginalRustNameForJsNamedStruct should be assignable from MyJsNamedClass',
  )
  t.is(
    instanceForTypeCheck.multiplyValue(2),
    'type_testtype_test',
    'Methods should be callable via type alias',
  )

  // Test edge cases
  const emptyInstance = new MyJsNamedClass('')
  t.is(emptyInstance.getValue(), '', 'Should handle empty strings')
  t.is(emptyInstance.multiplyValue(0), '', 'Should handle zero multiplication')

  // Test with special characters
  const specialInstance = new MyJsNamedClass('hello 🚀 world')
  t.is(
    specialInstance.getValue(),
    'hello 🚀 world',
    'Should handle unicode characters',
  )
  t.is(
    specialInstance.multiplyValue(2),
    'hello 🚀 worldhello 🚀 world',
    'Should multiply unicode strings correctly',
  )
})

test('struct with js_name and methods only (no constructor)', (t) => {
  // Test that structs with js_name but no constructor still have their methods in type definitions
  // This was a bug where methods would disappear if there was no constructor/factory method

  // The fact that this test compiles successfully means the type definitions are correct
  // We verify that:
  // 1. JSOnlyMethodsClass is the exported class name (not RustOnlyMethodsClass)
  // 2. RustOnlyMethodsClass is a type alias for JSOnlyMethodsClass
  // 3. Both have the methods processData() and getLength()

  // Test type compatibility - this will fail to compile if types are wrong
  const testTypeCompatibility = (instance: JSOnlyMethodsClass) => {
    // These assignments will cause TypeScript compilation errors if methods are missing
    const processDataFn: () => string = instance.processData
    const getLengthFn: () => number = instance.getLength
    return { processDataFn, getLengthFn }
  }

  // Test type alias compatibility
  const testAliasCompatibility = (instance: RustOnlyMethodsClass) => {
    const processDataFn: () => string = instance.processData
    const getLengthFn: () => number = instance.getLength
    return { processDataFn, getLengthFn }
  }

  // Test that RustOnlyMethodsClass is assignable to JSOnlyMethodsClass
  const mockInstance = { data: 'test' } as JSOnlyMethodsClass
  const aliasInstance: RustOnlyMethodsClass = mockInstance

  // If we get here, the types compiled successfully
  t.pass(
    'Type definitions are correct - js_name struct with methods only works properly',
  )

  // Verify we can call the test functions without compilation errors
  t.notThrows(
    () => testTypeCompatibility(mockInstance),
    'JSOnlyMethodsClass methods should be accessible',
  )
  t.notThrows(
    () => testAliasCompatibility(aliasInstance),
    'RustOnlyMethodsClass alias methods should be accessible',
  )
})

test('define class', (t) => {
  const DynamicRustClass = defineClass()
  const instance = new DynamicRustClass(42)
  t.is(instance.rustMethod(), 42)
})

test('async self in class', async (t) => {
  const b = new Bird('foo')
  t.is(await b.getNameAsync(), 'foo')
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
    error?.message.startsWith(
      'Class contains no `constructor`, can not new it!',
    ),
  )
})

test('async class factory', async (t) => {
  const instance = await ClassWithFactory.with4Name('foo')
  t.is(instance.name, 'foo-4')
  const instance2 = await ClassWithFactory.with4NameResult('foo')
  t.is(instance2.name, 'foo-4')
})

test('class constructor return Result', (t) => {
  const c = new Context()
  t.is(c.method(), 'not empty')
})

test('class default field is TypedArray', (t) => {
  const c = new Context()
  t.deepEqual(c.buffer, new Uint8Array([0, 1, 2, 3]))
  const fixture = new Uint8Array([0, 1, 2, 3, 4, 5, 6])
  const c2 = Context.withBuffer(fixture)
  t.is(c2.buffer, fixture)
})

test('class Factory return Result', (t) => {
  const c = Context.withData('not empty')
  t.is(c.method(), 'not empty')
})

test('class in object field', (t) => {
  const obj = createObjectWithClassField()
  t.is(obj.bird.name, 'Carolyn')
  t.is(receiveObjectWithClassField(obj), obj.bird)
})

test('custom finalize class', (t) => {
  t.notThrows(() => new CustomFinalize(200, 200))
})

test('should be able to create object reference and shared reference', (t) => {
  const repo = new JsRepo('.')
  t.is(repo.remote().name(), 'origin')
  t.is(new JsRemote(repo).name(), 'origin')
})

test('should be able to into_reference', (t) => {
  const rules = ['body: { color: red }', 'div: { color: blue }']
  const sheet = new CssStyleSheet('test.css', rules)
  t.is(sheet.rules, sheet.rules)
  t.deepEqual(sheet.rules.getRules(), rules)
  t.is(sheet.rules.parentStyleSheet, sheet)
  t.is(sheet.rules.name, 'test.css')
  const anotherStyleSheet = sheet.anotherCssStyleSheet()
  t.is(anotherStyleSheet.rules, sheet.rules)
})

test('callback', (t) => {
  if (!process.env.WASI_TEST) {
    getCwd((cwd) => {
      t.is(cwd, process.cwd())
    })
  }

  t.throws(
    // @ts-expect-error
    () => getCwd(),
    void 0,
    'Expect value to be Function, but received Undefined',
  )

  readFile((err, content) => {
    t.is(err, undefined)
    t.is(content, 'hello world')
  })

  captureErrorInCallback(
    () => {
      throw new Error('Testing')
    },
    (err) => {
      t.is((err as Error).message, 'Testing')
    },
  )
})

Napi4Test('callback function return Promise', async (t) => {
  const cbSpy = spy()
  await callbackReturnPromise<string>(() => '1', spy)
  t.is(cbSpy.callCount, 0)
  await callbackReturnPromise(
    () => Promise.resolve('42'),
    (err, res) => {
      t.is(err, null)
      cbSpy(res)
    },
  )
  t.is(cbSpy.callCount, 1)
  t.deepEqual(cbSpy.args, [['42']])
})

Napi4Test('callback function return Promise and spawn', async (t) => {
  const finalReturn = await callbackReturnPromiseAndSpawn((input) =>
    Promise.resolve(`${input} world`),
  )
  t.is(finalReturn, 'Hello world 😼')
})

test('promise', async (t) => {
  const res = await callThenOnPromise(Promise.resolve(1))
  t.is(res, '1')
  const cat = await callCatchOnPromise(Promise.reject('cat'))
  t.is(cat, 'cat')
  const spy = Sinon.spy()
  await callFinallyOnPromise(Promise.resolve(1), spy)
  t.true(spy.calledOnce)
})

test('object', (t) => {
  t.deepEqual(listObjKeys({ name: 'John Doe', age: 20 }), ['name', 'age'])
  t.deepEqual(createObj(), { test: 1 })
  t.throws(
    () =>
      objectGetNamedPropertyShouldPerformTypecheck({
        // @ts-expect-error
        foo: '2',
        bar: '3',
      }),
    {
      message: `Object property 'foo' type mismatch. Expect value to be Number, but received String`,
      code: 'InvalidArg',
    },
  )
  t.throws(
    () =>
      objectGetNamedPropertyShouldPerformTypecheck({
        foo: 2,
        // @ts-expect-error
        bar: 3,
      }),
    {
      message: `Object property 'bar' type mismatch. Expect value to be String, but received Number`,
      code: 'InvalidArg',
    },
  )
  t.notThrows(() =>
    objectGetNamedPropertyShouldPerformTypecheck({
      foo: 2,
      bar: '3',
    }),
  )
  t.deepEqual(returnObjectOnlyToJs(), {
    name: 42,
    dependencies: {
      '@napi-rs/cli': '^3.0.0',
      rollup: '^4.0.0',
    },
  })
  t.throws(
    () =>
      receiveAllOptionalObject({
        // @ts-expect-error
        name: 1,
      }),
    {
      code: 'StringExpected',
      message:
        'Failed to convert JavaScript value `Number 1 ` into rust type `String` on AllOptionalObject.name',
    },
  )

  t.is(receiveBufferSliceWithLifetime({ data: 'foo' }), 3)
  t.is(receiveBufferSliceWithLifetime({ data: Buffer.from('barz') }), 4)

  const data = generateFunctionAndCallIt()
  t.is(data.handle(), 1)

  const objNull: any = {}
  setNullByteProperty(objNull)
  t.is(objNull['\0virtual'], 'test')
  t.is(getNullByteProperty(objNull), 'test')
  t.notThrows(() =>
    receiveBindingVitePluginMeta({
      'vite:import-glob': {
        isSubImportsPattern: true,
      },
    }),
  )
  const objRef = createObjectRef()
  // @ts-expect-error
  t.is(objRef.test, 1)

  t.notThrows(() => {
    const obj = objectWithCApis()
    // @ts-expect-error
    t.is(obj.test(), 42)
  })
})

test('get str from object', (t) => {
  t.notThrows(() => getStrFromObject())
})

test('create object from Property', (t) => {
  const obj = createObjWithProperty()
  t.true(obj.value instanceof ArrayBuffer)
  t.is(obj.getter, 42)
})

test('global', (t) => {
  t.is(getGlobal(), typeof global === 'undefined' ? globalThis : global)
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
  // @ts-expect-error
  t.is(obj[sym], 'a symbol')
})

test('create symbol', (t) => {
  t.is(createSymbol().toString(), 'Symbol(a symbol)')
  const symRef = createSymbolRef('test')
  t.is(symRef.toString(), 'Symbol(test)')
})

test('Option', (t) => {
  t.is(mapOption(null), null)
  t.is(mapOption(3), 4)
})

test('Result', (t) => {
  t.throws(() => throwError(), void 0, 'Manual Error')
  const errorWithCause = t.throws(() => throwErrorWithCause())
  t.is(errorWithCause?.message, 'Manual Error')
  t.is((errorWithCause?.cause as Error)?.message, 'Inner Error')
  if (!process.env.SKIP_UNWIND_TEST) {
    t.throws(() => panic(), void 0, `Don't panic`)
  }
  t.throws(() => errorMessageContainsNullByte('\u001a\u0000'))

  const errors = jsErrorCallback(
    new Error('JS Error', { cause: new Error('cause') }),
  )
  t.deepEqual(errors[0]!.message, 'JS Error')
  t.deepEqual((errors[0]!.cause as Error).message, 'cause')
  t.deepEqual(errors[1]!.message, 'JS Error')
  t.deepEqual((errors[1]!.cause as Error).message, 'cause')

  const [nestedError] = jsErrorCallback(
    new Error('error1', {
      cause: new Error('error2', {
        cause: new Error('error3', {
          cause: new Error('error4'),
        }),
      }),
    }),
  )
  let error = nestedError
  for (let i = 0; i < 4; i++) {
    t.deepEqual(error!.message, `error${i + 1}`)
    error = error!.cause as Error
  }
})

test('Async error with stack trace', async (t) => {
  const err = await t.throwsAsync(() => throwAsyncError())
  t.not(err?.stack, undefined)
  t.deepEqual(err!.message, 'Async Error')
  if (!process.env.WASI_TEST) {
    t.regex(err!.stack!, /.+at .+values\.spec\.(ts|js):\d+:\d+.+/gm)
  }
})

test('custom status code in Error', (t) => {
  t.throws(() => customStatusCode(), {
    code: 'Panic',
  })
  t.throws(() => CustomStruct.customStatusCodeForFactory(), {
    code: 'Panic',
  })
  t.throws(() => new CustomStruct(), {
    code: 'Panic',
  })
})

test('function ts type override', (t) => {
  // @ts-expect-error
  t.deepEqual(tsRename({ foo: 1, bar: 2, baz: 2 }), ['foo', 'bar', 'baz'])
})

test('function individual ts arg type override', (t) => {
  t.is(
    overrideIndividualArgOnFunction('someStr', () => 'anotherStr', 42),
    'oia: someStr-42-anotherStr',
  )
  t.deepEqual(
    overrideIndividualArgOnFunctionWithCbArg(
      (town, opt) => `im: ${town}-${opt}`,
      89,
    ),
    'im: World(89)-null',
  )
})

test('option object', (t) => {
  t.notThrows(() => receiveAllOptionalObject())
  t.notThrows(() => receiveAllOptionalObject({}))
})

test('should throw if object type is not matched', (t) => {
  // @ts-expect-error
  const err1 = t.throws(() => receiveStrictObject({ name: 1 }))
  t.is(
    err1?.message,
    'Failed to convert JavaScript value `Number 1 ` into rust type `String` on StrictObject.name',
  )
  // @ts-expect-error
  const err2 = t.throws(() => receiveStrictObject({ bar: 1 }))
  t.is(err2!.message, 'Missing field `name`')
})

test('aliased rust struct and enum', (t) => {
  const a = ALIAS.A
  const b: AliasedStruct = {
    a,
    b: 1,
  }
  t.notThrows(() => fnReceivedAliased(b, ALIAS.B))
})

test('serde-json', (t) => {
  if (process.env.WASI_TEST || process.platform === 'freebsd') {
    t.pass()
    return
  }
  const packageJson = readPackageJson()
  t.is(packageJson.name, '@examples/napi')
  t.is(packageJson.version, '0.0.0')
  t.snapshot(Object.keys(packageJson.devDependencies!).sort())

  t.is(getPackageJsonName(packageJson), '@examples/napi')
})

test('serde-json-ref', (t) => {
  if (process.env.WASI_TEST || process.platform === 'freebsd') {
    t.pass()
    return
  }
  const reader = new PackageJsonReader()
  const packageJson = reader.read()
  t.is(packageJson.name, '@examples/napi')
  t.is(packageJson.version, '0.0.0')
})

test('serde-roundtrip', (t) => {
  t.is(testSerdeRoundtrip(1), 1)
  t.is(testSerdeRoundtrip(1.2), 1.2)
  t.is(testSerdeRoundtrip(-1), -1)

  t.deepEqual(testSerdeRoundtrip([1, 1.2, -1]), [1, 1.2, -1])
  t.deepEqual(testSerdeRoundtrip({ a: 1, b: 1.2, c: -1 }), {
    a: 1,
    b: 1.2,
    c: -1,
  })
  t.throws(() => testSerdeRoundtrip(NaN))

  t.is(testSerdeRoundtrip(null), null)

  let err = t.throws(() => testSerdeRoundtrip(undefined))
  t.is(err?.message, 'undefined cannot be represented as a serde_json::Value')

  err = t.throws(() => testSerdeRoundtrip(() => {}))
  t.is(
    err!.message,
    'JS functions cannot be represented as a serde_json::Value',
  )

  err = t.throws(() => testSerdeRoundtrip(Symbol.for('foo')))
  t.is(err!.message, 'JS symbols cannot be represented as a serde_json::Value')
})

test('serde-large-number-precision', (t) => {
  t.is(testSerdeBigNumberPrecision('12345').number, 12345)
  t.is(
    testSerdeBigNumberPrecision('123456789012345678901234567890').number,
    1.2345678901234568e29,
  )
  t.is(
    testSerdeBigNumberPrecision('123456789012345678901234567890.123456789')
      .number,
    1.2345678901234568e29,
  )
  t.is(
    testSerdeBigNumberPrecision('109775245175819965').number.toString(),
    '109775245175819965',
  )
})

test('serde-buffer-bytes', (t) => {
  t.is(testSerdeBufferBytes({ code: new Uint8Array([1, 2, 3]) }), 3n)
  t.is(testSerdeBufferBytes({ code: new Uint8Array(0) }), 0n)

  t.is(testSerdeBufferBytes({ code: Buffer.from([1, 2, 3]) }), 3n)
  t.is(testSerdeBufferBytes({ code: Buffer.alloc(0) }), 0n)
  t.is(testSerdeBufferBytes({ code: new ArrayBuffer(10) }), 10n)
  t.is(testSerdeBufferBytes({ code: new ArrayBuffer(0) }), 0n)
})

test('get bigint json value', (t) => {
  t.notThrows(() => {
    getBigintJsonValue(-1n)
    getBigintJsonValue(1n)
    getBigintJsonValue(18446744073709551620n)
  })
})

test('buffer', (t) => {
  let buf = getBuffer()
  t.is(buf.toString('utf-8'), 'Hello world')
  buf = appendBuffer(buf)
  t.is(buf.toString('utf-8'), 'Hello world!')
  t.is(getBufferSlice().toString('utf-8'), 'Hello world')
  t.is(createExternalBufferSlice().toString('utf-8'), 'Hello world')
  t.is(createBufferSliceFromCopiedData().toString('utf-8'), 'Hello world')

  const a = getEmptyBuffer()
  const b = getEmptyBuffer()
  t.is(a.toString(), '')
  t.is(b.toString(), '')

  t.true(Array.isArray(asyncBufferToArray(Buffer.from([1, 2, 3]).buffer)))
})

test('Return BufferSlice with lifetime', (t) => {
  const reader = new Reader()
  const reader2 = new Reader()
  t.deepEqual(reader.read(), Buffer.from('Hello world'))
  t.deepEqual(reader2.read(), Buffer.from('Hello world'))
})

test('Transparent', (t) => {
  const v = getMyVec()
  t.deepEqual(v, [42, 'a string'])
})

test('TypedArray', (t) => {
  t.is(acceptSlice(new Uint8Array([1, 2, 3])), 3n)
  t.deepEqual(u8ArrayToArray(new Uint8Array([1, 2, 3])), [1, 2, 3])
  t.deepEqual(i8ArrayToArray(new Int8Array([1, 2, 3])), [1, 2, 3])
  t.deepEqual(u16ArrayToArray(new Uint16Array([1, 2, 3])), [1, 2, 3])
  t.deepEqual(i16ArrayToArray(new Int16Array([1, 2, 3])), [1, 2, 3])
  t.deepEqual(u32ArrayToArray(new Uint32Array([1, 2, 3])), [1, 2, 3])
  t.deepEqual(i32ArrayToArray(new Int32Array([1, 2, 3])), [1, 2, 3])
  t.deepEqual(u64ArrayToArray(new BigUint64Array([1n, 2n, 3n])), [1n, 2n, 3n])
  t.deepEqual(i64ArrayToArray(new BigInt64Array([1n, 2n, 3n])), [1, 2, 3])
  t.deepEqual(f32ArrayToArray(new Float32Array([1, 2, 3])), [1, 2, 3])
  t.deepEqual(f64ArrayToArray(new Float64Array([1, 2, 3])), [1, 2, 3])

  const bird = new Bird('Carolyn')

  t.is(bird.acceptSliceMethod(new Uint8Array([1, 2, 3])), 3)

  t.is(acceptUint8ClampedSlice(new Uint8ClampedArray([1, 2, 3])), 3n)
  t.is(
    acceptUint8ClampedSliceAndBufferSlice(
      Buffer.from([1, 2, 3]),
      new Uint8ClampedArray([1, 2, 3]),
    ),
    6n,
  )
})

test('emptybuffer', (t) => {
  let buf = new ArrayBuffer(0)
  t.is(acceptArraybuffer(buf), 0n)
})

test('reset empty buffer', (t) => {
  const empty = getEmptyBuffer()

  const shared = new ArrayBuffer(0)
  const buffer = Buffer.from(shared)
  t.notThrows(() => {
    buffer.set(empty)
  })
})

test('empty typed array', (t) => {
  t.notThrows(() => {
    derefUint8Array(getEmptyTypedArray(), new Uint8ClampedArray([]))
  })
})

test('convert typedarray to vec', (t) => {
  const input = new Uint32Array([1, 2, 3, 4, 5])
  t.deepEqual(convertU32Array(input), Array.from(input))
})

test('create external TypedArray', (t) => {
  t.deepEqual(createExternalTypedArray(), new Uint32Array([1, 2, 3, 4, 5]))
})

test('typed array creation', (t) => {
  t.deepEqual(
    createUint8ClampedArrayFromData(),
    new Uint8ClampedArray(Buffer.from('Hello world')),
  )
  t.deepEqual(
    createUint8ClampedArrayFromExternal(),
    new Uint8ClampedArray(Buffer.from('Hello world')),
  )
  t.deepEqual(Buffer.from(arrayBufferFromData()), Buffer.from('Hello world'))
  t.deepEqual(uint8ArrayFromData(), new Uint8Array(Buffer.from('Hello world')))
  t.deepEqual(
    uint8ArrayFromExternal(),
    new Uint8Array(Buffer.from('Hello world')),
  )
})

test('mutate TypedArray', (t) => {
  if (process.env.WASI_TEST) {
    t.pass()
    return
  }
  const input = new Float32Array([1, 2, 3, 4, 5])
  mutateTypedArray(input)
  t.deepEqual(input, new Float32Array([2.0, 4.0, 6.0, 8.0, 10.0]))
})

test('deref uint8 array', (t) => {
  t.is(
    derefUint8Array(new Uint8Array([1, 2]), new Uint8ClampedArray([3, 4])),
    4,
  )
})

test('accept untyped typed array', (t) => {
  t.is(acceptUntypedTypedArray(new Uint8Array([1, 2, 3])), 3n)
})

test('async', async (t) => {
  if (process.env.WASI_TEST) {
    t.pass()
    return
  }
  const bufPromise = readFileAsync(join(__dirname, '../package.json'))
  await t.notThrowsAsync(bufPromise)
  const buf = await bufPromise
  const { name } = JSON.parse(buf.toString())
  t.is(name, '@examples/napi')

  await t.throwsAsync(() => readFileAsync('some_nonexist_path.file'))
})

test('within async runtime', (t) => {
  t.notThrows(() => withinAsyncRuntimeIfAvailable())
})

test('panic in async fn', async (t) => {
  if (!process.env.SKIP_UNWIND_TEST && !process.env.WASI_TEST) {
    await t.throwsAsync(() => panicInAsync(), {
      message: 'panic in async function',
    })
  } else {
    t.pass('no unwind runtime')
  }
})

test('async move', async (t) => {
  t.is(await asyncMultiTwo(2), 4)
})

test('buffer passthrough', async (t) => {
  const fixture = Buffer.from('hello world')
  const ret = await bufferPassThrough(fixture)
  t.deepEqual(ret, fixture)
})

test('arraybuffer passthrough', async (t) => {
  const fixture = new Uint8Array([1, 2, 3, 4, 5])
  const ret = await arrayBufferPassThrough(fixture)
  t.deepEqual(ret, fixture)
})

test('async reduce buffer', async (t) => {
  const input = [1, 2, 3, 4, 5, 6]
  const fixture = Buffer.from(input)
  t.is(
    await asyncReduceBuffer(fixture),
    input.reduce((acc, cur) => acc + cur),
  )
})

test('create arraybuffer with native', (t) => {
  const ret = createArraybuffer()
  t.true(ret instanceof ArrayBuffer)
  const buf = new ArrayBuffer(4)
  const view = new Uint8Array(buf)
  view[0] = 1
  view[1] = 2
  view[2] = 3
  view[3] = 4
  t.deepEqual(ret, buf)
})

test('Uint8Array from String', async (t) => {
  t.is(
    Buffer.from(await uInit8ArrayFromString()).toString('utf8'),
    'Hello world',
  )
})

test('either', (t) => {
  t.is(eitherStringOrNumber(2), 2)
  t.is(eitherStringOrNumber('hello'), 'hello'.length)
  t.is(eitherF64OrU32(1), 1)
  t.is(eitherF64OrU32(1.1), 1.1)
})

test('return either', (t) => {
  t.is(returnEither(2), 2)
  t.is(returnEither(42), '42')
})

test('receive class reference in either', (t) => {
  const c = new JsClassForEither()
  t.is(receiveClassOrNumber(1), 2)
  t.is(receiveClassOrNumber(c), 100)
  t.is(receiveMutClassOrNumber(c), 100)
})

test('receive different class', (t) => {
  const a = new JsClassForEither()
  const b = new AnotherClassForEither()
  t.is(receiveDifferentClass(a), 42)
  t.is(receiveDifferentClass(b), 100)
})

test('return either class', (t) => {
  t.is(returnEitherClass(1), 1)
  t.true(returnEitherClass(-1) instanceof JsClassForEither)
})

test('either from option', (t) => {
  t.true(eitherFromOption() instanceof JsClassForEither)
})

test('either from objects', (t) => {
  t.is(eitherFromObjects({ foo: 1 }), 'A')
  t.is(eitherFromObjects({ bar: 2 }), 'B')
  t.is(eitherFromObjects({ baz: 3 }), 'C')
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

test('either promise in either a', async (t) => {
  t.is(await eitherPromiseInEitherA(1), false)
  t.is(await eitherPromiseInEitherA(20), true)
  t.is(await eitherPromiseInEitherA(Promise.resolve(1)), false)
  t.is(await eitherPromiseInEitherA(Promise.resolve(20)), true)
  t.is(await eitherPromiseInEitherA('abc'), false)
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
  t.is(e?.message, '<u32> on `External` is not the type of wrapped object')

  const extRef = createExternalRef(FX)
  t.is(getExternal(extRef), FX)
})

test('optional external', (t) => {
  const FX = 42
  const extEmpty = createOptionalExternal()
  t.is(getOptionalExternal(extEmpty), null)
  const ext = createOptionalExternal(FX)
  t.is(getOptionalExternal(ext), FX)
  mutateOptionalExternal(ext, FX + 1)
  t.is(getOptionalExternal(ext), FX + 1)
  // @ts-expect-error
  t.throws(() => getOptionalExternal({}))
  const ext2 = createExternalString('wtf')
  // @ts-expect-error
  const e = t.throws(() => getOptionalExternal(ext2))
  t.is(e?.message, '<u32> on `External` is not the type of wrapped object')
})

test('should be able to run script', async (t) => {
  t.is(runScript(`1 + 1`), 2)
  t.is(await runScript(`Promise.resolve(1)`), 1)
})

test('should be able to return object from shared crate', (t) => {
  t.deepEqual(returnFromSharedCrate(), {
    value: 42,
  })
})

const AbortSignalTest =
  typeof AbortController !== 'undefined' ? test : test.skip

test('async task without abort controller', async (t) => {
  t.is(await withoutAbortController(1, 2), 3)
})

// schedule async task always start immediately, hard to create a case that async task is scheduled but not started
test.skip('async task with abort controller', async (t) => {
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

test('async task with different resolved values', async (t) => {
  const r1 = await asyncTaskOptionalReturn()
  t.falsy(r1)
  if (!process.env.WASI_TEST) {
    await asyncTaskReadFile(import.meta.filename)
  }
  const r2 = await asyncResolveArray(2)
  t.deepEqual(r2, [0, 1])
})

AbortSignalTest('abort resolved task', async (t) => {
  const ctrl = new AbortController()
  await withAbortController(1, 2, ctrl.signal).then(() => ctrl.abort())
  t.pass('should not throw')
})

test('abort signal should be able to reuse with different tasks', async (t) => {
  const ctrl = new AbortController()
  await t.notThrowsAsync(async () => {
    try {
      const promise = Promise.all(
        Array.from({ length: 20 }).map(() =>
          withAbortController(1, 2, ctrl.signal),
        ),
      )
      ctrl.abort()
      await promise
    } catch (err: unknown) {
      // sometimes on CI, the scheduled task is able to abort
      // so we only allow it to throw AbortError
      t.is((err as Error).message, 'AbortError')
    }
  })
})

test('async task finally must be called', async (t) => {
  const obj = {
    finally: false,
    resolve: false,
  }
  await asyncTaskFinally(obj)
  t.is(obj.finally, true)
  t.is(obj.resolve, true)
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

BigIntTest('BigInt get_u64', (t) => {
  t.is(bigintGetU64AsString(BigInt(0)), '0')
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

BigIntTest('from i128 i64', (t) => {
  t.is(bigintFromI64(), BigInt('100'))
  t.is(bigintFromI128(), BigInt('-100'))
})

Napi4Test('call ThreadsafeFunction', (t) => {
  if (process.env.WASI_TEST) {
    t.pass()
    return
  }
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
          Array.from({ length: 100 }, (_, i) => i).reduce((a, b) => a + b),
        )
      }
    })
  })
})

Napi4Test('throw error from ThreadsafeFunction', async (t) => {
  const throwPromise = new Promise((_, reject) => {
    threadsafeFunctionThrowError(reject)
  })
  const err = await t.throwsAsync(throwPromise)
  t.is(err?.message, 'ThrowFromNative')
})

Napi4Test('throw error from ThreadsafeFunction with status', async (t) => {
  const throwPromise = new Promise((_, reject) => {
    threadsafeFunctionThrowErrorWithStatus(reject)
  })
  const err = await t.throwsAsync(throwPromise)
  t.is((err as Error & { code?: string })?.code, 'CustomErrorStatus')
})

Napi4Test(
  'throw error from ThreadsafeFunction with builder and status',
  async (t) => {
    const throwPromise = new Promise((_, reject) => {
      threadsafeFunctionBuildThrowErrorWithStatus(reject)
    })
    const err = await t.throwsAsync(throwPromise)
    t.is((err as Error & { code?: string })?.code, 'CustomErrorStatus')
  },
)

Napi4Test('ThreadsafeFunction closure capture data', (t) => {
  return new Promise((resolve) => {
    const defaultValue = new Animal(Kind.Dog, '旺财')
    threadsafeFunctionClosureCapture(defaultValue, (value) => {
      resolve()
      t.is(value, defaultValue)
    })
  })
})

Napi4Test('resolve value from thread safe function fatal mode', async (t) => {
  const tsfnFatalMode = new Promise<boolean>((resolve) => {
    threadsafeFunctionFatalMode(resolve)
  })
  t.true(await tsfnFatalMode)
})

Napi4Test('throw error from thread safe function fatal mode', (t) => {
  const p = exec('node ./tsfn-error.cjs', {
    cwd: __dirname,
  })
  let stderr = Buffer.from([])
  p.stderr?.on('data', (data) => {
    stderr = Buffer.concat([stderr, Buffer.from(data)])
  })
  return new Promise<void>((resolve) => {
    p.on('exit', (code) => {
      t.is(code, 1)
      const stderrMsg = stderr.toString('utf8')
      console.info(stderrMsg)
      t.true(stderrMsg.includes(`Error: Failed to convert JavaScript value`))
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

Napi4Test('call ThreadsafeFunction with callback', async (t) => {
  await t.notThrowsAsync(
    () =>
      new Promise<void>((resolve) => {
        tsfnCallWithCallback(() => {
          resolve()
          return 'ReturnFromJavaScriptRawCallback'
        })
      }),
  )
})

Napi4Test('async call ThreadsafeFunction', async (t) => {
  await t.notThrowsAsync(() =>
    tsfnAsyncCall((arg1, arg2, arg3) => {
      t.is(arg1, 0)
      t.is(arg2, 1)
      t.is(arg3, 2)
      return 'ReturnFromJavaScriptRawCallback'
    }),
  )
})

// https://github.com/napi-rs/napi-rs/issues/2727
test('provide undefined to tsfn', async (t) => {
  // @ts-expect-error
  t.throws(() => tsfnAsyncCall(), {
    code: 'InvalidArg',
  })
})

test('Throw from ThreadsafeFunction JavaScript callback', async (t) => {
  const errMsg = 'ThrowFromJavaScriptRawCallback'
  await t.throwsAsync(
    () =>
      tsfnThrowFromJs(() => {
        throw new Error(errMsg)
      }),
    {
      message: errMsg,
    },
  )

  await t.throwsAsync(
    async () => {
      await tsfnThrowFromJs(() => {
        const a = {}
        // @ts-expect-error
        a.c.d = 2
        return Promise.resolve(1)
      })
      await tsfnThrowFromJsCallbackContainsTsfn(() => {
        const a = {}
        // @ts-expect-error
        a.b.c = 1
        tsfnThrowFromJs(() => {
          // @ts-expect-error
          a.c.d = 2
          return Promise.resolve(1)
        })
        return Promise.resolve(1)
      })
    },
    {
      instanceOf: TypeError,
      message: "Cannot set properties of undefined (setting 'd')",
    },
  )
})

Napi4Test('accept ThreadsafeFunction', async (t) => {
  await new Promise<void>((resolve, reject) => {
    acceptThreadsafeFunction((err, value) => {
      if (err) {
        reject(err)
      } else {
        t.is(value, 1)
        resolve()
      }
    })
  })
})

Napi4Test('accept ThreadsafeFunction Fatal', async (t) => {
  await new Promise<void>((resolve) => {
    acceptThreadsafeFunctionFatal((value) => {
      t.is(value, 1)
      resolve()
    })
  })
})

Napi4Test('accept ThreadsafeFunction tuple args', async (t) => {
  await new Promise<void>((resolve, reject) => {
    acceptThreadsafeFunctionTupleArgs((err, num, bool, str) => {
      if (err) {
        return reject(err)
      }
      t.is(num, 1)
      t.is(bool, false)
      t.is(str, 'NAPI-RS')
      resolve()
    })
  })
})

Napi4Test('threadsafe function return Promise and await in Rust', async (t) => {
  const value = await tsfnReturnPromise((err, value) => {
    if (err) {
      throw err
    }
    return Promise.resolve(value + 2)
  })
  t.is(value, 5)
  await t.throwsAsync(
    () =>
      tsfnReturnPromiseTimeout((err, value) => {
        if (err) {
          throw err
        }
        return new Promise((resolve) => {
          setTimeout(() => {
            resolve(value + 2)
          }, 300)
        })
      }),
    {
      message: 'Timeout',
    },
  )
  // trigger Promise.then in Rust after `Promise` is dropped
  await new Promise((resolve) => setTimeout(resolve, 400))
})

Napi4Test('call async with unknown return value', async (t) => {
  await new Promise<number>((resolve, reject) => {
    return callAsyncWithUnknownReturnValue((err, value) => {
      if (err) {
        reject(err)
      } else {
        resolve(value)
        t.is(value, 42)
        return {}
      }
    }).then((result) => {
      t.is(result, 110)
    })
  })
})

Napi4Test('object only from js', (t) => {
  return new Promise((resolve, reject) => {
    receiveObjectOnlyFromJs({
      count: 100,
      callback: (err: Error | null, count: number) => {
        if (err) {
          reject(err)
        } else {
          t.is(count, 100)
          resolve()
        }
      },
    })
  })
})

Napi4Test('build ThreadsafeFunction from Function', (t) => {
  const subject = new Subject<void>()
  const fn = (a: number, b: number) => {
    t.is(a, 1)
    t.is(b, 2)
    subject.next()
    return a * b
  }

  buildThreadsafeFunctionFromFunction(fn)

  t.notThrows(() => {
    buildThreadsafeFunctionFromFunctionCalleeHandle(() => {})
  })

  return subject.pipe(take(3))
})

Napi4Test('promise in either', async (t) => {
  t.is(await promiseInEither(1), false)
  t.is(await promiseInEither(20), true)
  t.is(await promiseInEither(Promise.resolve(1)), false)
  t.is(await promiseInEither(Promise.resolve(20)), true)
  // @ts-expect-error
  t.throws(() => promiseInEither('1'))
})

const Napi5Test = Number(process.versions.napi) >= 5 ? test : test.skip

Napi5Test('Date test', (t) => {
  const fixture = new Date('2016-12-24')
  t.is(dateToNumber(fixture), fixture.valueOf())
})

Napi5Test('Date to chrono test', (t) => {
  const fixture = new Date('2022-02-09T19:31:55.396Z')
  t.is(chronoUtcDateToMillis(fixture), fixture.getTime())
  t.is(chronoLocalDateToMillis(fixture), fixture.getTime())
  t.is(chronoDateWithTimezoneToMillis(fixture), fixture.getTime())
  t.deepEqual(
    chronoDateAdd1Minute(fixture),
    new Date(fixture.getTime() + 60 * 1000),
  )
})

Napi5Test('Get date', (t) => {
  const fixture1 = new Date('2024-02-07T18:28:18-0800')
  t.deepEqual(chronoDateFixtureReturn1(), fixture1)
  const fixture2 = new Date('2024-02-07T18:28:18+0530')
  t.deepEqual(chronoDateFixtureReturn2(), fixture2)
})

Napi5Test('Class with getter setter closures', (t) => {
  const instance = new GetterSetterWithClosures()
  // @ts-expect-error
  instance.name = 'Allie'
  t.pass()
  // @ts-expect-error
  t.is(instance.name, `I'm Allie`)
  // @ts-expect-error
  t.is(instance.age, 0.3)
  // @ts-expect-error
  t.is(instance[instance.ageSymbol], 0.3)
})

Napi5Test('Date to chrono::NativeDateTime test', (t) => {
  const fixture = new Date()
  t.is(chronoNativeDateTime(fixture), fixture.valueOf())
})

Napi5Test('Date from chrono::NativeDateTime test', (t) => {
  const fixture = chronoNativeDateTimeReturn()
  t.true(fixture instanceof Date)
  t.is(fixture?.toISOString(), '2016-12-23T15:25:59.325Z')
})

const Napi9Test = Number(process.versions.napi) >= 9 ? test : test.skip

Napi9Test('create symbol for', (t) => {
  t.is(createSymbolFor('foo'), Symbol.for('foo'))
})

Napi9Test('get module file name', (t) => {
  if (process.env.WASI_TEST) {
    t.pass()
    return
  }
  console.info(getModuleFileName())
  t.regex(
    getModuleFileName(),
    new RegExp(`example.${process.platform}-${process.arch}`),
  )
})

test('throw syntax error', (t) => {
  const message = `Syntax Error: Unexpected token '}'`
  const code = 'InvalidCharacterError'
  t.throws(
    () => throwSyntaxError(message, code),
    {
      code,
      instanceOf: SyntaxError,
    },
    message,
  )
})

test('type', (t) => {
  const rule: Rule = {
    name: 'rule',
    handler: (a) => {
      return a + 5
    },
  }
  t.is(callRuleHandler(rule, 1), 6)
})

test('tuple to array', (t) => {
  let t1: TupleToArray = ['a', 1]
  let t2: TupleToArray = ['b', 2, { merge: true }]
  let v = mergeTupleArray(t1, t1)
  t.deepEqual(v, ['a', 1, undefined])

  let mergev = mergeTupleArray(t1, t2)
  t.deepEqual(mergev, ['ab', 3, { merge: true }])
})

test('get class from array', (t) => {
  const classInArray = new ClassInArray(42)
  t.is(getClassFromArray([classInArray]), 42)
})

test('acceptStream', async (t) => {
  if (process.version.startsWith('v18')) {
    // https://github.com/nodejs/node/issues/56432
    t.pass('Skip when Node.js is 18 and WASI due to bug')
    return
  }
  const selfPath = fileURLToPath(import.meta.url)
  const nodeFileStream = createReadStream(selfPath)
  const buffer = await acceptStream(Readable.toWeb(nodeFileStream))
  t.is(buffer.toString('utf-8'), await nodeReadFile(selfPath, 'utf-8'))
})

test('create readable stream from channel', async (t) => {
  if (process.env.WASI_TEST) {
    t.pass(
      'Skip when WASI because ReadableStream controller.enqueue does not accept SharedArrayBuffer',
    )
    return
  }
  const stream = await createReadableStream()
  const chunks = []
  for await (const chunk of stream) {
    chunks.push(chunk)
  }
  t.is(Buffer.concat(chunks).toString('utf-8'), 'hello'.repeat(100))
  const { ReadableStream } = await import('web-streams-polyfill')
  // @ts-expect-error polyfill ReadableStream is not the same as the one in Node.js
  const streamFromClass = await createReadableStreamFromClass(ReadableStream)
  const chunksFromClass = []
  for await (const chunk of streamFromClass) {
    chunksFromClass.push(chunk)
  }
  t.is(Buffer.concat(chunksFromClass).toString('utf-8'), 'hello'.repeat(100))
})

test('create readable stream from channel with object', async (t) => {
  if (process.env.WASI_TEST) {
    t.pass(
      'Skip when WASI because ReadableStream controller.enqueue does not accept SharedArrayBuffer',
    )
    return
  }
  const stream = await createReadableStreamWithObject()
  const chunks = []
  for await (const chunk of stream) {
    chunks.push(chunk)
  }

  t.is(chunks.length, 100)

  chunks.forEach((chunk, index) => {
    t.truthy(chunk?.something, `Element ${index} doesnt have chunk.something`)
    t.is(chunk.something.hello, '', `Element ${index} hello is an empty string`)
    t.is(chunk.name, '', `Element ${index} name is not an empty string`)
    t.is(chunk.size, index, `Element ${index} size has to be ${index}`)
  })
})

test('spawnThreadInThread should be fine', async (t) => {
  await new Promise((resolve, reject) => {
    spawnThreadInThread((err, num) => {
      if (err) {
        reject(err)
      } else {
        t.is(num, 42)
        resolve(void 0)
      }
      return 0
    })
  })
  t.pass()
})

test('should generate correct type def file', async (t) => {
  if (process.env.WASI_TEST || process.platform === 'freebsd') {
    t.pass()
  } else {
    t.snapshot(await nodeReadFile(join(__dirname, '..', 'index.d.cts'), 'utf8'))
  }
})

test('should be able to recursively hidden lifetime', async (t) => {
  await t.notThrowsAsync(async () => {
    await esmResolve(() => Promise.resolve(undefined))
  })
})

test('should be able to correct lifetime of spawn_future_lifetime', async (t) => {
  const result = await spawnFutureLifetime(1)
  t.is(result, '1')
  const result2 = await promiseRawReturnClassInstance()
  t.true(result2 instanceof ClassReturnInPromise)
})

test('extends javascript error', (t) => {
  class CustomError extends Error {}

  try {
    extendsJavascriptError(CustomError)
  } catch (e: any) {
    t.true(e instanceof CustomError)
    t.is(e.message, 'Error message in Rust')
    t.is(e.name, 'RustError')
    t.true(typeof e.nativeStackTrace === 'string')
  }
})

test('module exports', (t) => {
  t.is(nativeAddon.NAPI_RS_SYMBOL, Symbol.for('NAPI_RS_SYMBOL'))
})

test('shorter scope', (t) => {
  const result = shorterScope(['hello', { foo: 'bar' }, 'world', true])
  t.deepEqual(result, [5, 1, 5, 0])
})

test('escapable handle scope', (t) => {
  function makeIterFunction() {
    let i = 0
    return () => {
      if (i >= 10_000) {
        return null
      }
      i++
      return Math.random().toString().repeat(100)
    }
  }
  t.notThrows(() => {
    shorterEscapableScope(makeIterFunction())
  })
})

test('complex class with multiple methods - issue #2722', (t) => {
  // Test creating instance of re-exported class with constructor (Either<String, ClassInstance<ComplexClass>>)
  t.notThrows(() => {
    const complex = new ComplexClass('test_value', 42)

    // Test that constructor worked
    t.is(complex.value, 'test_value')
    t.is(complex.number, 42)

    // Test all methods work
    t.is(complex.methodOne(), 'method_one: test_value')
    t.is(complex.methodTwo(), 84)
    t.is(complex.methodThree(), 'method_three: test_value - 42')
    t.is(complex.methodFour(), true)
    t.is(complex.methodFive(), 'TEST_VALUE')
  })

  // Test with Either::B variant (ClassInstance instead of string)
  t.notThrows(() => {
    const original = new ComplexClass('original', 100)
    const complex2 = new ComplexClass(original, -10)
    t.is(complex2.value, 'cloned:original') // Should clone the value
    t.is(complex2.methodFour(), false)
  })

  // Test that we can create multiple instances (stress test with Either)
  t.notThrows(() => {
    const baseInstance = new ComplexClass('base', 999)
    for (let i = 0; i < 10; i++) {
      // Alternate between string and ClassInstance for Either parameter
      const instance =
        i % 2 === 0
          ? new ComplexClass(`test${i}`, i)
          : new ComplexClass(baseInstance, i)

      const expectedValue = i % 2 === 0 ? `test${i}` : 'cloned:base'
      t.is(instance.value, expectedValue)
      t.is(instance.number, i)
    }
  })
})

test('instanceof for objects returned from getters - issue #2746', (t) => {
  const list = new ThingList()
  const thing = list.thing
  t.true(thing instanceof Thing, 'thing should be an instance of Thing')
})

test('callback in spawn async task', async (t) => {
  const { resolve, promise } = Promise.withResolvers()
  callbackInSpawn((obj) => {
    resolve(obj)
  })
  const obj = await promise
  t.deepEqual(obj, { foo: 'bar' })
})

test('return if invalid params', (t) => {
  t.notThrows(() => {
    // @ts-expect-error
    arrayParams(['1', '2'])
    arrayParams([
      // @ts-expect-error
      { foo: 'bar' },
      // @ts-expect-error
      Symbol.for('foo'),
    ])
  })
})
