import { Buffer } from 'node:buffer'
import { exec } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createReadStream } from 'node:fs'
import { readFile as nodeReadFile } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { ReadableStream } from 'node:stream/web'
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
  createZeroCopyUtf16String,
  createZeroCopyLatin1String,
  createExternalUtf16String,
  createExternalLatin1String,
  createExternalLatin1Empty,
  createExternalLatin1Short,
  createExternalLatin1Long,
  createExternalLatin1WithLatin1Chars,
  createExternalLatin1CustomFinalize,
  createStaticLatin1String,
  createStaticUtf16String,
  testLatin1Methods,
  roundtripStr,
  appendToOsString,
  joinPath,
  pathParent,
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
  createErrorFromRetainedValue,
  jsErrorFromRetainedValue,
  jsTypeErrorFromRetainedValue,
  jsRangeErrorFromRetainedValue,
  jsErrorWithoutRetainedValue,
  jsTypeErrorWithoutRetainedValue,
  jsRangeErrorWithoutRetainedValue,
  tryCloneErrorOffThread,
  tryCloneErrorCauseOffThread,
  tryCloneErrorCauseTransitiveOffThread,
  tryCloneErrorOffThreadKeepReference,
  throwDetachedPendingException,
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
  asyncTaskRejectWithCapturedValue,
  asyncTaskOptionalReturn,
  asyncTaskFinally,
  asyncResolveArray,
  asyncTaskArraybuffer,
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
  tsfnThrowFromJsCatch,
  tsfnThrowFromJsCatchDropInThread,
  tsfnThrowFromJsCatchHandled,
  tsfnThrowFromJsCatchRecover,
  asyncPlus100,
  describePromiseRejection,
  describeCapturedValue,
  getGlobal,
  getUndefined,
  getNull,
  createUseNullableStruct,
  createNotUseNullableStruct,
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
  mutateArraybuffer,
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
  moduleRetentionRequests,
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
  callThenOnPromiseCapturing,
  callCatchOnPromise,
  callCatchOnPromiseCapturing,
  callFinallyOnPromise,
  createResolvedPromise,
  createRejectedPromise,
  StructuredKind,
  validateStructuredEnum,
  StructuredKindLowercase,
  validateStructuredEnumLowercase,
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
  drainStreamCount,
  createReadableStream,
  createReadableStreamWithObject,
  createReadableStreamFromClass,
  createErroringReadableStream,
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
  arrayBufferFromExternal,
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
  indexSetToRust,
  indexSetToJs,
  intoUtf8,
  withAbortSignalHandle,
  createI32ArrayFromExternal,
  optionalCallbackTypes,
  ReentrantBorrowOrderTest,
  createReentrantBorrowOrderTestTarget,
  cleanupReentrantBorrowOrderTestTargets,
  detachReentrantBorrowOrderTestTarget,
  EagerReleaseHolder,
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
  t.is(createZeroCopyUtf16String(), 'abc')
  t.is(createZeroCopyLatin1String(), 'Hello')
  t.is(createExternalUtf16String(), 'External UTF16')
  t.is(createExternalLatin1String(), 'External Latin1')
  t.is(createStaticLatin1String(), 'Static Latin1 string')
  t.is(createStaticUtf16String(), 'Static UTF16')
  t.is(intoUtf8('Hello'), 'Hello')
})

test('OsString / OsStr', (t) => {
  t.is(appendToOsString('foo'), 'foo + Rust 🦀 string!')
  t.is(appendToOsString(''), ' + Rust 🦀 string!')
})

test('PathBuf / Path', (t) => {
  t.is(joinPath('foo', 'bar'), join('foo', 'bar'))
  t.is(joinPath(join('tmp', 'dir'), 'baz.txt'), join('tmp', 'dir', 'baz.txt'))
  const nested = join('tmp', 'dir', 'baz.txt')
  t.is(pathParent(nested), dirname(nested))
  t.is(pathParent('baz.txt'), '')
})

test('JsStringLatin1::from_external tests', (t) => {
  // Test with empty string
  t.is(createExternalLatin1Empty(), '')

  // Test with short string (likely to be copied by V8)
  t.is(createExternalLatin1Short(), 'Hi')

  // Test with long string (more likely to remain external)
  t.is(
    createExternalLatin1Long(),
    'This is a much longer string that is more likely to be kept as an external string by V8 rather than being copied',
  )

  // Test with actual Latin-1 extended characters
  // The string contains: "Hello ÀÁÂ ñòó"
  const latin1Result = createExternalLatin1WithLatin1Chars()
  t.is(latin1Result.length, 13)
  t.true(latin1Result.includes('Hello'))

  // Test with custom finalize hint
  t.is(createExternalLatin1CustomFinalize(), 'Custom finalize test')

  // Test Latin1 methods. The wrapper's Rust-side accessors mirror `buf`:
  // - On WASM (WASI/emnapi) and on native when V8 keeps the string external,
  //   `buf` slices the real bytes and the wrapper reports the full length.
  // - On native when V8 chooses to copy (sandbox mode and/or some short
  //   strings), the finalizer ran synchronously and `buf` is `&[]`; the
  //   wrapper then reports length 0 / isEmpty true / asSlice []. Recover
  //   the bytes via `JsString::into_latin1` on `.into_value()` if needed.
  const methodsTest = testLatin1Methods('Test string')
  if (methodsTest.length === 11) {
    t.is(methodsTest.isEmpty, false)
    t.deepEqual(methodsTest.asSlice, Array.from(Buffer.from('Test string')))
  } else {
    t.is(methodsTest.length, 0)
    t.is(methodsTest.isEmpty, true)
    t.deepEqual(methodsTest.asSlice, [])
  }

  // Test with empty input
  t.throws(() => testLatin1Methods(''), {
    message: 'Cannot create external string from empty data',
    code: 'InvalidArg',
  })
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
    indexSetToRust(new Set(['a', 'b', 'c']))
  })
  t.deepEqual(Array.from(passSetToJs()).sort(), ['a', 'b', 'c'])
  t.deepEqual(Array.from(passSetWithHasherToJs()).sort(), ['a', 'b', 'c'])
  t.deepEqual(Array.from(btreeSetToJs()).sort(), ['a', 'b', 'c'])
  t.deepEqual(Array.from(indexSetToJs()), ['a', 'b', 'c', 'd'])
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
  const optional: StructuredKind = {
    type2: 'Optional',
  }
  const optionalWithName: StructuredKind = {
    type2: 'Optional',
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
  t.deepEqual(optional, validateStructuredEnum(optional))
  t.deepEqual(optionalWithName, validateStructuredEnum(optionalWithName))
  t.deepEqual(birthday, validateStructuredEnum(birthday))
  t.deepEqual(tuple, validateStructuredEnum(tuple))
  t.throws(() => validateStructuredEnum({ type2: 'unknown' } as any))
  t.throws(() => validateStructuredEnum({ type2: 'Greeting' } as any))
  const missingDiscriminantErr = t.throws(() =>
    validateStructuredEnum({ name: 'Napi-rs' } as any),
  )
  t.is(missingDiscriminantErr?.message, 'Missing field `type2`')
  const invalidDiscriminantErr = t.throws(() =>
    validateStructuredEnum({ type2: 1 } as any),
  )
  t.is(
    invalidDiscriminantErr?.message,
    'Failed to convert JavaScript value `Number 1 ` into rust type `String` on StructuredKind.type2',
  )

  const hello2: StructuredKindLowercase = {
    type: 'hello',
  }
  const greeting2: StructuredKindLowercase = {
    type: 'greeting',
    name: 'Napi-rs',
  }
  const optional2: StructuredKindLowercase = {
    type: 'optional',
  }
  const optionalWithName2: StructuredKindLowercase = {
    type: 'optional',
    name: 'Napi-rs',
  }
  const birthday2: StructuredKindLowercase = {
    type: 'birthday',
    name: 'Napi-rs',
    age: 10,
  }
  const tuple2: StructuredKindLowercase = {
    type: 'tuple',
    field0: 1,
    field1: 2,
  }
  t.deepEqual(hello2, validateStructuredEnumLowercase(hello2))
  t.deepEqual(greeting2, validateStructuredEnumLowercase(greeting2))
  t.deepEqual(optional2, validateStructuredEnumLowercase(optional2))
  t.deepEqual(
    optionalWithName2,
    validateStructuredEnumLowercase(optionalWithName2),
  )
  t.deepEqual(birthday2, validateStructuredEnumLowercase(birthday2))
  t.deepEqual(tuple2, validateStructuredEnumLowercase(tuple2))
  t.throws(() => validateStructuredEnumLowercase({ type: 'unknown' } as any))
  t.throws(() => validateStructuredEnumLowercase({ type: 'greeting' } as any))
})

