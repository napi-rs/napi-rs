import {
  instantiateNapiModuleSync as __emnapiInstantiateNapiModuleSync,
  WASI as __WASI,
} from '@napi-rs/wasm-runtime'
import { createContext as __emnapiCreateContext } from '@emnapi/runtime'
import { memfs, Buffer } from '@napi-rs/wasm-runtime/fs'

const unsupportedWasiFunctions = new Set([
  'abandonDeferredClones',
  'armTokioBlockingTlsRetirementProbe',
  'armTokioWorkerTlsRetirementProbe',
  'assignClassInstanceAcrossDuplicateLoad',
  'assignClassInstanceFromLaterTurn',
  'assignClampedSliceAcrossDuplicateLoad',
  'assignTypedArraySliceAcrossDuplicateLoad',
  'cancelAsyncWorkLifecycle',
  'configureTokioThreadStopFileBarrier',
  'convertClampedSliceAcrossDuplicateLoad',
  'convertTypedArraySliceAcrossDuplicateLoad',
  'copyExternalTokenAlias',
  'createExternalPublicBorrowProbe',
  'createExternalRefProvenanceProbe',
  'createExternalTokenGcProbe',
  'createMutableTypedArrayForOwnershipTest',
  'createPanickingAsyncWork',
  'createQueuedAsyncWorkLifecycle',
  'createResolvePanickingAsyncWork',
  'createRunningAsyncWorkLifecycle',
  'deferredFinalizeCallbackCount',
  'disposeAsyncWorkLifecycle',
  'disposeThreadsafeFunctionForEnvOwnership',
  'externalTokenGcProbeFinalizeCount',
  'fetch',
  'inspectExternalRefAcrossDuplicateLoad',
  'inspectExternalTokenGcProbe',
  'mutableTypedArrayFinalizeCount',
  'panickingAsyncWorkFinallyCount',
  'prepareTsfnBlockingCallRegression',
  'prepareTsfnTeardownRegression',
  'referThreadsafeFunctionForEnvOwnership',
  'registerDeferredCleanupOrderProbe',
  'registerLateDeferredFinalizeCallback',
  'releaseAsyncWorkLifecycle',
  'resolvePanickingAsyncWorkFinallyCount',
  'restartTokioRuntimeAfterRetirement',
  'returnTypedArraySliceMutAcrossDuplicateLoad',
  'returnTypedArraySliceRefAcrossDuplicateLoad',
  'settleDeferredBeforeFinalizeRegistration',
  'settleDeferredClone',
  'stashBufferAcrossDuplicateLoad',
  'stashClassInstanceForLaterTurn',
  'stashErrorAcrossDuplicateLoad',
  'stashExternalRefAcrossDuplicateLoad',
  'stashExternalRefForTeardown',
  'stashThreadsafeFunctionForEnvOwnership',
  'stashTypedArrayAcrossDuplicateLoad',
  'stashTypedArraySlicesAcrossDuplicateLoad',
  'startDeferredTeardownRace',
  'startReferencedTsfnFinalizerLivenessWorker',
  'startWeakTsfnFinalizerLivenessWorker',
  'takeAdditionalBorrowedValueAcrossDuplicateLoad',
  'takeBorrowedValueAcrossDuplicateLoad',
  'takeBufferAcrossDuplicateLoad',
  'takeBufferSliceIntoBufferAcrossDuplicateLoad',
  'takeBufferSliceRefAcrossDuplicateLoad',
  'takeClassInstanceFromLaterTurn',
  'takeExternalRefAcrossDuplicateLoad',
  'takeReferenceValueAcrossDuplicateLoad',
  'takeTypedArrayAcrossDuplicateLoad',
  'throwErrorAcrossDuplicateLoad',
  'tokioRuntimeLifecycleValue',
  'unrefThreadsafeFunctionForEnvOwnership',
  'verifyReferenceValuesRejectNativeThread',
  'verifyThreadsafeFunctionOwnerEnv',
  'verifyTypedArraySlicesSameEnv',
  'waitForTokioRuntimeRetirement',
  'withAdditionalBorrowedValuesAcrossDuplicateLoad',
  'withBorrowedValuesAcrossDuplicateLoad',
  'withReferenceValuesAcrossDuplicateLoad',
])

function getWasiBindingExport(name) {
  const value = __napiModule.exports[name]
  if (value !== undefined || !unsupportedWasiFunctions.has(name)) {
    return value
  }
  return function unsupportedWasiFunction() {
    const error = new Error(
      `The "${name}" export is not supported by this WASI binding`,
    )
    error.code = 'NAPI_RS_UNSUPPORTED_WASI_EXPORT'
    throw error
  }
}

export const { fs: __fs, vol: __volume } = memfs()

const __wasi = new __WASI({
  version: 'preview1',
  fs: __fs,
  preopens: {
    '/': '/',
  },
})

const __wasmUrl = new URL('./example.wasm32-wasip1.wasm', import.meta.url).href
const __wasmResponse = await globalThis.fetch(__wasmUrl)
if (!__wasmResponse.ok) {
  throw new Error(
    'Failed to fetch WASI module ' +
      __wasmUrl +
      ': ' +
      __wasmResponse.status +
      ' ' +
      (__wasmResponse.statusText || 'Unknown Status'),
  )
}
const __wasmFile = await __wasmResponse.arrayBuffer()

const __wasmMemory = new WebAssembly.Memory({
  initial: 16384,
  maximum: 65536,
})

const __emnapiContext = __emnapiCreateContext()

function __createInitializationCleanupError(__error, __cleanupError) {
  let __message = 'WASI module initialization failed'
  try {
    if (__error && typeof __error.message === 'string') {
      __message = __error.message
    }
  } catch {}
  const __errors = [__error, __cleanupError]
  const __AggregateError = globalThis.AggregateError
  const __combinedError =
    typeof __AggregateError === 'function'
      ? new __AggregateError(__errors, __message)
      : new Error(__message)
  if (!('errors' in __combinedError)) {
    __combinedError.errors = __errors
  }
  __combinedError.cause = __error
  return __combinedError
}

let __napiInstance
let __wasiModule
let __napiModule

try {
  __emnapiContext.feature.Buffer = Buffer

  ;({
    instance: __napiInstance,
    module: __wasiModule,
    napiModule: __napiModule,
  } = __emnapiInstantiateNapiModuleSync(__wasmFile, {
    context: __emnapiContext,
    asyncWorkPoolSize: 0,
    wasi: __wasi,
    overwriteImports(importObject) {
      importObject.env = {
        ...importObject.env,
        ...importObject.napi,
        ...importObject.emnapi,
        memory: __wasmMemory,
      }
      return importObject
    },
    beforeInit({ instance }) {
      for (const name of Object.keys(instance.exports)) {
        if (name.startsWith('__napi_register__')) {
          instance.exports[name]()
        }
      }
    },
  }))
} catch (__error) {
  try {
    await __emnapiContext.destroy()
  } catch (__cleanupError) {
    throw __createInitializationCleanupError(__error, __cleanupError)
  }
  throw __error
}
export default __napiModule.exports
export const AlignedZst = __napiModule.exports.AlignedZst
export const Animal = __napiModule.exports.Animal
export const AnimalWithDefaultConstructor =
  __napiModule.exports.AnimalWithDefaultConstructor