test('object optional field serialization', (t) => {
  const notNullable = createNotUseNullableStruct()
  t.deepEqual(notNullable, {
    requiredNumberField: 1,
    requiredStringField: 'required',
  })
  t.false('optionalNumberField' in notNullable)
  t.false('optionalStringField' in notNullable)

  t.deepEqual(createUseNullableStruct(), {
    requiredNumberField: 1,
    requiredStringField: 'required',
    nullableNumberField: null,
    nullableStringField: null,
  })
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
  // Verify the generated types
  t.notThrows(() => optionalCallbackTypes())
  t.notThrows(() => optionalCallbackTypes((arg) => arg))
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

test('mutable receiver is borrowed after reentrant input conversion', (t) => {
  const exercise = (
    label: string,
    invoke: (target: object, values: number[]) => void,
  ) => {
    const target = createReentrantBorrowOrderTestTarget(
      ReentrantBorrowOrderTest,
    )
    let getterRan = false
    const values = Object.defineProperty([], '0', {
      enumerable: true,
      get() {
        getterRan = true
        detachReentrantBorrowOrderTestTarget(target)
        return 1
      },
    }) as number[]

    let error: unknown
    try {
      invoke(target, values)
    } catch (caught) {
      error = caught
    } finally {
      t.is(cleanupReentrantBorrowOrderTestTargets(), 1)
    }

    t.true(getterRan)
    t.truthy(error, `${label} must unwrap its receiver after input conversion`)
  }

  exercise('mutable method', (target, values) => {
    ReentrantBorrowOrderTest.prototype.replaceValues.call(target, values)
  })
  exercise('mutable public field setter', (target, values) => {
    const setter = Object.getOwnPropertyDescriptor(
      ReentrantBorrowOrderTest.prototype,
      'values',
    )?.set
    t.truthy(setter)
    setter!.call(target, values)
  })

  let getterRan = false
  const target = createReentrantBorrowOrderTestTarget(ReentrantBorrowOrderTest)
  Object.defineProperty(target, '0', {
    enumerable: true,
    get() {
      getterRan = true
      detachReentrantBorrowOrderTestTarget(target)
      return 1
    },
  })

  let error: unknown
  try {
    ReentrantBorrowOrderTest.prototype.replaceValuesFromThis.call(target)
  } catch (caught) {
    error = caught
  } finally {
    t.is(cleanupReentrantBorrowOrderTestTargets(), 1)
  }

  t.true(getterRan)
  t.truthy(error, 'receiver must be unwrapped after injected input conversion')
})

test('shared receiver borrow is held across return-value conversion', (t) => {
  // `EagerReleaseHolder.items` returns `Vec<&str>` borrowed from an
  // `Option<Arc<Vec<String>>>` the `&mut self` `dropInner` method releases.
  // Converting the returned Vec writes JavaScript-observable array indices, so
  // an `Array.prototype` index setter reenters `dropInner` while the `&str`
  // elements still point into the strings it would free. The shared borrow
  // guard held across the whole call must reject that reentrant mutable
  // borrow; the conversion must then complete intact, and `dropInner` must
  // work again once the getter has returned.
  const holder = new EagerReleaseHolder()
  const reenteredAt: number[] = []
  let dropResult: boolean | undefined
  let dropError: unknown

  Object.defineProperty(Array.prototype, '1', {
    configurable: true,
    set(v: unknown) {
      reenteredAt.push(1)
      try {
        dropResult = holder.dropInner()
      } catch (caught) {
        dropError = caught
      }
      Object.defineProperty(this, '1', {
        value: v,
        writable: true,
        enumerable: true,
        configurable: true,
      })
    },
  })

  let items: string[]
  try {
    items = holder.items
  } finally {
    delete (Array.prototype as unknown as Record<string, unknown>)['1']
  }

  // (a) the reentrant mutable call threw the borrow-conflict error
  t.deepEqual(reenteredAt, [1], 'return-value conversion must reenter')
  t.is(dropResult, undefined)
  t.is(
    (dropError as Error)?.message,
    'The same native value cannot be borrowed mutably while another borrow is active',
  )

  // (b) every element converted intact
  t.deepEqual(items, [
    'A'.repeat(256),
    'B'.repeat(256),
    'C'.repeat(256),
    'D'.repeat(256),
  ])

  // (c) the mutable method succeeds after the getter returned
  t.true(holder.dropInner())
  t.false(holder.dropInner())
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

// GHSA-wrm3-6gmv-vpmw: a thenable may invoke the native callback more than
// once. The second invocation must surface as a JS error, not a double free
// of the boxed Rust callback.
test('PromiseRaw callbacks survive a double-invoking thenable', (t) => {
  const doubleThen = {
    // oxlint-disable-next-line unicorn/no-thenable
    then(cb: (v: number) => void) {
      cb(1)
      cb(2)
      return {}
    },
  }
  t.throws(() => callThenOnPromise(doubleThen as any), {
    message: 'Promise then callback was called more than once',
  })
  t.throws(() => callThenOnPromiseCapturing(doubleThen as any, 'tag'), {
    message: 'Promise then callback was called more than once',
  })

  const doubleCatch = {
    catch(cb: (e: unknown) => void) {
      cb('a')
      cb('b')
      return {}
    },
  }
  t.throws(() => callCatchOnPromise(doubleCatch as any), {
    message: 'Promise catch callback was called more than once',
  })
  t.throws(() => callCatchOnPromiseCapturing(doubleCatch as any, 'tag'), {
    message: 'Promise catch callback was called more than once',
  })

  const doubleFinally = {
    finally(cb: () => void) {
      cb()
      cb()
      return {}
    },
  }
  const spy = Sinon.spy()
  t.throws(() => callFinallyOnPromise(doubleFinally as any, spy), {
    message: 'Promise finally callback was called more than once',
  })
  // the first, legitimate invocation still ran
  t.true(spy.calledOnce)
})

// A thenable may stash the callback and invoke it after the object returned
// from `then` has been garbage collected. The boxed callback must live as
// long as the callback function itself is reachable.
test('PromiseRaw callback survives GC of the thenable return value', async (t) => {
  const { setFlagsFromString } = await import('node:v8')
  const { runInNewContext } = await import('node:vm')
  // setFlagsFromString does not update the current context's global; the
  // exposed gc must be pulled out of a freshly created context.
  setFlagsFromString('--expose-gc')
  const gc = runInNewContext('gc') as undefined | (() => void)
  if (!gc) {
    t.pass('gc not exposed; skipping')
    return
  }

  let stash: ((v: number) => string) | undefined
  const stashingThenable = {
    // oxlint-disable-next-line unicorn/no-thenable
    then(cb: (v: number) => string) {
      stash = cb
      return {}
    },
  }
  // the return value (which would carry the finalizer) is intentionally dropped
  callThenOnPromiseCapturing(stashingThenable as any, 'tag')

  for (let i = 0; i < 10; i++) {
    gc()
    await new Promise((resolve) => setImmediate(resolve))
  }

  t.is(stash!(1), 'tag:1')
})

test('PromiseRaw::resolve', async (t) => {
  const result = await createResolvedPromise(42)
  t.is(result, 42)
})

test('PromiseRaw::reject', async (t) => {
  await t.throwsAsync(() => createRejectedPromise('test error message'), {
    message: 'test error message',
  })
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
  if (!process.env.WASI_TEST) {
    t.deepEqual((errors[0]!.cause as Error).message, 'cause')
  }
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
  if (!process.env.WASI_TEST) {
    for (let i = 0; i < 4; i++) {
      t.deepEqual(error!.message, `error${i + 1}`)
      error = error!.cause as Error
    }
  }

  // nullish causes should not be reconstructed as nested errors
  const undefinedCauseError = new Error('undefined cause')
  undefinedCauseError.cause = undefined
  const [errWithUndefinedCause] = jsErrorCallback(undefinedCauseError)
  t.deepEqual(errWithUndefinedCause!.message, 'undefined cause')
  t.is(errWithUndefinedCause!.cause, undefined)

  const nullCauseError = new Error('null cause')
  nullCauseError.cause = null
  const [errWithNullCause] = jsErrorCallback(nullCauseError)
  t.deepEqual(errWithNullCause!.message, 'null cause')
  // A JS `cause` of `null` is never reconstructed as a nested Error. On native
  // the clone shares the original object via `napi_ref`, so `.cause` is exactly
  // `null`. Under WASM emnapi rebuilds the error fresh and the null cause
  // surfaces as nullish — `null` or `undefined` depending on the emnapi build
  // (#3370 hardcoded `void 0`, which its CI matched but a local build did not) —
  // so assert nullish rather than one specific value.
  t.is(errWithNullCause!.cause ?? null, null)

  // Regression for napi-rs#3370: try_clone off the owning JS thread can't share
  // the thread-affine napi_ref, so it returns a reference-less copy that still
  // carries the message instead of a guard placeholder. rolldown depends on this
  // to surface plugin errors (`load error`, `transform hook error`) from its
  // build workers via `try_clone().unwrap_or_else(|e| e)`; the guard used to
  // replace them with its own message. Containment mirrors rolldown's `toContain`
  // (the reason is the coerced `Error: <message>` form).
  const offThreadClonedMessage = tryCloneErrorOffThread(
    new Error('cloned off-thread'),
  )
  t.true(offThreadClonedMessage.includes('cloned off-thread'))
  t.false(
    offThreadClonedMessage.includes(
      'can only be cloned on the thread that owns it',
    ),
  )

  // The off-thread clone rebuilds a fresh Error from the captured fields, so it
  // must keep the cause chain rather than dropping it — the reference-less
  // clone recurses into `cause`.
  const offThreadClonedCause = tryCloneErrorCauseOffThread(
    new Error('outer error', { cause: new Error('inner cause') }),
  )
  t.true(offThreadClonedCause.includes('inner cause'))

  // Cause survival must not depend on clone order: clone on the JS thread first
  // (a ref-sharing clone that keeps a reference-less cause backup), then clone
  // that off-thread. The backup keeps the chain alive.
  const transitiveClonedCause = tryCloneErrorCauseTransitiveOffThread(
    new Error('outer error', { cause: new Error('inner cause') }),
  )
  t.true(transitiveClonedCause.includes('inner cause'))

  // A detached (reference-less) Error tagged PendingException — the shape an
  // off-thread try_clone of a JS-thrown error produces — must actually be
  // thrown, not swallowed by throw_into just because of its status.
  const detachedPending = t.throws(() => throwDetachedPendingException())
  t.is(detachedPending!.message, 'detached pending exception message')

  // Off-thread *fidelity*: a JS-derived Error cloned on a worker thread and then
  // surfaced on the owning JS thread must reuse the ORIGINAL JS object — keeping
  // its stack and arbitrary own properties, not just the message. This is
  // rolldown's plugin-error path; a reference-less clone would rebuild a bare
  // Error(message) and drop the stack + props.
  const richError = (() => {
    function errorFn2() {
      return Object.assign(new Error('offthread fidelity message'), {
        customProp: 8888,
      })
    }
    function errorFn1() {
      return errorFn2()
    }
    return errorFn1()
  })()
  const offThreadRich = t.throws(() =>
    tryCloneErrorOffThreadKeepReference(richError),
  )
  t.true(offThreadRich!.message.includes('offthread fidelity message'))
  if (!process.env.WASI_TEST) {
    // Native shares the JS reference across the off-thread clone: the surfaced
    // error is the very same object, stack and own props intact. (WASM can't
    // hold a cross-thread JS ref, so it rebuilds from the message alone.)
    t.is(offThreadRich, richError)
    t.true(offThreadRich!.stack!.includes('errorFn2'))
    t.is((offThreadRich as unknown as { customProp: number }).customProp, 8888)
  }

  // non-nullish cause should still be preserved
  const [errWithRealCause] = jsErrorCallback(
    new Error('outer', { cause: new Error('inner') }),
  )
  t.deepEqual(errWithRealCause!.message, 'outer')
  if (!process.env.WASI_TEST) {
    t.deepEqual((errWithRealCause!.cause as Error).message, 'inner')
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
  t.deepEqual(
    createI32ArrayFromExternal(),
    new Int32Array([-1, -2, 30000, -40, 5]),
  )
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
  t.deepEqual(
    Buffer.from(arrayBufferFromExternal()),
    Buffer.from('Hello world from external'),
  )
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

test('mutate ArrayBuffer', (t) => {
  if (process.env.WASI_TEST) {
    t.pass()
    return
  }
  const input = new ArrayBuffer(5)
  const view = new Uint8Array(input)
  view[0] = 1
  view[1] = 2
  view[2] = 3
  view[3] = 4
  view[4] = 5
  mutateArraybuffer(input)
  t.deepEqual(view, new Uint8Array([2, 4, 6, 8, 10]))
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

// GHSA-qr54-xrr9-7575: a #[napi] class instance must be rejected as the
// signal, not type-confused with the AbortSignal stack.
AbortSignalTest('class instance is rejected as AbortSignal', (t) => {
  const notASignal = new Animal(Kind.Dog, 'rex')
  t.throws(() => withAbortController(1, 2, notASignal as any), {
    message: 'Value is not an AbortSignal',
  })
  // the instance was not hijacked: its accessors still read class fields
  t.is(notASignal.name, 'rex')
})

// The onabort handler is an extractable function value; calling it with a
// foreign receiver must be rejected instead of casting the receiver's wrap
// payload to the AbortSignal stack.
AbortSignalTest('stolen onabort rejects a foreign receiver', async (t) => {
  const ctrl = new AbortController()
  await withAbortController(1, 2, ctrl.signal)
  const stolen = ctrl.signal.onabort as unknown as () => void
  t.throws(() => stolen.call(new Animal(Kind.Cat, 'felix')), {
    message: 'Value is not an AbortSignal',
  })
})

AbortSignalTest('two tasks can share one AbortSignal', async (t) => {
  const ctrl = new AbortController()
  const [a, b] = await Promise.all([
    withAbortController(1, 2, ctrl.signal),
    withAbortController(3, 4, ctrl.signal),
  ])
  t.is(a, 3)
  t.is(b, 7)
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

test('async task with ArrayBuffer', async (t) => {
  const inputData = new Uint8Array([1, 2, 3, 4, 5])
  const result = await asyncTaskArraybuffer(Array.from(inputData))

  t.true(result instanceof ArrayBuffer)
  t.is(result.byteLength, 5)

  const view = new Uint8Array(result)
  t.deepEqual(Array.from(view), [1, 2, 3, 4, 5])

  // Test with empty array
  const emptyResult = await asyncTaskArraybuffer([])
  t.true(emptyResult instanceof ArrayBuffer)
  t.is(emptyResult.byteLength, 0)

  // Test with larger data
  const largeData = new Uint8Array(1000).fill(42)
  const largeResult = await asyncTaskArraybuffer(Array.from(largeData))
  t.true(largeResult instanceof ArrayBuffer)
  t.is(largeResult.byteLength, 1000)
  const largeView = new Uint8Array(largeResult)
  t.is(largeView[0], 42)
  t.is(largeView[999], 42)
})

AbortSignalTest('with abort signal handle', async (t) => {
  const ctrl = new AbortController()
  const promise = withAbortSignalHandle(ctrl.signal)
  try {
    ctrl.abort()
    const ret = await promise
    t.is(ret, 999)
  } catch (err: unknown) {
    // sometimes on CI, the scheduled task is able to abort
    // so we only allow it to throw AbortError
    t.is((err as Error).message, 'AbortError')
  }
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
  await t.throwsAsync(() => asyncPlus100(Promise.reject(fxError)), {
    message: fxError.message,
  })
})

Napi4Test('Promise rejection is captured without coercion', async (t) => {
  // `describePromiseRejection` reports `"<status>|<reason>|<cause chain>"`, with
  // `-` for "no cause".
  //
  // A rejection value that N-API cannot reference directly. This used to fail
  // `napi_create_reference` and surface as `InvalidArg|Create Error reference
  // failed`, destroying the thrown value.
  t.is(
    await describePromiseRejection(Promise.reject('boom')),
    'GenericFailure|boom|-',
  )
  t.is(await describePromiseRejection(Promise.reject(42)), 'GenericFailure||-')
  t.is(
    await describePromiseRejection(Promise.reject(null)),
    'GenericFailure||-',
  )
  t.is(
    await describePromiseRejection(Promise.reject(undefined)),
    'GenericFailure||-',
  )
  // Real errors keep their own message; it is read, never coerced.
  t.is(
    await describePromiseRejection(Promise.reject(new TypeError('nope'))),
    'GenericFailure|nope|-',
  )
  t.is(
    await describePromiseRejection(Promise.resolve(undefined)),
    'resolved||-',
  )
})

Napi4Test('a `message` accessor is never invoked', async (t) => {
  // The central claim of the non-coercing capture: `reason` is built only from
  // data readable *without running JavaScript*. `message` is looked up with
  // `Reflect.getOwnPropertyDescriptor` walking the prototype chain, so a data
  // property is read and an accessor is detected and left alone — where a plain
  // `napi_get_named_property` would have called it.
  let invocations = 0
  const observable = new Error('own message')
  Object.defineProperty(observable, 'message', {
    configurable: true,
    get() {
      invocations += 1
      return 'from the accessor'
    },
  })
  t.is(
    await describePromiseRejection(Promise.reject(observable)),
    'GenericFailure|JavaScript Error|-',
  )
  t.is(invocations, 0)

  // Same for an accessor inherited from a subclass prototype.
  let protoInvocations = 0
  class AccessorError extends Error {
    override get message() {
      protoInvocations += 1
      return 'from the prototype accessor'
    }
  }
  t.is(
    await describePromiseRejection(Promise.reject(new AccessorError())),
    'GenericFailure|JavaScript Error|-',
  )
  t.is(protoInvocations, 0)

  // A throwing accessor cannot even be reached, so nothing has to be contained —
  // but assert the environment is still clean afterwards.
  let throwingInvocations = 0
  const hostile = new Error('ignored')
  Object.defineProperty(hostile, 'message', {
    configurable: true,
    get() {
      throwingInvocations += 1
      throw new Error('thrown by the message accessor')
    },
  })
  t.is(
    await describePromiseRejection(Promise.reject(hostile)),
    'GenericFailure|JavaScript Error|-',
  )
  t.is(throwingInvocations, 0)
  t.is(
    await describePromiseRejection(Promise.resolve(undefined)),
    'resolved||-',
  )

  // A `message` data property up the prototype chain is still found: the walk
  // exists so this keeps working.
  class DataError extends Error {}
  DataError.prototype.message = 'from the prototype data property'
  t.is(
    await describePromiseRejection(Promise.reject(new DataError())),
    'GenericFailure|from the prototype data property|-',
  )
  // `new Error()` has no own `message`; `Error.prototype.message` is `''`.
  t.is(
    await describePromiseRejection(Promise.reject(new Error())),
    'GenericFailure||-',
  )
})

Napi4Test('the `cause` chain survives the capture', async (t) => {
  // `Error::cause` used to be hardcoded to `None` here, which lost the cause on
  // the fallback path — off-thread or a foreign env, exactly where the retained
  // value is gone and `JsError::into_value` has to rebuild the error from
  // `reason`/`cause`.
  t.is(
    await describePromiseRejection(
      Promise.reject(
        new TypeError('the message', { cause: new RangeError('the cause') }),
      ),
    ),
    'GenericFailure|the message|the cause',
  )
  // The chain is followed, not just the first link.
  t.is(
    await describePromiseRejection(
      Promise.reject(
        new Error('L1', { cause: new Error('L2', { cause: new Error('L3') }) }),
      ),
    ),
    'GenericFailure|L1|L2<L3',
  )
  // A primitive cause is copied verbatim rather than coerced or dropped.
  t.is(
    await describePromiseRejection(
      Promise.reject(new Error('outer', { cause: 'just a string' })),
    ),
    'GenericFailure|outer|just a string',
  )
  // ...and a `get cause()` accessor is no more welcome than a `get message()`.
  let invocations = 0
  const hostile = new Error('accessor cause')
  Object.defineProperty(hostile, 'cause', {
    configurable: true,
    get() {
      invocations += 1
      return new Error('should never be read')
    },
  })
  t.is(
    await describePromiseRejection(Promise.reject(hostile)),
    'GenericFailure|accessor cause|-',
  )
  t.is(invocations, 0)

  // A cyclic chain terminates at the depth limit instead of recursing until the
  // stack runs out, which is what `From<Unknown>` does on this input.
  const a = new Error('A')
  const b = new Error('B')
  a.cause = b
  b.cause = a
  t.is(
    await describePromiseRejection(Promise.reject(a)),
    'GenericFailure|A|B<A<B<A<B<A<B<A',
  )
})

test('capture never performs a [[Get]] on the global Reflect', (t) => {
  // napi-rs#3423. `globalThis.Reflect` is configurable, so user code can
  // redefine it as an accessor, and reading it off the global per capture is an
  // ordinary `[[Get]]` — the accessor would run, mid-unwind, exactly the
  // arbitrary-user-code hazard the descriptor discipline exists to avoid. The
  // `Reflect.getOwnPropertyDescriptor` pair is therefore cached per env at
  // module registration: a post-load accessor must never fire during capture,
  // and capture keeps full fidelity because the load-time intrinsic still does
  // the reads.
  //
  // The patch window is fully synchronous, so no concurrent test can observe
  // the patched global, and every getter hit counted here was caused by the
  // capture calls between the two defineProperty calls.
  //
  // On the WASI lanes the addon's env lives in its own realm whose `Reflect`
  // this patch does not reach, so the hit counter is trivially 0 there; the
  // fidelity and identity assertions still hold. The native lane is the
  // meaningful one.
  const realReflect = globalThis.Reflect
  const realDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'Reflect')!
  let hits = 0
  let described: string
  let identity: unknown
  const value = new TypeError('the message', {
    cause: new RangeError('the cause'),
  })
  Object.defineProperty(globalThis, 'Reflect', {
    configurable: true,
    get() {
      hits += 1
      return realReflect
    },
  })
  try {
    described = describeCapturedValue(value)
    identity = jsErrorFromRetainedValue(value)
  } finally {
    Object.defineProperty(globalThis, 'Reflect', realDescriptor)
  }
  t.is(hits, 0, 'a hostile Reflect accessor must not fire during capture')
  t.is(described, 'GenericFailure|the message|the cause')
  t.is(identity, value)
})

test('capture survives a deleted global Reflect with full fidelity', (t) => {
  // With the registration-time cache, a post-load `delete globalThis.Reflect`
  // cannot degrade capture. A per-call lookup would collapse the reason to
  // "JavaScript Error" and lose the cause here, so this is the mutation guard
  // for removing the cache. Synchronous window, as above.
  const realDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'Reflect')!
  let described: string
  try {
    delete (globalThis as { Reflect?: unknown }).Reflect
    described = describeCapturedValue(
      new TypeError('kept', { cause: 'and this too' }),
    )
  } finally {
    Object.defineProperty(globalThis, 'Reflect', realDescriptor)
  }
  t.is(described, 'GenericFailure|kept|and this too')
})

test('capture ignores a post-load replacement of Reflect', (t) => {
  // Same property from the other side: overwriting `Reflect` with a data
  // property that has no usable `getOwnPropertyDescriptor` must not degrade
  // capture either — the cache pinned the load-time pair. Synchronous window.
  const realDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'Reflect')!
  let described: string
  try {
    ;(globalThis as { Reflect?: unknown }).Reflect = {}
    described = describeCapturedValue(
      new TypeError('still read', { cause: new Error('still walked') }),
    )
  } finally {
    Object.defineProperty(globalThis, 'Reflect', realDescriptor)
  }
  t.is(described, 'GenericFailure|still read|still walked')
})

Napi4Test(
  'a rejected promise settles JavaScript with the identical value',
  async (t) => {
    // The central claim: the value is retained, not coerced, so it comes back as
    // *itself*. Asserting the message is not enough — a synthesized `Error`
    // carrying the same message would pass that and fail this.
    const rejections: [string, unknown][] = [
      ['string', 'boom'],
      ['number', 42],
      ['null', null],
      ['undefined', undefined],
      ['boolean', false],
      ['bigint', 7n],
      ['symbol', Symbol('marker')],
      ['plain object', { tag: 'marker' }],
      ['array', [1, 2, 3]],
      ['function', function marker() {}],
      ['Error', new TypeError('a real error')],
    ]
    for (const [label, value] of rejections) {
      const settled = await asyncPlus100(Promise.reject(value)).then(
        (resolved) => ({ rejected: false, value: resolved as unknown }),
        (reason: unknown) => ({ rejected: true, value: reason }),
      )
      t.true(settled.rejected, `${label} should reject`)
      t.is(settled.value, value, `${label} should reject with the same value`)
    }
  },
)

test('an AsyncTask rejecting with a captured value settles with the identical value', async (t) => {
  // Same contract as the deferred/promise settlement paths, on the
  // `napi_create_async_work` completion path: an `Error` captured on the JS
  // thread with `Error::from_unknown_without_coercion`, carried through
  // `Task::compute` on the libuv thread and handed back by the default
  // `Task::reject`, must reject the promise with the retained value itself.
  // Asserting the message is not enough — the bug this guards against
  // (`JsError::into_value`'s `napi_is_error` gate on the completion path)
  // produced a synthesized `Error` carrying the same reason.
  const rejections: [string, unknown][] = [
    ['string', 'boom'],
    ['number', 42],
    ['null', null],
    ['undefined', undefined],
    ['boolean', false],
    ['bigint', 7n],
    ['symbol', Symbol('marker')],
    ['plain object', { tag: 'marker' }],
    ['array', [1, 2, 3]],
    ['function', function marker() {}],
    ['Error', new TypeError('a real error')],
  ]
  for (const [label, value] of rejections) {
    const settled = await asyncTaskRejectWithCapturedValue(value).then(
      (resolved) => ({ rejected: false, value: resolved as unknown }),
      (reason: unknown) => ({ rejected: true, value: reason }),
    )
    t.true(settled.rejected, `${label} should reject`)
    t.is(settled.value, value, `${label} should reject with the same value`)
  }
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

test('a primitive thrown from a ThreadsafeFunction callback is delivered, not fatal', async (t) => {
  // `napi_create_reference` rejects every non-object below Node-API 10, so
  // retaining the thrown value used to fail here and take the process down:
  // reporting the failure as the callback's own status raised a fatal exception
  // for an error that had already been delivered.
  const thrown = 'a primitive string'
  const settled = await tsfnThrowFromJs(() => {
    throw thrown
  }).then(
    (resolved) => ({ rejected: false, value: resolved as unknown }),
    (reason: unknown) => ({ rejected: true, value: reason }),
  )
  t.true(settled.rejected)
  t.is(settled.value, thrown)
})

test('a value thrown from a ThreadsafeFunction callback keeps its identity', async (t) => {
  // Same contract as a promise rejection: JavaScript may throw *anything* and
  // the value has to come back as itself. Asserting the message is not enough —
  // a synthesized `Error` carrying the same message would pass that and fail
  // this. `throw null` and `throw Symbol()` additionally used to leave a second
  // exception pending in the env (`napi_coerce_to_string` throws on a symbol).
  const thrown: [string, unknown][] = [
    ['string', 'a primitive string'],
    ['number', 42],
    ['null', null],
    ['undefined', undefined],
    ['boolean', false],
    ['bigint', 7n],
    ['symbol', Symbol('marker')],
    ['plain object', { tag: 'marker' }],
    ['array', [1, 2, 3]],
    ['function', function marker() {}],
    ['Error', new TypeError('a real error')],
  ]
  for (const [label, value] of thrown) {
    const settled = await tsfnThrowFromJsCatchRecover(() => {
      throw value
    }).then(
      (resolved) => ({ rejected: false, value: resolved as unknown }),
      (reason: unknown) => ({ rejected: true, value: reason }),
    )
    t.true(settled.rejected, `${label} should reject`)
    t.is(settled.value, value, `${label} should reject with itself`)
  }
})

const RETAINED_VALUES: [string, unknown][] = [
  ['string', 'a primitive string'],
  ['number', 42],
  ['null', null],
  ['undefined', undefined],
  ['boolean', false],
  ['bigint', 7n],
  ['symbol', Symbol('marker')],
  ['plain object', { tag: 'marker' }],
  ['array', [1, 2, 3]],
  ['function', function marker() {}],
]

test('Env::create_error never hands back a retained non-error value', (t) => {
  // `from_unknown_without_coercion` retains whatever JavaScript handed over,
  // which is exactly right where the value must come back as itself — a promise
  // rejection, an `AsyncGenerator.throw()`, a throw out of a ThreadsafeFunction
  // callback, and every `ToNapiValue` conversion feeding them.
  //
  // `Env::create_error` is not a conversion. It *constructs* an error object and
  // is documented to return one, so it used to be the odd one out: given an
  // `Error` that retained `42` it returned the number `42`, after which every
  // object operation the caller performed on the "error" silently no-oped.
  for (const [label, value] of RETAINED_VALUES) {
    const result = createErrorFromRetainedValue(value)
    t.true(
      result instanceof Error,
      `create_error should synthesize an Error for a retained ${label}`,
    )
    t.not(
      result,
      value,
      `create_error should not hand back the retained ${label} itself`,
    )
  }
  // A retained *error* is still reused verbatim: gating on `napi_is_error` is
  // what preserves identity where identity is meaningful.
  const real = new TypeError('a real error')
  t.is(createErrorFromRetainedValue(real), real)
  // And the result is a real object, so the operations the caller performs on it
  // actually take effect.
  const synthesized = createErrorFromRetainedValue(42) as { marker?: number }
  synthesized.marker = 1
  t.is(synthesized.marker, 1)
})

test('the JsError wrappers convert a retained value back verbatim', (t) => {
  // The other half of the same rule, and the reason `Env::create_error` had to be
  // singled out rather than gating everything: `ToNapiValue for JsError` and
  // friends are conversions, on exactly the same footing as `ToNapiValue for
  // Error`. An addon returning `JsTypeError::from(Error::from_unknown_without_
  // coercion(value))` is relaying a value JavaScript chose, so JavaScript gets it
  // back as itself — no `napi_is_error` gate, no synthesized replacement.
  const converters: [string, (value: unknown) => unknown][] = [
    ['JsError', jsErrorFromRetainedValue],
    ['JsTypeError', jsTypeErrorFromRetainedValue],
    ['JsRangeError', jsRangeErrorFromRetainedValue],
  ]
  for (const [api, convert] of converters) {
    for (const [label, value] of RETAINED_VALUES) {
      t.is(
        convert(value),
        value,
        `${api} should hand the retained ${label} back verbatim`,
      )
    }
    const real = new TypeError('a real error')
    t.is(
      convert(real),
      real,
      `${api} should hand a retained Error back verbatim`,
    )
  }
})

test('the JsError wrappers keep their subclass when there is nothing to reuse', (t) => {
  // The bug a plain revert would reintroduce. With no retained value the
  // conversion has to synthesize, and it must use the constructor its wrapper
  // names. Delegating to `ToNapiValue for Error` fell back to
  // `JsError::into_value`, so every `JsTypeError`/`JsRangeError` built in Rust
  // arrived in JavaScript as a plain `Error`.
  const plain = jsErrorWithoutRetainedValue('plain') as Error
  t.is(plain.constructor.name, 'Error')
  t.is(plain.message, 'plain')

  const type = jsTypeErrorWithoutRetainedValue('typed') as Error
  t.true(type instanceof TypeError)
  t.is(type.constructor.name, 'TypeError')
  t.is(type.message, 'typed')

  const range = jsRangeErrorWithoutRetainedValue('ranged') as Error
  t.true(range instanceof RangeError)
  t.is(range.constructor.name, 'RangeError')
  t.is(range.message, 'ranged')
})

test('call_async_catch catches throw from CalleeHandled=false ThreadsafeFunction', async (t) => {
  await t.throwsAsync(
    () =>
      tsfnThrowFromJsCatch((arg) => {
        throw new Error(arg)
      }),
    {
      message: 'foo',
    },
  )
})

test('call_async_catch on CalleeHandled=true ThreadsafeFunction propagates throw', async (t) => {
  await t.throwsAsync(
    () =>
      tsfnThrowFromJsCatchHandled((_err, arg) => {
        throw new Error(arg)
      }),
    {
      message: 'foo',
    },
  )
})

test('call_async_catch preserves original JS exception object', async (t) => {
  const thrown = new Error('foo')
  // @ts-expect-error custom property on Error
  thrown.code = 'E_FOO'
  const err = await t.throwsAsync(() =>
    tsfnThrowFromJsCatchRecover(() => {
      throw thrown
    }),
  )
  // The Rust side propagates the original napi::Error; its maybe_ref reference
  // round-trips back through ToNapiValue for Error, so JS receives the exact
  // same Error instance that was thrown, with custom properties intact.
  // @ts-expect-error reading custom property on Error
  t.is(err?.code, 'E_FOO')
  t.is(err?.message, 'foo')
  t.is(err, thrown)
})

test('a JS exception keeps its subclass, cause and own properties', async (t) => {
  // The shape a real addon sees: user code throws an `Error` subclass carrying
  // `cause` and custom fields. Everything but the message used to be erased on
  // wasm, where the exception object was not referenced at all.
  const cause = new RangeError('the cause')
  const thrown = new TypeError('the message', { cause })
  // @ts-expect-error custom property on Error
  thrown.code = 'E_CUSTOM'
  // @ts-expect-error custom property on Error
  thrown.detail = { nested: [1, 2, 3] }

  const err = await t.throwsAsync(() =>
    tsfnThrowFromJsCatchRecover(() => {
      throw thrown
    }),
  )
  t.is(err, thrown)
  t.true(err instanceof TypeError)
  t.is(err?.message, 'the message')
  t.is(err?.cause, cause)
  // @ts-expect-error reading custom property on Error
  t.is(err?.code, 'E_CUSTOM')
  // @ts-expect-error reading custom property on Error
  t.deepEqual(err?.detail, { nested: [1, 2, 3] })
})

Napi4Test(
  'a rejected promise keeps its subclass, cause and own properties',
  async (t) => {
    // Same identity requirement on the other capture path: `Promise` rejection,
    // which reaches Rust through `Error::from_unknown_without_coercion`.
    const cause = new RangeError('the cause')
    const rejection = new TypeError('the message', { cause })
    // @ts-expect-error custom property on Error
    rejection.code = 'E_CUSTOM'

    const err = await t.throwsAsync(() =>
      asyncPlus100(Promise.reject(rejection)),
    )
    t.is(err, rejection)
    t.true(err instanceof TypeError)
    t.is(err?.cause, cause)
    // @ts-expect-error reading custom property on Error
    t.is(err?.code, 'E_CUSTOM')
  },
)

test('napi::Error from a JS sync throw can be dropped on another thread', async (t) => {
  // https://github.com/rolldown/rolldown/issues/10075
  // On wasm targets this used to crash the wasi worker with
  // `Cannot read properties of undefined (reading 'checkGCAccess')`.
  const reason = await tsfnThrowFromJsCatchDropInThread(() => {
    throw new Error('foo')
  })
  t.true(reason.includes('foo'))
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

Napi4Test('ThreadsafeFunction creation pins the addon image', (t) => {
  // napi-rs#3423. Node unloads an addon once the environment that loaded it
  // goes away and no other environment holds it; on Windows that unmaps the
  // image. A ThreadsafeFunction handle's destructor is code in that image and
  // runs on whichever thread drops it last, which can be a foreign thread that
  // outlives the environment.
  //
  // Retention therefore has to happen at creation, on the environment's own
  // thread. Doing it only after a failed release misses the case that matters:
  // environment teardown finalizes the threadsafe function first, which marks
  // the handle aborted, and Drop then takes its no-op branch and never reaches
  // the release-failure path at all.
  //
  // wasm has no loader to pin and no image to unmap, so the counter is always
  // 0 there and there is nothing to assert.
  if (process.env.WASI_TEST) {
    t.pass()
    return
  }
  const before = moduleRetentionRequests()
  acceptThreadsafeFunction(() => {})
  const after = moduleRetentionRequests()
  t.true(
    after > before,
    `creating a ThreadsafeFunction must request module retention (${before} -> ${after})`,
  )
})

test('capturing a JS value into an Error pins the addon image', (t) => {
  // napi-rs#3423, same hazard as the ThreadsafeFunction pin above: an `Error`
  // is `Send`, so the `Arc<ErrorRef>` created by
  // `Error::from_unknown_without_coercion` (and by `From<Unknown>`) can make
  // its last drop on a detached thread after the worker that created it — and
  // with it the only environment holding a worker-only addon — is gone.
  // `ErrorRef::drop` is code in the unloaded image and crashes on entry, before
  // it could observe the aborted custom-GC handle. Retention must therefore be
  // requested when the `ErrorRef` is created, on the env's thread, before the
  // value can escape.
  //
  // wasm has no loader to pin and no image to unmap, so the counter is always
  // 0 there and there is nothing to assert.
  if (process.env.WASI_TEST) {
    t.pass()
    return
  }
  const before = moduleRetentionRequests()
  const captured = jsErrorFromRetainedValue({ tag: 'pin me' })
  const after = moduleRetentionRequests()
  t.true(
    after > before,
    `capturing a JS value into an Error must request module retention (${before} -> ${after})`,
  )
  t.truthy(captured)
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

test('reading a stream that errors does not abort the process', async (t) => {
  if (process.version.startsWith('v18')) {
    t.pass('Skip when Node.js is 18 and WASI due to bug')
    return
  }
  // The consumer drops the read error on the Tokio thread. Before the owned-error
  // conversion this released a JS napi_ref off the JS thread and aborted the process;
  // now it resolves cleanly with the count of chunks read before the error.
  // Error on the second pull so the first chunk is actually delivered (calling
  // error() synchronously after enqueue would discard the queued chunk).
  let pulls = 0
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulls++ === 0) {
        controller.enqueue(new Uint8Array([1, 2, 3]))
      } else {
        controller.error(new Error('boom'))
      }
    },
  })
  t.is(await drainStreamCount(stream), 1)
})

test('reading a stream whose read() throws synchronously does not abort the process', async (t) => {
  if (process.version.startsWith('v18')) {
    t.pass('Skip when Node.js is 18 and WASI due to bug')
    return
  }
  // Regression: a synchronous throw from read() makes the threadsafe call wrap the
  // JS exception in a Rust Error that owns a napi_ref. That error must be rebuilt as
  // an owned, reference-free error on the JS thread before it is surfaced/dropped on
  // the Tokio runtime thread; otherwise releasing the napi_ref off the JS thread
  // aborts the process. drainStreamCount swallows the error, so a clean run resolves
  // with 0 chunks read.
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]))
    },
  })
  // Shadow getReader on this instance so napi binds a read() that throws synchronously.
  ;(stream as unknown as { getReader: () => unknown }).getReader = () => ({
    read() {
      throw new Error('synchronous read throw')
    },
    releaseLock() {},
  })
  t.is(await drainStreamCount(stream), 0)
})

test('reading a stream that rejects with a throwing message getter does not abort or hang', async (t) => {
  if (process.version.startsWith('v18')) {
    t.pass('Skip when Node.js is 18 and WASI due to bug')
    return
  }
  // The rejection value's `message` getter throws, so napi's message probe leaves a
  // pending JS exception. It must be cleared on the JS thread before the read error is
  // surfaced; otherwise the consumer is left with an independently pending exception.
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      const evil = {}
      Object.defineProperty(evil, 'message', {
        get() {
          throw new Error('message getter throw')
        },
      })
      controller.error(evil)
    },
  })
  t.is(await drainStreamCount(stream), 0)
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
  // @ts-expect-error ReadableStream polyfill types conflict
  const streamFromClass = await createReadableStreamFromClass(ReadableStream)
  const chunksFromClass = []
  for await (const chunk of streamFromClass) {
    chunksFromClass.push(chunk)
  }
  t.is(Buffer.concat(chunksFromClass).toString('utf-8'), 'hello'.repeat(100))
})

test('an erroring output ReadableStream rejects without corrupting the heap', async (t) => {
  if (process.env.WASI_TEST) {
    t.pass('Skip when WASI: create_with_stream_bytes is native (tokio) only')
    return
  }
  // Regression guard for the off-thread `FunctionRef` drop. When a
  // `create_with_stream_bytes` output rejects, napi drops the pull resolver — which
  // owns the controller's `enqueue`/`close` `FunctionRef`s — on a Tokio worker
  // thread. Before the fix, `FunctionRef::drop` deleted those thread-affine
  // `napi_ref`s off the JS thread, corrupting V8's handle table; the process then
  // crashed (SIGSEGV/SIGBUS) once the JS thread next touched the damaged heap.
  // Rejects are fanned out concurrently and interleaved with allocation churn so the
  // corruption reliably surfaces; a clean run survives every round and each stream
  // rejects.
  const drain = async () => {
    const reader = createErroringReadableStream().getReader()
    for (;;) {
      const { done } = await reader.read()
      if (done) break
    }
  }
  for (let round = 0; round < 60; round++) {
    await Promise.all(
      Array.from({ length: 32 }, () =>
        drain().then(
          () => t.fail('erroring stream should reject'),
          () => {
            // churn the JS heap so a corrupted V8 handle slot is reused and faults
            for (let k = 0; k < 200; k++)
              void { a: k, b: `s${k}`.repeat(4), c: [k] }
          },
        ),
      ),
    )
  }
  t.pass()
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
    t.truthy(chunk?.something, `Element ${index} doesn't have chunk.something`)
    t.is(chunk.something.hello, '', `Element ${index} hello is an empty string`)
    t.is(chunk.name, '', `Element ${index} name is not an empty string`)
    t.is(chunk.size, index, `Element ${index} size has to be ${index}`)
  })
})

test('readable stream cancellation should cleanup resources', async (t) => {
  if (process.env.WASI_TEST) {
    t.pass(
      'Skip when WASI because ReadableStream controller.enqueue does not accept SharedArrayBuffer',
    )
    return
  }
  const stream = await createReadableStreamWithObject()
  const reader = stream.getReader()

  // Read a couple items
  const first = await reader.read()
  t.false(first.done)
  t.is(first.value?.size, 0)

  const second = await reader.read()
  t.false(second.done)
  t.is(second.value?.size, 1)

  // Cancel early - this should trigger the cancel callback and cleanup resources
  await t.notThrowsAsync(async () => {
    await reader.cancel('user cancelled')
  })

  // Subsequent reads should return done
  const afterCancel = await reader.read()
  t.true(afterCancel.done)
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