export const AnotherClassForEither = __napiModule.exports.AnotherClassForEither
export const AnotherCssStyleSheet = __napiModule.exports.AnotherCssStyleSheet
export const AnotherCSSStyleSheet = __napiModule.exports.AnotherCSSStyleSheet
export const Asset = __napiModule.exports.Asset
export const JsAsset = __napiModule.exports.JsAsset
export const Assets = __napiModule.exports.Assets
export const JsAssets = __napiModule.exports.JsAssets
export const AsyncComplexTypeGenerator =
  __napiModule.exports.AsyncComplexTypeGenerator
export const AsyncDataSource = __napiModule.exports.AsyncDataSource
export const AsyncFib = __napiModule.exports.AsyncFib
export const AsyncGeneratorSetupFailure =
  __napiModule.exports.AsyncGeneratorSetupFailure
export const AsyncIteratorAdmissionProbe =
  __napiModule.exports.AsyncIteratorAdmissionProbe
export const AsyncIteratorConstructor =
  __napiModule.exports.AsyncIteratorConstructor
export const AsyncIteratorIntoInstance =
  __napiModule.exports.AsyncIteratorIntoInstance
export const AsyncReentrantGenerator =
  __napiModule.exports.AsyncReentrantGenerator
export const AsyncThrowClass = __napiModule.exports.AsyncThrowClass
export const Bird = __napiModule.exports.Bird
export const Blake2BHasher = __napiModule.exports.Blake2BHasher
export const Blake2bHasher = __napiModule.exports.Blake2bHasher
export const Blake2BKey = __napiModule.exports.Blake2BKey
export const Blake2bKey = __napiModule.exports.Blake2bKey
export const CatchOnConstructor = __napiModule.exports.CatchOnConstructor
export const CatchOnConstructor2 = __napiModule.exports.CatchOnConstructor2
export const ClassInArray = __napiModule.exports.ClassInArray
export const ClassReturnInPromise = __napiModule.exports.ClassReturnInPromise
export const ClassWithFactory = __napiModule.exports.ClassWithFactory
export const ClassWithLifetime = __napiModule.exports.ClassWithLifetime
export const ComplexTypeGenerator = __napiModule.exports.ComplexTypeGenerator
export const Context = __napiModule.exports.Context
export const CounterRepro = __napiModule.exports.CounterRepro
export const CreateStringClass = __napiModule.exports.CreateStringClass
export const CssRuleList = __napiModule.exports.CssRuleList
export const CSSRuleList = __napiModule.exports.CSSRuleList
export const CssStyleSheet = __napiModule.exports.CssStyleSheet
export const CSSStyleSheet = __napiModule.exports.CSSStyleSheet
export const CustomFinalize = __napiModule.exports.CustomFinalize
export const CustomStruct = __napiModule.exports.CustomStruct
export const DefaultUseNullableClass =
  __napiModule.exports.DefaultUseNullableClass
export const DelayedCounter = __napiModule.exports.DelayedCounter
export const Dog = __napiModule.exports.Dog
export const Fib = __napiModule.exports.Fib
export const Fib2 = __napiModule.exports.Fib2
export const Fib3 = __napiModule.exports.Fib3
export const Fib4 = __napiModule.exports.Fib4
export const GeneratorLifecycleProbe =
  __napiModule.exports.GeneratorLifecycleProbe
export const GetterSetterWithClosures =
  __napiModule.exports.GetterSetterWithClosures
export const JsClassForEither = __napiModule.exports.JsClassForEither
export const JSOnlyMethodsClass = __napiModule.exports.JSOnlyMethodsClass
export const RustOnlyMethodsClass = __napiModule.exports.RustOnlyMethodsClass
export const JsRemote = __napiModule.exports.JsRemote
export const JsRepo = __napiModule.exports.JsRepo
export const MyJsNamedClass = __napiModule.exports.MyJsNamedClass
export const OriginalRustNameForJsNamedStruct =
  __napiModule.exports.OriginalRustNameForJsNamedStruct
export const NinjaTurtle = __napiModule.exports.NinjaTurtle
export const NotUseNullableClass = __napiModule.exports.NotUseNullableClass
export const NotWritableClass = __napiModule.exports.NotWritableClass
export const Optional = __napiModule.exports.Optional
export const PackageJsonReader = __napiModule.exports.PackageJsonReader
export const Reader = __napiModule.exports.Reader
export const ReentrantGenerator = __napiModule.exports.ReentrantGenerator
export const Selector = __napiModule.exports.Selector
export const SyncIteratorIntoInstance =
  __napiModule.exports.SyncIteratorIntoInstance
export const Thing = __napiModule.exports.Thing
export const ThingList = __napiModule.exports.ThingList
export const UseNullableClass = __napiModule.exports.UseNullableClass
export const WeakReferenceGcHolder = __napiModule.exports.WeakReferenceGcHolder
export const WeakReferenceGcTarget = __napiModule.exports.WeakReferenceGcTarget
export const Width = __napiModule.exports.Width
export const abandonDeferredClones = getWasiBindingExport(
  'abandonDeferredClones',
)
export const acceptArraybuffer = __napiModule.exports.acceptArraybuffer
export const acceptSlice = __napiModule.exports.acceptSlice
export const acceptStream = __napiModule.exports.acceptStream
export const acceptThreadsafeFunction =
  __napiModule.exports.acceptThreadsafeFunction
export const acceptThreadsafeFunctionFatal =
  __napiModule.exports.acceptThreadsafeFunctionFatal
export const acceptThreadsafeFunctionTupleArgs =
  __napiModule.exports.acceptThreadsafeFunctionTupleArgs
export const acceptThreadsafeFunctionTupleNoFnArgs =
  __napiModule.exports.acceptThreadsafeFunctionTupleNoFnArgs
export const acceptUint8ClampedSlice =
  __napiModule.exports.acceptUint8ClampedSlice
export const acceptUint8ClampedSliceAndBufferSlice =
  __napiModule.exports.acceptUint8ClampedSliceAndBufferSlice
export const acceptUntypedTypedArray =
  __napiModule.exports.acceptUntypedTypedArray
export const add = __napiModule.exports.add
export const ALIAS = __napiModule.exports.ALIAS
export const AliasedEnum = __napiModule.exports.AliasedEnum
export const appendBuffer = __napiModule.exports.appendBuffer
export const appendToOsString = __napiModule.exports.appendToOsString
export const apply0 = __napiModule.exports.apply0
export const apply1 = __napiModule.exports.apply1
export const armTokioBlockingTlsRetirementProbe = getWasiBindingExport(
  'armTokioBlockingTlsRetirementProbe',
)
export const armTokioWorkerTlsRetirementProbe = getWasiBindingExport(
  'armTokioWorkerTlsRetirementProbe',
)
export const arrayBufferCopyFrom = __napiModule.exports.arrayBufferCopyFrom
export const arrayBufferFromData = __napiModule.exports.arrayBufferFromData
export const arrayBufferFromExternal =
  __napiModule.exports.arrayBufferFromExternal
export const arrayBufferLenAsync = __napiModule.exports.arrayBufferLenAsync
export const arrayBufferPassThrough =
  __napiModule.exports.arrayBufferPassThrough
export const arrayParams = __napiModule.exports.arrayParams
export const assignClampedSliceAcrossDuplicateLoad = getWasiBindingExport(
  'assignClampedSliceAcrossDuplicateLoad',
)
export const assignClassInstanceAcrossDuplicateLoad = getWasiBindingExport(
  'assignClassInstanceAcrossDuplicateLoad',
)
export const assignClassInstanceFromLaterTurn = getWasiBindingExport(
  'assignClassInstanceFromLaterTurn',
)
export const assignTypedArraySliceAcrossDuplicateLoad = getWasiBindingExport(
  'assignTypedArraySliceAcrossDuplicateLoad',
)
export const asyncBufferToArray = __napiModule.exports.asyncBufferToArray
export const asyncCleanupHookCounts =
  __napiModule.exports.asyncCleanupHookCounts
export const asyncMultiTwo = __napiModule.exports.asyncMultiTwo
export const asyncPartialReferenceSetupProbe =
  __napiModule.exports.asyncPartialReferenceSetupProbe
export const asyncPlus100 = __napiModule.exports.asyncPlus100
export const asyncReduceBuffer = __napiModule.exports.asyncReduceBuffer
export const asyncReferenceSetupProbe =
  __napiModule.exports.asyncReferenceSetupProbe
export const asyncResolveArray = __napiModule.exports.asyncResolveArray
export const asyncTaskArraybuffer = __napiModule.exports.asyncTaskArraybuffer
export const asyncTaskFinally = __napiModule.exports.asyncTaskFinally
export const asyncTaskOptionalReturn =
  __napiModule.exports.asyncTaskOptionalReturn
export const asyncTaskReadFile = __napiModule.exports.asyncTaskReadFile
export const asyncTaskVoidReturn = __napiModule.exports.asyncTaskVoidReturn
export const awaitRejectionOffThread =
  __napiModule.exports.awaitRejectionOffThread
export const bigintAdd = __napiModule.exports.bigintAdd
export const bigintFromI128 = __napiModule.exports.bigintFromI128
export const bigintFromI64 = __napiModule.exports.bigintFromI64
export const bigintGetU64AsString = __napiModule.exports.bigintGetU64AsString
export const borrowAlignedZstPair = __napiModule.exports.borrowAlignedZstPair
export const btreeSetToJs = __napiModule.exports.btreeSetToJs
export const btreeSetToRust = __napiModule.exports.btreeSetToRust
export const bufferAssertionTarget = __napiModule.exports.bufferAssertionTarget
export const bufferComplexOverride = __napiModule.exports.bufferComplexOverride
export const bufferDestructureBinding =
  __napiModule.exports.bufferDestructureBinding
export const bufferGenericConstraint =
  __napiModule.exports.bufferGenericConstraint
export const bufferGenericShadow = __napiModule.exports.bufferGenericShadow
export const bufferLenAsync = __napiModule.exports.bufferLenAsync
export const bufferPassThrough = __napiModule.exports.bufferPassThrough
export const bufferValueBinding = __napiModule.exports.bufferValueBinding
export const bufferWithAsyncBlock = __napiModule.exports.bufferWithAsyncBlock
export const buildThreadsafeFunctionFromFunction =
  __napiModule.exports.buildThreadsafeFunctionFromFunction
export const buildThreadsafeFunctionFromFunctionCalleeHandle =
  __napiModule.exports.buildThreadsafeFunctionFromFunctionCalleeHandle
export const call0 = __napiModule.exports.call0
export const call1 = __napiModule.exports.call1
export const call2 = __napiModule.exports.call2
export const callAsyncWithUnknownReturnValue =
  __napiModule.exports.callAsyncWithUnknownReturnValue
export const callbackInSpawn = __napiModule.exports.callbackInSpawn
export const callbackReturnPromise = __napiModule.exports.callbackReturnPromise
export const callbackReturnPromiseAndSpawn =
  __napiModule.exports.callbackReturnPromiseAndSpawn
export const callCatchOnPromise = __napiModule.exports.callCatchOnPromise
export const callFinallyOnPromise = __napiModule.exports.callFinallyOnPromise
export const callFunction = __napiModule.exports.callFunction
export const callFunctionWithArg = __napiModule.exports.callFunctionWithArg
export const callFunctionWithArgAndCtx =
  __napiModule.exports.callFunctionWithArgAndCtx
export const callLongThreadsafeFunction =
  __napiModule.exports.callLongThreadsafeFunction
export const callRuleHandler = __napiModule.exports.callRuleHandler
export const callThenOnPromise = __napiModule.exports.callThenOnPromise
export const callThreadsafeFunction =
  __napiModule.exports.callThreadsafeFunction
export const callWithNestedFunctionArg =
  __napiModule.exports.callWithNestedFunctionArg
export const callWithTupleArg = __napiModule.exports.callWithTupleArg
export const cancelAsyncWorkLifecycle = getWasiBindingExport(
  'cancelAsyncWorkLifecycle',
)
export const captureErrorInCallback =
  __napiModule.exports.captureErrorInCallback
export const chronoDateAdd1Minute = __napiModule.exports.chronoDateAdd1Minute
export const chronoDateFixtureReturn1 =
  __napiModule.exports.chronoDateFixtureReturn1
export const chronoDateFixtureReturn2 =
  __napiModule.exports.chronoDateFixtureReturn2
export const chronoDateWithTimezoneReturn =
  __napiModule.exports.chronoDateWithTimezoneReturn
export const chronoDateWithTimezoneToMillis =
  __napiModule.exports.chronoDateWithTimezoneToMillis
export const chronoLocalDateReturn = __napiModule.exports.chronoLocalDateReturn
export const chronoLocalDateToMillis =
  __napiModule.exports.chronoLocalDateToMillis
export const chronoNativeDateTime = __napiModule.exports.chronoNativeDateTime
export const chronoNativeDateTimeReturn =
  __napiModule.exports.chronoNativeDateTimeReturn
export const chronoUtcDateReturn = __napiModule.exports.chronoUtcDateReturn
export const chronoUtcDateToMillis = __napiModule.exports.chronoUtcDateToMillis
export const churnGlobalHandles = __napiModule.exports.churnGlobalHandles
export const compressSync = __napiModule.exports.compressSync
export const concatLatin1 = __napiModule.exports.concatLatin1
export const concatStr = __napiModule.exports.concatStr
export const concatUtf16 = __napiModule.exports.concatUtf16
export const configureTokioThreadStopFileBarrier = getWasiBindingExport(
  'configureTokioThreadStopFileBarrier',
)
export const contains = __napiModule.exports.contains
export const convertClampedSliceAcrossDuplicateLoad = getWasiBindingExport(
  'convertClampedSliceAcrossDuplicateLoad',
)
export const convertTypedArraySliceAcrossDuplicateLoad = getWasiBindingExport(
  'convertTypedArraySliceAcrossDuplicateLoad',
)
export const convertU32Array = __napiModule.exports.convertU32Array
export const copyExternalTokenAlias = getWasiBindingExport(
  'copyExternalTokenAlias',
)
export const createArraybuffer = __napiModule.exports.createArraybuffer
export const createAsyncGeneratorSetupFailure =
  __napiModule.exports.createAsyncGeneratorSetupFailure
export const createAsyncIteratorIntoInstance =
  __napiModule.exports.createAsyncIteratorIntoInstance
export const createAsyncReferenceSetupProbe =
  __napiModule.exports.createAsyncReferenceSetupProbe
export const createBigInt = __napiModule.exports.createBigInt
export const createBigIntI64 = __napiModule.exports.createBigIntI64
export const createBufferSliceFromCopiedData =
  __napiModule.exports.createBufferSliceFromCopiedData
export const createClassWithLifetimeFromRust =
  __napiModule.exports.createClassWithLifetimeFromRust
export const createDelayedCounterPair =
  __napiModule.exports.createDelayedCounterPair
export const createDetachableExternalArraybuffer =
  __napiModule.exports.createDetachableExternalArraybuffer
export const createDirectClassReferenceCallback =
  __napiModule.exports.createDirectClassReferenceCallback
export const createEmptyTypedArraySlices =
  __napiModule.exports.createEmptyTypedArraySlices
export const createExternal = __napiModule.exports.createExternal
export const createExternalBufferSlice =
  __napiModule.exports.createExternalBufferSlice
export const createExternalLatin1CustomFinalize =
  __napiModule.exports.createExternalLatin1CustomFinalize
export const createExternalLatin1Empty =
  __napiModule.exports.createExternalLatin1Empty
export const createExternalLatin1Long =
  __napiModule.exports.createExternalLatin1Long
export const createExternalLatin1Short =
  __napiModule.exports.createExternalLatin1Short
export const createExternalLatin1String =
  __napiModule.exports.createExternalLatin1String
export const createExternalLatin1WithLatin1Chars =
  __napiModule.exports.createExternalLatin1WithLatin1Chars
export const createExternalPublicBorrowProbe = getWasiBindingExport(
  'createExternalPublicBorrowProbe',
)
export const createExternalRef = __napiModule.exports.createExternalRef
export const createExternalRefProvenanceProbe = getWasiBindingExport(
  'createExternalRefProvenanceProbe',
)
export const createExternalString = __napiModule.exports.createExternalString
export const createExternalTokenGcProbe = getWasiBindingExport(
  'createExternalTokenGcProbe',
)
export const createExternalTypedArray =
  __napiModule.exports.createExternalTypedArray
export const createExternalUtf16String =
  __napiModule.exports.createExternalUtf16String
export const createFunction = __napiModule.exports.createFunction
export const createGeneratorLifecycleProbe =
  __napiModule.exports.createGeneratorLifecycleProbe
export const createI32ArrayFromExternal =
  __napiModule.exports.createI32ArrayFromExternal
export const createMutableTypedArrayForOwnershipTest = getWasiBindingExport(
  'createMutableTypedArrayForOwnershipTest',
)
export const createNotUseNullableStruct =
  __napiModule.exports.createNotUseNullableStruct
export const createObj = __napiModule.exports.createObj
export const createObjectRef = __napiModule.exports.createObjectRef
export const createObjectWithClassField =
  __napiModule.exports.createObjectWithClassField
export const createObjWithProperty = __napiModule.exports.createObjWithProperty
export const createOptionalExternal =
  __napiModule.exports.createOptionalExternal
export const createPanickingAsyncWork = getWasiBindingExport(
  'createPanickingAsyncWork',
)
export const createQueuedAsyncWorkLifecycle = getWasiBindingExport(
  'createQueuedAsyncWorkLifecycle',
)
export const createReadableStream = __napiModule.exports.createReadableStream
export const createReadableStreamFromClass =
  __napiModule.exports.createReadableStreamFromClass
export const createReadableStreamWithObject =
  __napiModule.exports.createReadableStreamWithObject
export const createReferenceOnFunction =
  __napiModule.exports.createReferenceOnFunction
export const createRejectedPromise = __napiModule.exports.createRejectedPromise
export const createResolvedPromise = __napiModule.exports.createResolvedPromise
export const createResolvePanickingAsyncWork = getWasiBindingExport(
  'createResolvePanickingAsyncWork',
)
export const createRunningAsyncWorkLifecycle = getWasiBindingExport(
  'createRunningAsyncWorkLifecycle',
)
export const createRuntimeLifecycleExternalLatin1Probe =
  __napiModule.exports.createRuntimeLifecycleExternalLatin1Probe
export const createRuntimeLifecycleExternalProbe =
  __napiModule.exports.createRuntimeLifecycleExternalProbe
export const createRuntimeLifecycleExternalUtf16Probe =
  __napiModule.exports.createRuntimeLifecycleExternalUtf16Probe
export const createRuntimeLifecycleFinalizer =
  __napiModule.exports.createRuntimeLifecycleFinalizer
export const createStaticLatin1String =
  __napiModule.exports.createStaticLatin1String
export const createStaticUtf16String =
  __napiModule.exports.createStaticUtf16String
export const createSymbol = __napiModule.exports.createSymbol
export const createSymbolFor = __napiModule.exports.createSymbolFor
export const createSymbolRef = __napiModule.exports.createSymbolRef
export const createSyncIteratorIntoInstance =
  __napiModule.exports.createSyncIteratorIntoInstance
export const createUint8ClampedArrayFromData =
  __napiModule.exports.createUint8ClampedArrayFromData
export const createUint8ClampedArrayFromExternal =
  __napiModule.exports.createUint8ClampedArrayFromExternal
export const createUseNullableStruct =
  __napiModule.exports.createUseNullableStruct
export const createZeroCopyLatin1String =
  __napiModule.exports.createZeroCopyLatin1String
export const createZeroCopyUtf16String =
  __napiModule.exports.createZeroCopyUtf16String
export const CustomNumEnum = __napiModule.exports.CustomNumEnum
export const customStatusCode = __napiModule.exports.customStatusCode
export const CustomStringEnum = __napiModule.exports.CustomStringEnum
export const dateToNumber = __napiModule.exports.dateToNumber
export const DEFAULT_COST = __napiModule.exports.DEFAULT_COST
export const deferredFinalizeCallbackCount = getWasiBindingExport(
  'deferredFinalizeCallbackCount',
)
export const defineClass = __napiModule.exports.defineClass
export const derefUint8Array = __napiModule.exports.derefUint8Array
export const detachableExternalArraybufferFinalizeCount =
  __napiModule.exports.detachableExternalArraybufferFinalizeCount
export const detachArraybufferWithAlias =
  __napiModule.exports.detachArraybufferWithAlias
export const disposeAsyncWorkLifecycle = getWasiBindingExport(
  'disposeAsyncWorkLifecycle',
)
export const disposeThreadsafeFunctionForEnvOwnership = getWasiBindingExport(
  'disposeThreadsafeFunctionForEnvOwnership',
)
export const drainStreamCount = __napiModule.exports.drainStreamCount
export const dropClonedErrorsOnTwoThreads =
  __napiModule.exports.dropClonedErrorsOnTwoThreads
export const dropErrorFromValueOffThread =
  __napiModule.exports.dropErrorFromValueOffThread
export const dropUnregisteredWeakTsfnForWasi =
  __napiModule.exports.dropUnregisteredWeakTsfnForWasi
export const either3 = __napiModule.exports.either3
export const either4 = __napiModule.exports.either4
export const eitherBoolOrFunction = __napiModule.exports.eitherBoolOrFunction
export const eitherBoolOrTuple = __napiModule.exports.eitherBoolOrTuple
export const eitherF64OrU32 = __napiModule.exports.eitherF64OrU32
export const eitherFromObjects = __napiModule.exports.eitherFromObjects
export const eitherFromOption = __napiModule.exports.eitherFromOption
export const eitherPromiseInEitherA =
  __napiModule.exports.eitherPromiseInEitherA
export const eitherStringOrNumber = __napiModule.exports.eitherStringOrNumber
export const Empty = __napiModule.exports.Empty
export const enumToI32 = __napiModule.exports.enumToI32
export const errorMessageContainsNullByte =
  __napiModule.exports.errorMessageContainsNullByte
export const esmResolve = __napiModule.exports.esmResolve
export const extendsJavascriptError =
  __napiModule.exports.extendsJavascriptError
export const externalTokenGcProbeFinalizeCount = getWasiBindingExport(
  'externalTokenGcProbeFinalizeCount',
)
export const f32ArrayToArray = __napiModule.exports.f32ArrayToArray
export const f64ArrayToArray = __napiModule.exports.f64ArrayToArray
export const fetch = getWasiBindingExport('fetch')
export const fibonacci = __napiModule.exports.fibonacci
export const fnReceivedAliased = __napiModule.exports.fnReceivedAliased
export const generateFunctionAndCallIt =
  __napiModule.exports.generateFunctionAndCallIt
export const getBigintJsonValue = __napiModule.exports.getBigintJsonValue
export const getBtreeMapping = __napiModule.exports.getBtreeMapping
export const getBuffer = __napiModule.exports.getBuffer
export const getBufferSlice = __napiModule.exports.getBufferSlice
export const getClassFromArray = __napiModule.exports.getClassFromArray
export const getCwd = __napiModule.exports.getCwd
export const getEmptyBuffer = __napiModule.exports.getEmptyBuffer
export const getEmptyTypedArray = __napiModule.exports.getEmptyTypedArray
export const getExternal = __napiModule.exports.getExternal
export const getGlobal = __napiModule.exports.getGlobal
export const getIndexMapping = __napiModule.exports.getIndexMapping
export const getIndexMappingWithHasher =
  __napiModule.exports.getIndexMappingWithHasher
export const getJsExternal = __napiModule.exports.getJsExternal
export const getMapping = __napiModule.exports.getMapping
export const getMappingWithHasher = __napiModule.exports.getMappingWithHasher
export const getModuleFileName = __napiModule.exports.getModuleFileName
export const getMyVec = __napiModule.exports.getMyVec
export const getNestedNumArr = __napiModule.exports.getNestedNumArr
export const getNull = __napiModule.exports.getNull
export const getNullByteProperty = __napiModule.exports.getNullByteProperty
export const getNumArr = __napiModule.exports.getNumArr
export const getNums = __napiModule.exports.getNums
export const getOptionalExternal = __napiModule.exports.getOptionalExternal
export const getPackageJsonName = __napiModule.exports.getPackageJsonName
export const getStrFromObject = __napiModule.exports.getStrFromObject
export const getterFromObj = __napiModule.exports.getterFromObj
export const getTuple = __napiModule.exports.getTuple
export const getUndefined = __napiModule.exports.getUndefined
export const getWords = __napiModule.exports.getWords
export const i16ArrayToArray = __napiModule.exports.i16ArrayToArray
export const i32ArrayToArray = __napiModule.exports.i32ArrayToArray
export const i64ArrayToArray = __napiModule.exports.i64ArrayToArray
export const i8ArrayToArray = __napiModule.exports.i8ArrayToArray
export const indexmapPassthrough = __napiModule.exports.indexmapPassthrough
export const indexSetToJs = __napiModule.exports.indexSetToJs
export const indexSetToRust = __napiModule.exports.indexSetToRust
export const inspectExternalRefAcrossDuplicateLoad = getWasiBindingExport(
  'inspectExternalRefAcrossDuplicateLoad',
)
export const inspectExternalTokenGcProbe = getWasiBindingExport(
  'inspectExternalTokenGcProbe',
)
export const intoUtf8 = __napiModule.exports.intoUtf8
export const joinPath = __napiModule.exports.joinPath
export const jsErrorCallback = __napiModule.exports.jsErrorCallback
export const Kind = __napiModule.exports.Kind
export const KindInValidate = __napiModule.exports.KindInValidate
export const listObjKeys = __napiModule.exports.listObjKeys
export const mapOption = __napiModule.exports.mapOption
export const mergeTupleArray = __napiModule.exports.mergeTupleArray
export const mutableTypedArrayFinalizeCount = getWasiBindingExport(
  'mutableTypedArrayFinalizeCount',
)
export const mutateAnimalPair = __napiModule.exports.mutateAnimalPair
export const mutateArraybuffer = __napiModule.exports.mutateArraybuffer
export const mutateExternal = __napiModule.exports.mutateExternal
export const mutateOptionalExternal =
  __napiModule.exports.mutateOptionalExternal
export const mutateTypedArray = __napiModule.exports.mutateTypedArray
export const mutateUint16ArrayForSync =
  __napiModule.exports.mutateUint16ArrayForSync
export const objectGetNamedPropertyShouldPerformTypecheck =
  __napiModule.exports.objectGetNamedPropertyShouldPerformTypecheck
export const objectWithCApis = __napiModule.exports.objectWithCApis
export const optionalCallbackTypes = __napiModule.exports.optionalCallbackTypes
export const optionEnd = __napiModule.exports.optionEnd
export const optionOnly = __napiModule.exports.optionOnly
export const optionStart = __napiModule.exports.optionStart
export const optionStartEnd = __napiModule.exports.optionStartEnd
export const overrideIndividualArgOnFunction =
  __napiModule.exports.overrideIndividualArgOnFunction
export const overrideIndividualArgOnFunctionWithCbArg =
  __napiModule.exports.overrideIndividualArgOnFunctionWithCbArg
export const overrideWholeFunctionType =
  __napiModule.exports.overrideWholeFunctionType
export const panic = __napiModule.exports.panic
export const panicInAsync = __napiModule.exports.panicInAsync
export const panickingAsyncWorkFinallyCount = getWasiBindingExport(
  'panickingAsyncWorkFinallyCount',
)
export const passSetToJs = __napiModule.exports.passSetToJs
export const passSetToRust = __napiModule.exports.passSetToRust
export const passSetWithHasherToJs = __napiModule.exports.passSetWithHasherToJs
export const pathParent = __napiModule.exports.pathParent
export const pendingAsyncBlockWithTerminalFinalizer =
  __napiModule.exports.pendingAsyncBlockWithTerminalFinalizer
export const plusOne = __napiModule.exports.plusOne
export const prepareTsfnBlockingCallRegression = getWasiBindingExport(
  'prepareTsfnBlockingCallRegression',
)
export const prepareTsfnTeardownRegression = getWasiBindingExport(
  'prepareTsfnTeardownRegression',
)
export const promiseInEither = __napiModule.exports.promiseInEither
export const promiseRawCallbackDropCount =
  __napiModule.exports.promiseRawCallbackDropCount
export const promiseRawCatchCallbackDropProbe =
  __napiModule.exports.promiseRawCatchCallbackDropProbe
export const promiseRawCatchCallbackPanic =
  __napiModule.exports.promiseRawCatchCallbackPanic
export const promiseRawFinallyCallbackDropProbe =
  __napiModule.exports.promiseRawFinallyCallbackDropProbe
export const promiseRawFinallyCallbackPanic =
  __napiModule.exports.promiseRawFinallyCallbackPanic
export const promiseRawReturnClassInstance =
  __napiModule.exports.promiseRawReturnClassInstance
export const promiseRawThenCallbackDropProbe =
  __napiModule.exports.promiseRawThenCallbackDropProbe
export const promiseRawThenCallbackPanic =
  __napiModule.exports.promiseRawThenCallbackPanic
export const readAnimalPair = __napiModule.exports.readAnimalPair
export const readAnimalWithReentrantProbe =
  __napiModule.exports.readAnimalWithReentrantProbe
export const readFile = __napiModule.exports.readFile
export const readFileAsync = __napiModule.exports.readFileAsync
export const readMutateAnimalPair = __napiModule.exports.readMutateAnimalPair
export const readPackageJson = __napiModule.exports.readPackageJson
export const receiveAllOptionalObject =
  __napiModule.exports.receiveAllOptionalObject
export const receiveBindingVitePluginMeta =
  __napiModule.exports.receiveBindingVitePluginMeta
export const receiveBufferSliceWithLifetime =
  __napiModule.exports.receiveBufferSliceWithLifetime
export const receiveClassOrNumber = __napiModule.exports.receiveClassOrNumber
export const receiveDifferentClass = __napiModule.exports.receiveDifferentClass
export const receiveMutClassOrNumber =
  __napiModule.exports.receiveMutClassOrNumber
export const receiveObjectOnlyFromJs =
  __napiModule.exports.receiveObjectOnlyFromJs
export const receiveObjectWithClassField =
  __napiModule.exports.receiveObjectWithClassField
export const receiveStrictObject = __napiModule.exports.receiveStrictObject
export const receiveString = __napiModule.exports.receiveString
export const referenceAsCallback = __napiModule.exports.referenceAsCallback
export const referenceWithTupleArg = __napiModule.exports.referenceWithTupleArg
export const referThreadsafeFunctionForEnvOwnership = getWasiBindingExport(
  'referThreadsafeFunctionForEnvOwnership',
)
export const registerDeferredCleanupOrderProbe = getWasiBindingExport(
  'registerDeferredCleanupOrderProbe',
)
export const registerEnvCleanupRuntimeLifecycleProbes =
  __napiModule.exports.registerEnvCleanupRuntimeLifecycleProbes
export const registerLateDeferredFinalizeCallback = getWasiBindingExport(
  'registerLateDeferredFinalizeCallback',
)
export const registerModuleFinalizerProbes =
  __napiModule.exports.registerModuleFinalizerProbes
export const registerRemovableAsyncCleanupHook =
  __napiModule.exports.registerRemovableAsyncCleanupHook
export const registerRemovableSyncCleanupHook =
  __napiModule.exports.registerRemovableSyncCleanupHook
export const registerSelfDroppingAsyncCleanupHook =
  __napiModule.exports.registerSelfDroppingAsyncCleanupHook
export const registerSelfRemovingSyncCleanupHook =
  __napiModule.exports.registerSelfRemovingSyncCleanupHook
export const releaseAsyncWorkLifecycle = getWasiBindingExport(
  'releaseAsyncWorkLifecycle',
)
export const removeRemovableAsyncCleanupHook =
  __napiModule.exports.removeRemovableAsyncCleanupHook
export const removeRemovableSyncCleanupHook =
  __napiModule.exports.removeRemovableSyncCleanupHook
export const resetPromiseRawCallbackDropCount =
  __napiModule.exports.resetPromiseRawCallbackDropCount
export const resetWeakReferenceGcTargetFinalizeCount =
  __napiModule.exports.resetWeakReferenceGcTargetFinalizeCount
export const resolvePanickingAsyncWorkFinallyCount = getWasiBindingExport(
  'resolvePanickingAsyncWorkFinallyCount',
)
export const restartTokioRuntimeAfterRetirement = getWasiBindingExport(
  'restartTokioRuntimeAfterRetirement',
)
export const returnCString = __napiModule.exports.returnCString
export const returnEither = __napiModule.exports.returnEither
export const returnEitherClass = __napiModule.exports.returnEitherClass
export const returnFromSharedCrate = __napiModule.exports.returnFromSharedCrate
export const returnNull = __napiModule.exports.returnNull
export const returnObjectOnlyToJs = __napiModule.exports.returnObjectOnlyToJs
export const returnTypedArraySliceMutAcrossDuplicateLoad = getWasiBindingExport(
  'returnTypedArraySliceMutAcrossDuplicateLoad',
)
export const returnTypedArraySliceRefAcrossDuplicateLoad = getWasiBindingExport(
  'returnTypedArraySliceRefAcrossDuplicateLoad',
)
export const returnUndefined = __napiModule.exports.returnUndefined
export const returnUndefinedIfInvalid =
  __napiModule.exports.returnUndefinedIfInvalid
export const returnUndefinedIfInvalidPromise =
  __napiModule.exports.returnUndefinedIfInvalidPromise
export const roundtripStr = __napiModule.exports.roundtripStr
export const runScript = __napiModule.exports.runScript
export const setInstanceDataRuntimeLifecycleProbe =
  __napiModule.exports.setInstanceDataRuntimeLifecycleProbe
export const setNullByteProperty = __napiModule.exports.setNullByteProperty
export const setSymbolInObj = __napiModule.exports.setSymbolInObj
export const settleDeferredBeforeFinalizeRegistration = getWasiBindingExport(
  'settleDeferredBeforeFinalizeRegistration',
)
export const settleDeferredClone = getWasiBindingExport('settleDeferredClone')
export const shorterEscapableScope = __napiModule.exports.shorterEscapableScope
export const shorterScope = __napiModule.exports.shorterScope
export const shutdownAsyncRuntimeForTest =
  __napiModule.exports.shutdownAsyncRuntimeForTest
export const shutdownRuntime = __napiModule.exports.shutdownRuntime
export const spawnFutureLifetime = __napiModule.exports.spawnFutureLifetime
export const spawnThreadInThread = __napiModule.exports.spawnThreadInThread
export const startDeferredTeardownRace = getWasiBindingExport(
  'startDeferredTeardownRace',
)
export const startReferencedTsfnFinalizerLivenessWorker = getWasiBindingExport(
  'startReferencedTsfnFinalizerLivenessWorker',
)
export const startTokioWakerAfterCleanupProbe =
  __napiModule.exports.startTokioWakerAfterCleanupProbe
export const startWeakTsfnFinalizerLivenessWorker = getWasiBindingExport(
  'startWeakTsfnFinalizerLivenessWorker',
)
export const stashBufferAcrossDuplicateLoad = getWasiBindingExport(
  'stashBufferAcrossDuplicateLoad',
)
export const stashBufferInThreadLocal =
  __napiModule.exports.stashBufferInThreadLocal
export const stashClassInstanceForLaterTurn = getWasiBindingExport(
  'stashClassInstanceForLaterTurn',
)
export const stashErrorAcrossDuplicateLoad = getWasiBindingExport(
  'stashErrorAcrossDuplicateLoad',
)
export const stashErrorInThreadLocal =
  __napiModule.exports.stashErrorInThreadLocal
export const stashExternalRefAcrossDuplicateLoad = getWasiBindingExport(
  'stashExternalRefAcrossDuplicateLoad',
)
export const stashExternalRefForTeardown = getWasiBindingExport(
  'stashExternalRefForTeardown',
)
export const stashThreadsafeFunctionForEnvOwnership = getWasiBindingExport(
  'stashThreadsafeFunctionForEnvOwnership',
)
export const stashTypedArrayAcrossDuplicateLoad = getWasiBindingExport(
  'stashTypedArrayAcrossDuplicateLoad',
)
export const stashTypedArrayInThreadLocal =
  __napiModule.exports.stashTypedArrayInThreadLocal
export const stashTypedArraySlicesAcrossDuplicateLoad = getWasiBindingExport(
  'stashTypedArraySlicesAcrossDuplicateLoad',
)
export const Status = __napiModule.exports.Status
export const StatusInValidate = __napiModule.exports.StatusInValidate
export const StringEnum = __napiModule.exports.StringEnum
export const sumBtreeMapping = __napiModule.exports.sumBtreeMapping
export const sumBufferSliceFromCopy =
  __napiModule.exports.sumBufferSliceFromCopy
export const sumBufferSliceFromData =
  __napiModule.exports.sumBufferSliceFromData
export const sumBufferSliceFromExternal =
  __napiModule.exports.sumBufferSliceFromExternal
export const sumIndexMapping = __napiModule.exports.sumIndexMapping
export const sumMapping = __napiModule.exports.sumMapping
export const sumNums = __napiModule.exports.sumNums
export const syncCleanupHookCounts = __napiModule.exports.syncCleanupHookCounts
export const takeAdditionalBorrowedValueAcrossDuplicateLoad =
  getWasiBindingExport('takeAdditionalBorrowedValueAcrossDuplicateLoad')
export const takeBorrowedValueAcrossDuplicateLoad = getWasiBindingExport(
  'takeBorrowedValueAcrossDuplicateLoad',
)
export const takeBufferAcrossDuplicateLoad = getWasiBindingExport(
  'takeBufferAcrossDuplicateLoad',
)
export const takeBufferSliceIntoBufferAcrossDuplicateLoad =
  getWasiBindingExport('takeBufferSliceIntoBufferAcrossDuplicateLoad')
export const takeBufferSliceRefAcrossDuplicateLoad = getWasiBindingExport(
  'takeBufferSliceRefAcrossDuplicateLoad',
)
export const takeClassInstanceFromLaterTurn = getWasiBindingExport(
  'takeClassInstanceFromLaterTurn',
)
export const takeExternalRefAcrossDuplicateLoad = getWasiBindingExport(
  'takeExternalRefAcrossDuplicateLoad',
)
export const takeReferenceValueAcrossDuplicateLoad = getWasiBindingExport(
  'takeReferenceValueAcrossDuplicateLoad',
)
export const takeTypedArrayAcrossDuplicateLoad = getWasiBindingExport(
  'takeTypedArrayAcrossDuplicateLoad',
)
export const testEscapedQuotesInComments =
  __napiModule.exports.testEscapedQuotesInComments
export const testLatin1Methods = __napiModule.exports.testLatin1Methods
export const testSerdeBigNumberPrecision =
  __napiModule.exports.testSerdeBigNumberPrecision
export const testSerdeBufferBytes = __napiModule.exports.testSerdeBufferBytes
export const testSerdeRoundtrip = __napiModule.exports.testSerdeRoundtrip
export const testWorkers = __napiModule.exports.testWorkers
export const threadsafeFunctionBuildThrowErrorWithStatus =
  __napiModule.exports.threadsafeFunctionBuildThrowErrorWithStatus
export const threadsafeFunctionClosureCapture =
  __napiModule.exports.threadsafeFunctionClosureCapture
export const threadsafeFunctionFatalMode =
  __napiModule.exports.threadsafeFunctionFatalMode
export const threadsafeFunctionFatalModeError =
  __napiModule.exports.threadsafeFunctionFatalModeError
export const threadsafeFunctionRustPanic =
  __napiModule.exports.threadsafeFunctionRustPanic
export const threadsafeFunctionRustPanicCalleeHandled =
  __napiModule.exports.threadsafeFunctionRustPanicCalleeHandled
export const threadsafeFunctionThrowError =
  __napiModule.exports.threadsafeFunctionThrowError
export const threadsafeFunctionThrowErrorWithStatus =
  __napiModule.exports.threadsafeFunctionThrowErrorWithStatus
export const throwAsyncError = __napiModule.exports.throwAsyncError
export const throwDetachedPendingException =
  __napiModule.exports.throwDetachedPendingException
export const throwError = __napiModule.exports.throwError
export const throwErrorAcrossDuplicateLoad = getWasiBindingExport(
  'throwErrorAcrossDuplicateLoad',
)
export const throwErrorWithCause = __napiModule.exports.throwErrorWithCause
export const throwSyntaxError = __napiModule.exports.throwSyntaxError
export const toJsObj = __napiModule.exports.toJsObj
export const tokioRuntimeLifecycleValue = getWasiBindingExport(
  'tokioRuntimeLifecycleValue',
)
export const tryCloneErrorCauseOffThread =
  __napiModule.exports.tryCloneErrorCauseOffThread
export const tryCloneErrorCauseTransitiveOffThread =
  __napiModule.exports.tryCloneErrorCauseTransitiveOffThread
export const tryCloneErrorOffThread =
  __napiModule.exports.tryCloneErrorOffThread
export const tryCloneErrorOffThreadKeepReference =
  __napiModule.exports.tryCloneErrorOffThreadKeepReference
export const tsfnAsyncCall = __napiModule.exports.tsfnAsyncCall
export const tsfnCallWithCallback = __napiModule.exports.tsfnCallWithCallback
export const tsfnInEither = __napiModule.exports.tsfnInEither
export const tsfnReturnPromise = __napiModule.exports.tsfnReturnPromise
export const tsfnReturnPromiseTimeout =
  __napiModule.exports.tsfnReturnPromiseTimeout
export const tsfnThrowFromJs = __napiModule.exports.tsfnThrowFromJs
export const tsfnThrowFromJsCallbackContainsTsfn =
  __napiModule.exports.tsfnThrowFromJsCallbackContainsTsfn
export const tsfnThrowFromJsCatch = __napiModule.exports.tsfnThrowFromJsCatch
export const tsfnThrowFromJsCatchDropInThread =
  __napiModule.exports.tsfnThrowFromJsCatchDropInThread
export const tsfnThrowFromJsCatchHandled =
  __napiModule.exports.tsfnThrowFromJsCatchHandled
export const tsfnThrowFromJsCatchRecover =
  __napiModule.exports.tsfnThrowFromJsCatchRecover
export const tsfnWeak = __napiModule.exports.tsfnWeak
export const tsRename = __napiModule.exports.tsRename
export const u16ArrayToArray = __napiModule.exports.u16ArrayToArray
export const u32ArrayToArray = __napiModule.exports.u32ArrayToArray
export const u64ArrayToArray = __napiModule.exports.u64ArrayToArray
export const u8ArrayToArray = __napiModule.exports.u8ArrayToArray
export const uInit8ArrayFromString = __napiModule.exports.uInit8ArrayFromString
export const uint16ArrayCopyFrom = __napiModule.exports.uint16ArrayCopyFrom
export const uint8ArrayFromData = __napiModule.exports.uint8ArrayFromData
export const uint8ArrayFromExternal =
  __napiModule.exports.uint8ArrayFromExternal
export const uint8ClampedArrayCopyFrom =
  __napiModule.exports.uint8ClampedArrayCopyFrom
export const unrefThreadsafeFunctionForEnvOwnership = getWasiBindingExport(
  'unrefThreadsafeFunctionForEnvOwnership',
)
export const untypedTypedArrayBackingBytes =
  __napiModule.exports.untypedTypedArrayBackingBytes
export const validateArray = __napiModule.exports.validateArray
export const validateBigint = __napiModule.exports.validateBigint
export const validateBoolean = __napiModule.exports.validateBoolean
export const validateBuffer = __napiModule.exports.validateBuffer
export const validateBufferSlice = __napiModule.exports.validateBufferSlice
export const validateDate = __napiModule.exports.validateDate
export const validateDateTime = __napiModule.exports.validateDateTime
export const validateEnum = __napiModule.exports.validateEnum
export const validateExternal = __napiModule.exports.validateExternal
export const validateFunction = __napiModule.exports.validateFunction
export const validateHashMap = __napiModule.exports.validateHashMap
export const validateNull = __napiModule.exports.validateNull
export const validateNumber = __napiModule.exports.validateNumber
export const validateOptional = __napiModule.exports.validateOptional
export const validatePromise = __napiModule.exports.validatePromise
export const validateString = __napiModule.exports.validateString
export const validateStringEnum = __napiModule.exports.validateStringEnum
export const validateStructuredEnum =
  __napiModule.exports.validateStructuredEnum
export const validateStructuredEnumLowercase =
  __napiModule.exports.validateStructuredEnumLowercase
export const validateSymbol = __napiModule.exports.validateSymbol
export const validateTypedArray = __napiModule.exports.validateTypedArray
export const validateTypedArraySlice =
  __napiModule.exports.validateTypedArraySlice
export const validateUint8ClampedSlice =
  __napiModule.exports.validateUint8ClampedSlice
export const validateUndefined = __napiModule.exports.validateUndefined
export const verifyReferenceValuesRejectNativeThread = getWasiBindingExport(
  'verifyReferenceValuesRejectNativeThread',
)
export const verifyThreadsafeFunctionOwnerEnv = getWasiBindingExport(
  'verifyThreadsafeFunctionOwnerEnv',
)
export const verifyTypedArraySlicesSameEnv = getWasiBindingExport(
  'verifyTypedArraySlicesSameEnv',
)
export const waitForTokioRuntimeRetirement = getWasiBindingExport(
  'waitForTokioRuntimeRetirement',
)
export const weakReferenceGcTargetFinalizeCount =
  __napiModule.exports.weakReferenceGcTargetFinalizeCount
export const withAbortController = __napiModule.exports.withAbortController
export const withAbortSignalHandle = __napiModule.exports.withAbortSignalHandle
export const withAdditionalBorrowedValuesAcrossDuplicateLoad =
  getWasiBindingExport('withAdditionalBorrowedValuesAcrossDuplicateLoad')
export const withBorrowedValuesAcrossDuplicateLoad = getWasiBindingExport(
  'withBorrowedValuesAcrossDuplicateLoad',
)
export const withinAsyncRuntimeIfAvailable =
  __napiModule.exports.withinAsyncRuntimeIfAvailable
export const withoutAbortController =
  __napiModule.exports.withoutAbortController
export const withReferenceValuesAcrossDuplicateLoad = getWasiBindingExport(
  'withReferenceValuesAcrossDuplicateLoad',
)
export const xxh64Alias = __napiModule.exports.xxh64Alias
export const duplicateClassNameAlpha =
  __napiModule.exports.duplicateClassNameAlpha
export const duplicateClassNameBeta =
  __napiModule.exports.duplicateClassNameBeta
export const xxh2 = __napiModule.exports.xxh2
export const xxh3 = __napiModule.exports.xxh3
export const ComplexClass = __napiModule.exports.ComplexClass
