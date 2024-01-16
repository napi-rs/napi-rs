import {
  instantiateNapiModuleSync as __emnapiInstantiateNapiModuleSync,
  getDefaultContext as __emnapiGetDefaultContext,
  WASI as __WASI,
} from '@napi-rs/wasm-runtime'
import {
  Volume as __Volume,
  createFsFromVolume as __createFsFromVolume,
} from '@napi-rs/wasm-runtime/fs'

import __wasmUrl from './index.wasm?url'

const __fs = __createFsFromVolume(
  __Volume.fromJSON({
    '/': null,
  }),
)

const __wasi = new __WASI({
  version: 'preview1',
  fs: __fs,
})

const __emnapiContext = __emnapiGetDefaultContext()

const __sharedMemory = new WebAssembly.Memory({
  initial: 1024,
  maximum: 10240,
  shared: true,
})

const __wasmFile = await fetch(__wasmUrl).then((res) => res.arrayBuffer())

const {
  instance: __napiInstance,
  module: __wasiModule,
  napiModule: __napiModule,
} = __emnapiInstantiateNapiModuleSync(__wasmFile, {
  context: __emnapiContext,
  asyncWorkPoolSize: 4,
  wasi: __wasi,
  onCreateWorker() {
    return new Worker(new URL('./wasi-worker-browser.mjs', import.meta.url), {
      type: 'module',
    })
  },
  overwriteImports(importObject) {
    importObject.env = {
      ...importObject.env,
      ...importObject.napi,
      ...importObject.emnapi,
      memory: __sharedMemory,
    }
    return importObject
  },
  beforeInit({ instance }) {
    __napi_rs_initialize_modules(instance)
  },
})

function __napi_rs_initialize_modules(__napiInstance) {
  __napiInstance.exports['__napi_register__DEFAULT_COST_0']?.()
  __napiInstance.exports['__napi_register__TYPE_SKIPPED_CONST_1']?.()
  __napiInstance.exports['__napi_register__get_words_2']?.()
  __napiInstance.exports['__napi_register__get_nums_3']?.()
  __napiInstance.exports['__napi_register__sum_nums_4']?.()
  __napiInstance.exports['__napi_register__to_js_obj_5']?.()
  __napiInstance.exports['__napi_register__get_num_arr_6']?.()
  __napiInstance.exports['__napi_register__get_nested_num_arr_7']?.()
  __napiInstance.exports['__napi_register__read_file_async_8']?.()
  __napiInstance.exports['__napi_register__async_multi_two_9']?.()
  __napiInstance.exports['__napi_register__bigint_add_10']?.()
  __napiInstance.exports['__napi_register__create_big_int_11']?.()
  __napiInstance.exports['__napi_register__create_big_int_i64_12']?.()
  __napiInstance.exports['__napi_register__bigint_get_u64_as_string_13']?.()
  __napiInstance.exports['__napi_register__bigint_from_i64_14']?.()
  __napiInstance.exports['__napi_register__bigint_from_i128_15']?.()
  __napiInstance.exports['__napi_register__get_cwd_16']?.()
  __napiInstance.exports['__napi_register__option_end_17']?.()
  __napiInstance.exports['__napi_register__option_start_18']?.()
  __napiInstance.exports['__napi_register__option_start_end_19']?.()
  __napiInstance.exports['__napi_register__option_only_20']?.()
  __napiInstance.exports['__napi_register__read_file_21']?.()
  __napiInstance.exports['__napi_register__return_js_function_22']?.()
  __napiInstance.exports['__napi_register__callback_return_promise_23']?.()
  __napiInstance.exports[
    '__napi_register__callback_return_promise_and_spawn_24'
  ]?.()
  __napiInstance.exports['__napi_register__capture_error_in_callback_25']?.()
  __napiInstance.exports['__napi_register__Animal_struct_26']?.()
  __napiInstance.exports['__napi_register__Animal_impl_38']?.()
  __napiInstance.exports['__napi_register__Dog_struct_39']?.()
  __napiInstance.exports['__napi_register__Bird_struct_40']?.()
  __napiInstance.exports['__napi_register__Bird_impl_44']?.()
  __napiInstance.exports['__napi_register__Blake2bHasher_struct_45']?.()
  __napiInstance.exports['__napi_register__Blake2bHasher_impl_47']?.()
  __napiInstance.exports['__napi_register__Blake2bHasher_impl_49']?.()
  __napiInstance.exports['__napi_register__Blake2bKey_struct_50']?.()
  __napiInstance.exports['__napi_register__Context_struct_51']?.()
  __napiInstance.exports['__napi_register__Context_impl_56']?.()
  __napiInstance.exports[
    '__napi_register__AnimalWithDefaultConstructor_struct_57'
  ]?.()
  __napiInstance.exports['__napi_register__NinjaTurtle_struct_58']?.()
  __napiInstance.exports['__napi_register__NinjaTurtle_impl_65']?.()
  __napiInstance.exports['__napi_register__JsAssets_struct_66']?.()
  __napiInstance.exports['__napi_register__JsAssets_impl_69']?.()
  __napiInstance.exports['__napi_register__JsAsset_struct_70']?.()
  __napiInstance.exports['__napi_register__JsAsset_impl_73']?.()
  __napiInstance.exports['__napi_register__Optional_struct_74']?.()
  __napiInstance.exports['__napi_register__Optional_impl_79']?.()
  __napiInstance.exports[
    '__napi_register__ObjectFieldClassInstance_struct_80'
  ]?.()
  __napiInstance.exports[
    '__napi_register__create_object_with_class_field_81'
  ]?.()
  __napiInstance.exports[
    '__napi_register__receive_object_with_class_field_82'
  ]?.()
  __napiInstance.exports['__napi_register__NotWritableClass_struct_83']?.()
  __napiInstance.exports['__napi_register__NotWritableClass_impl_85']?.()
  __napiInstance.exports['__napi_register__CustomFinalize_struct_86']?.()
  __napiInstance.exports['__napi_register__CustomFinalize_impl_88']?.()
  __napiInstance.exports['__napi_register__Width_struct_89']?.()
  __napiInstance.exports['__napi_register__plus_one_90']?.()
  __napiInstance.exports[
    '__napi_register__GetterSetterWithClosures_struct_91'
  ]?.()
  __napiInstance.exports[
    '__napi_register__GetterSetterWithClosures_impl_93'
  ]?.()
  __napiInstance.exports['__napi_register__CatchOnConstructor_struct_94']?.()
  __napiInstance.exports['__napi_register__CatchOnConstructor_impl_96']?.()
  __napiInstance.exports['__napi_register__CatchOnConstructor2_struct_97']?.()
  __napiInstance.exports['__napi_register__CatchOnConstructor2_impl_99']?.()
  __napiInstance.exports['__napi_register__ClassWithFactory_struct_100']?.()
  __napiInstance.exports['__napi_register__ClassWithFactory_impl_105']?.()
  __napiInstance.exports['__napi_register__Selector_struct_106']?.()
  __napiInstance.exports['__napi_register__date_to_number_107']?.()
  __napiInstance.exports['__napi_register__chrono_date_to_millis_108']?.()
  __napiInstance.exports['__napi_register__chrono_date_add_1_minute_109']?.()
  __napiInstance.exports['__napi_register__Dates_struct_110']?.()
  __napiInstance.exports['__napi_register__chrono_native_date_time_111']?.()
  __napiInstance.exports[
    '__napi_register__chrono_native_date_time_return_112'
  ]?.()
  __napiInstance.exports['__napi_register__either_string_or_number_113']?.()
  __napiInstance.exports['__napi_register__return_either_114']?.()
  __napiInstance.exports['__napi_register__either3_115']?.()
  __napiInstance.exports['__napi_register__Obj_struct_116']?.()
  __napiInstance.exports['__napi_register__either4_117']?.()
  __napiInstance.exports['__napi_register__JsClassForEither_struct_118']?.()
  __napiInstance.exports['__napi_register__JsClassForEither_impl_120']?.()
  __napiInstance.exports[
    '__napi_register__AnotherClassForEither_struct_121'
  ]?.()
  __napiInstance.exports['__napi_register__AnotherClassForEither_impl_123']?.()
  __napiInstance.exports['__napi_register__receive_class_or_number_124']?.()
  __napiInstance.exports['__napi_register__receive_mut_class_or_number_125']?.()
  __napiInstance.exports['__napi_register__receive_different_class_126']?.()
  __napiInstance.exports['__napi_register__return_either_class_127']?.()
  __napiInstance.exports['__napi_register__either_from_option_128']?.()
  __napiInstance.exports['__napi_register__A_struct_129']?.()
  __napiInstance.exports['__napi_register__B_struct_130']?.()
  __napiInstance.exports['__napi_register__C_struct_131']?.()
  __napiInstance.exports['__napi_register__either_from_objects_132']?.()
  __napiInstance.exports['__napi_register__either_bool_or_function_133']?.()
  __napiInstance.exports['__napi_register__promise_in_either_134']?.()
  __napiInstance.exports['__napi_register__Kind_135']?.()
  __napiInstance.exports['__napi_register__Empty_136']?.()
  __napiInstance.exports['__napi_register__Status_137']?.()
  __napiInstance.exports['__napi_register__CustomNumEnum_138']?.()
  __napiInstance.exports['__napi_register__enum_to_i32_139']?.()
  __napiInstance.exports['__napi_register__SkippedEnums_140']?.()
  __napiInstance.exports['__napi_register__run_script_141']?.()
  __napiInstance.exports['__napi_register__get_module_file_name_142']?.()
  __napiInstance.exports['__napi_register__throw_syntax_error_143']?.()
  __napiInstance.exports['__napi_register__throw_error_144']?.()
  __napiInstance.exports['__napi_register__panic_145']?.()
  __napiInstance.exports['__napi_register__receive_string_146']?.()
  __napiInstance.exports['__napi_register__custom_status_code_147']?.()
  __napiInstance.exports['__napi_register__throw_async_error_148']?.()
  __napiInstance.exports['__napi_register__create_external_149']?.()
  __napiInstance.exports['__napi_register__create_external_string_150']?.()
  __napiInstance.exports['__napi_register__get_external_151']?.()
  __napiInstance.exports['__napi_register__mutate_external_152']?.()
  __napiInstance.exports['__napi_register__validate_array_153']?.()
  __napiInstance.exports['__napi_register__validate_buffer_154']?.()
  __napiInstance.exports['__napi_register__validate_typed_array_155']?.()
  __napiInstance.exports['__napi_register__validate_bigint_156']?.()
  __napiInstance.exports['__napi_register__validate_boolean_157']?.()
  __napiInstance.exports['__napi_register__validate_date_158']?.()
  __napiInstance.exports['__napi_register__validate_date_time_159']?.()
  __napiInstance.exports['__napi_register__validate_external_160']?.()
  __napiInstance.exports['__napi_register__validate_function_161']?.()
  __napiInstance.exports['__napi_register__validate_hash_map_162']?.()
  __napiInstance.exports['__napi_register__validate_null_163']?.()
  __napiInstance.exports['__napi_register__validate_undefined_164']?.()
  __napiInstance.exports['__napi_register__validate_number_165']?.()
  __napiInstance.exports['__napi_register__validate_promise_166']?.()
  __napiInstance.exports['__napi_register__validate_string_167']?.()
  __napiInstance.exports['__napi_register__validate_symbol_168']?.()
  __napiInstance.exports['__napi_register__validate_optional_169']?.()
  __napiInstance.exports['__napi_register__return_undefined_if_invalid_170']?.()
  __napiInstance.exports[
    '__napi_register__return_undefined_if_invalid_promise_171'
  ]?.()
  __napiInstance.exports['__napi_register__ts_rename_172']?.()
  __napiInstance.exports[
    '__napi_register__override_individual_arg_on_function_173'
  ]?.()
  __napiInstance.exports[
    '__napi_register__override_individual_arg_on_function_with_cb_arg_174'
  ]?.()
  __napiInstance.exports['__napi_register__Fib_struct_175']?.()
  __napiInstance.exports['__napi_register__Fib_impl_176']?.()
  __napiInstance.exports['__napi_register__Fib_impl_178']?.()
  __napiInstance.exports['__napi_register__Fib2_struct_179']?.()
  __napiInstance.exports['__napi_register__Fib2_impl_180']?.()
  __napiInstance.exports['__napi_register__Fib2_impl_182']?.()
  __napiInstance.exports['__napi_register__Fib3_struct_183']?.()
  __napiInstance.exports['__napi_register__Fib3_impl_184']?.()
  __napiInstance.exports['__napi_register__ALIGNMENT_185']?.()
  __napiInstance.exports['__napi_register__xxh64_186']?.()
  __napiInstance.exports['__napi_register__xxh128_187']?.()
  __napiInstance.exports['__napi_register__Xxh3_struct_188']?.()
  __napiInstance.exports['__napi_register__Xxh3_impl_192']?.()
  __napiInstance.exports['__napi_register__xxh2_plus_193']?.()
  __napiInstance.exports['__napi_register__xxh3_xxh64_alias_194']?.()
  __napiInstance.exports['__napi_register__xxh64_alias_195']?.()
  __napiInstance.exports['__napi_register__get_mapping_196']?.()
  __napiInstance.exports['__napi_register__sum_mapping_197']?.()
  __napiInstance.exports['__napi_register__map_option_198']?.()
  __napiInstance.exports['__napi_register__return_null_199']?.()
  __napiInstance.exports['__napi_register__return_undefined_200']?.()
  __napiInstance.exports['__napi_register__add_201']?.()
  __napiInstance.exports['__napi_register__fibonacci_202']?.()
  __napiInstance.exports['__napi_register__list_obj_keys_203']?.()
  __napiInstance.exports['__napi_register__create_obj_204']?.()
  __napiInstance.exports['__napi_register__get_global_205']?.()
  __napiInstance.exports['__napi_register__get_undefined_206']?.()
  __napiInstance.exports['__napi_register__get_null_207']?.()
  __napiInstance.exports['__napi_register__AllOptionalObject_struct_208']?.()
  __napiInstance.exports['__napi_register__receive_all_optional_object_209']?.()
  __napiInstance.exports['__napi_register__AliasedEnum_210']?.()
  __napiInstance.exports[
    '__napi_register__StructContainsAliasedEnum_struct_211'
  ]?.()
  __napiInstance.exports['__napi_register__fn_received_aliased_212']?.()
  __napiInstance.exports['__napi_register__StrictObject_struct_213']?.()
  __napiInstance.exports['__napi_register__receive_strict_object_214']?.()
  __napiInstance.exports['__napi_register__get_str_from_object_215']?.()
  __napiInstance.exports['__napi_register__TsTypeChanged_struct_216']?.()
  __napiInstance.exports['__napi_register__create_obj_with_property_217']?.()
  __napiInstance.exports['__napi_register__getter_from_obj_218']?.()
  __napiInstance.exports['__napi_register__ObjectOnlyFromJs_struct_219']?.()
  __napiInstance.exports['__napi_register__receive_object_only_from_js_220']?.()
  __napiInstance.exports['__napi_register__async_plus_100_221']?.()
  __napiInstance.exports['__napi_register__JsRepo_struct_222']?.()
  __napiInstance.exports['__napi_register__JsRepo_impl_225']?.()
  __napiInstance.exports['__napi_register__JsRemote_struct_226']?.()
  __napiInstance.exports['__napi_register__JsRemote_impl_228']?.()
  __napiInstance.exports['__napi_register__CSSRuleList_struct_229']?.()
  __napiInstance.exports['__napi_register__CSSRuleList_impl_233']?.()
  __napiInstance.exports['__napi_register__CSSStyleSheet_struct_234']?.()
  __napiInstance.exports['__napi_register__AnotherCSSStyleSheet_struct_235']?.()
  __napiInstance.exports['__napi_register__AnotherCSSStyleSheet_impl_237']?.()
  __napiInstance.exports['__napi_register__CSSStyleSheet_impl_241']?.()
  __napiInstance.exports['__napi_register__PackageJson_struct_242']?.()
  __napiInstance.exports['__napi_register__read_package_json_243']?.()
  __napiInstance.exports['__napi_register__get_package_json_name_244']?.()
  __napiInstance.exports['__napi_register__test_serde_roundtrip_245']?.()
  __napiInstance.exports[
    '__napi_register__test_serde_big_number_precision_246'
  ]?.()
  __napiInstance.exports['__napi_register__return_from_shared_crate_247']?.()
  __napiInstance.exports['__napi_register__contains_248']?.()
  __napiInstance.exports['__napi_register__concat_str_249']?.()
  __napiInstance.exports['__napi_register__concat_utf16_250']?.()
  __napiInstance.exports['__napi_register__concat_latin1_251']?.()
  __napiInstance.exports['__napi_register__roundtrip_str_252']?.()
  __napiInstance.exports['__napi_register__set_symbol_in_obj_253']?.()
  __napiInstance.exports['__napi_register__create_symbol_254']?.()
  __napiInstance.exports['__napi_register__create_symbol_for_255']?.()
  __napiInstance.exports['__napi_register__DelaySum_impl_256']?.()
  __napiInstance.exports['__napi_register__without_abort_controller_257']?.()
  __napiInstance.exports['__napi_register__with_abort_controller_258']?.()
  __napiInstance.exports['__napi_register__AsyncTaskVoidReturn_impl_259']?.()
  __napiInstance.exports['__napi_register__async_task_void_return_260']?.()
  __napiInstance.exports[
    '__napi_register__AsyncTaskOptionalReturn_impl_261'
  ]?.()
  __napiInstance.exports['__napi_register__async_task_optional_return_262']?.()
  __napiInstance.exports['__napi_register__call_threadsafe_function_263']?.()
  __napiInstance.exports[
    '__napi_register__call_long_threadsafe_function_264'
  ]?.()
  __napiInstance.exports[
    '__napi_register__threadsafe_function_throw_error_265'
  ]?.()
  __napiInstance.exports[
    '__napi_register__threadsafe_function_fatal_mode_266'
  ]?.()
  __napiInstance.exports[
    '__napi_register__threadsafe_function_fatal_mode_error_267'
  ]?.()
  __napiInstance.exports[
    '__napi_register__threadsafe_function_closure_capture_268'
  ]?.()
  __napiInstance.exports['__napi_register__tsfn_call_with_callback_269']?.()
  __napiInstance.exports['__napi_register__tsfn_async_call_270']?.()
  __napiInstance.exports['__napi_register__accept_threadsafe_function_271']?.()
  __napiInstance.exports[
    '__napi_register__accept_threadsafe_function_fatal_272'
  ]?.()
  __napiInstance.exports[
    '__napi_register__accept_threadsafe_function_tuple_args_273'
  ]?.()
  __napiInstance.exports['__napi_register__tsfn_return_promise_274']?.()
  __napiInstance.exports['__napi_register__tsfn_return_promise_timeout_275']?.()
  __napiInstance.exports['__napi_register__tsfn_throw_from_js_276']?.()
  __napiInstance.exports['__napi_register__get_buffer_277']?.()
  __napiInstance.exports['__napi_register__append_buffer_278']?.()
  __napiInstance.exports['__napi_register__get_empty_buffer_279']?.()
  __napiInstance.exports['__napi_register__convert_u32_array_280']?.()
  __napiInstance.exports['__napi_register__create_external_typed_array_281']?.()
  __napiInstance.exports['__napi_register__mutate_typed_array_282']?.()
  __napiInstance.exports['__napi_register__deref_uint8_array_283']?.()
  __napiInstance.exports['__napi_register__buffer_pass_through_284']?.()
  __napiInstance.exports['__napi_register__array_buffer_pass_through_285']?.()
  __napiInstance.exports['__napi_register__AsyncBuffer_impl_286']?.()
  __napiInstance.exports['__napi_register__async_reduce_buffer_287']?.()
}
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
export const Bird = __napiModule.exports.Bird
export const Blake2BHasher = __napiModule.exports.Blake2BHasher
export const Blake2bHasher = __napiModule.exports.Blake2bHasher
export const Blake2BKey = __napiModule.exports.Blake2BKey
export const Blake2bKey = __napiModule.exports.Blake2bKey
export const CatchOnConstructor = __napiModule.exports.CatchOnConstructor
export const CatchOnConstructor2 = __napiModule.exports.CatchOnConstructor2
export const ClassWithFactory = __napiModule.exports.ClassWithFactory
export const Context = __napiModule.exports.Context
export const CssRuleList = __napiModule.exports.CssRuleList
export const CSSRuleList = __napiModule.exports.CSSRuleList
export const CssStyleSheet = __napiModule.exports.CssStyleSheet
export const CSSStyleSheet = __napiModule.exports.CSSStyleSheet
export const CustomFinalize = __napiModule.exports.CustomFinalize
export const Dog = __napiModule.exports.Dog
export const Fib = __napiModule.exports.Fib
export const Fib2 = __napiModule.exports.Fib2
export const Fib3 = __napiModule.exports.Fib3
export const GetterSetterWithClosures =
  __napiModule.exports.GetterSetterWithClosures
export const JsClassForEither = __napiModule.exports.JsClassForEither
export const JsRemote = __napiModule.exports.JsRemote
export const JsRepo = __napiModule.exports.JsRepo
export const NinjaTurtle = __napiModule.exports.NinjaTurtle
export const NotWritableClass = __napiModule.exports.NotWritableClass
export const Optional = __napiModule.exports.Optional
export const Selector = __napiModule.exports.Selector
export const Width = __napiModule.exports.Width
export const acceptThreadsafeFunction =
  __napiModule.exports.acceptThreadsafeFunction
export const acceptThreadsafeFunctionFatal =
  __napiModule.exports.acceptThreadsafeFunctionFatal
export const acceptThreadsafeFunctionTupleArgs =
  __napiModule.exports.acceptThreadsafeFunctionTupleArgs
export const add = __napiModule.exports.add
export const ALIAS = __napiModule.exports.ALIAS
export const AliasedEnum = __napiModule.exports.AliasedEnum
export const appendBuffer = __napiModule.exports.appendBuffer
export const arrayBufferPassThrough =
  __napiModule.exports.arrayBufferPassThrough
export const asyncMultiTwo = __napiModule.exports.asyncMultiTwo
export const asyncPlus100 = __napiModule.exports.asyncPlus100
export const asyncReduceBuffer = __napiModule.exports.asyncReduceBuffer
export const asyncTaskOptionalReturn =
  __napiModule.exports.asyncTaskOptionalReturn
export const asyncTaskVoidReturn = __napiModule.exports.asyncTaskVoidReturn
export const bigintAdd = __napiModule.exports.bigintAdd
export const bigintFromI128 = __napiModule.exports.bigintFromI128
export const bigintFromI64 = __napiModule.exports.bigintFromI64
export const bigintGetU64AsString = __napiModule.exports.bigintGetU64AsString
export const bufferPassThrough = __napiModule.exports.bufferPassThrough
export const callbackReturnPromise = __napiModule.exports.callbackReturnPromise
export const callbackReturnPromiseAndSpawn =
  __napiModule.exports.callbackReturnPromiseAndSpawn
export const callLongThreadsafeFunction =
  __napiModule.exports.callLongThreadsafeFunction
export const callThreadsafeFunction =
  __napiModule.exports.callThreadsafeFunction
export const captureErrorInCallback =
  __napiModule.exports.captureErrorInCallback
export const chronoDateAdd1Minute = __napiModule.exports.chronoDateAdd1Minute
export const chronoDateToMillis = __napiModule.exports.chronoDateToMillis
export const chronoNativeDateTime = __napiModule.exports.chronoNativeDateTime
export const chronoNativeDateTimeReturn =
  __napiModule.exports.chronoNativeDateTimeReturn
export const concatLatin1 = __napiModule.exports.concatLatin1
export const concatStr = __napiModule.exports.concatStr
export const concatUtf16 = __napiModule.exports.concatUtf16
export const contains = __napiModule.exports.contains
export const convertU32Array = __napiModule.exports.convertU32Array
export const createBigInt = __napiModule.exports.createBigInt
export const createBigIntI64 = __napiModule.exports.createBigIntI64
export const createExternal = __napiModule.exports.createExternal
export const createExternalString = __napiModule.exports.createExternalString
export const createExternalTypedArray =
  __napiModule.exports.createExternalTypedArray
export const createObj = __napiModule.exports.createObj
export const createObjectWithClassField =
  __napiModule.exports.createObjectWithClassField
export const createObjWithProperty = __napiModule.exports.createObjWithProperty
export const createSymbol = __napiModule.exports.createSymbol
export const createSymbolFor = __napiModule.exports.createSymbolFor
export const CustomNumEnum = __napiModule.exports.CustomNumEnum
export const customStatusCode = __napiModule.exports.customStatusCode
export const dateToNumber = __napiModule.exports.dateToNumber
export const DEFAULT_COST = __napiModule.exports.DEFAULT_COST
export const derefUint8Array = __napiModule.exports.derefUint8Array
export const either3 = __napiModule.exports.either3
export const either4 = __napiModule.exports.either4
export const eitherBoolOrFunction = __napiModule.exports.eitherBoolOrFunction
export const eitherFromObjects = __napiModule.exports.eitherFromObjects
export const eitherFromOption = __napiModule.exports.eitherFromOption
export const eitherStringOrNumber = __napiModule.exports.eitherStringOrNumber
export const Empty = __napiModule.exports.Empty
export const enumToI32 = __napiModule.exports.enumToI32
export const fibonacci = __napiModule.exports.fibonacci
export const fnReceivedAliased = __napiModule.exports.fnReceivedAliased
export const getBuffer = __napiModule.exports.getBuffer
export const getCwd = __napiModule.exports.getCwd
export const getEmptyBuffer = __napiModule.exports.getEmptyBuffer
export const getExternal = __napiModule.exports.getExternal
export const getGlobal = __napiModule.exports.getGlobal
export const getMapping = __napiModule.exports.getMapping
export const getModuleFileName = __napiModule.exports.getModuleFileName
export const getNestedNumArr = __napiModule.exports.getNestedNumArr
export const getNull = __napiModule.exports.getNull
export const getNumArr = __napiModule.exports.getNumArr
export const getNums = __napiModule.exports.getNums
export const getPackageJsonName = __napiModule.exports.getPackageJsonName
export const getStrFromObject = __napiModule.exports.getStrFromObject
export const getterFromObj = __napiModule.exports.getterFromObj
export const getUndefined = __napiModule.exports.getUndefined
export const getWords = __napiModule.exports.getWords
export const Kind = __napiModule.exports.Kind
export const listObjKeys = __napiModule.exports.listObjKeys
export const mapOption = __napiModule.exports.mapOption
export const mutateExternal = __napiModule.exports.mutateExternal
export const mutateTypedArray = __napiModule.exports.mutateTypedArray
export const optionEnd = __napiModule.exports.optionEnd
export const optionOnly = __napiModule.exports.optionOnly
export const optionStart = __napiModule.exports.optionStart
export const optionStartEnd = __napiModule.exports.optionStartEnd
export const overrideIndividualArgOnFunction =
  __napiModule.exports.overrideIndividualArgOnFunction
export const overrideIndividualArgOnFunctionWithCbArg =
  __napiModule.exports.overrideIndividualArgOnFunctionWithCbArg
export const panic = __napiModule.exports.panic
export const plusOne = __napiModule.exports.plusOne
export const promiseInEither = __napiModule.exports.promiseInEither
export const readFile = __napiModule.exports.readFile
export const readFileAsync = __napiModule.exports.readFileAsync
export const readPackageJson = __napiModule.exports.readPackageJson
export const receiveAllOptionalObject =
  __napiModule.exports.receiveAllOptionalObject
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
export const returnEither = __napiModule.exports.returnEither
export const returnEitherClass = __napiModule.exports.returnEitherClass
export const returnFromSharedCrate = __napiModule.exports.returnFromSharedCrate
export const returnJsFunction = __napiModule.exports.returnJsFunction
export const returnNull = __napiModule.exports.returnNull
export const returnUndefined = __napiModule.exports.returnUndefined
export const returnUndefinedIfInvalid =
  __napiModule.exports.returnUndefinedIfInvalid
export const returnUndefinedIfInvalidPromise =
  __napiModule.exports.returnUndefinedIfInvalidPromise
export const roundtripStr = __napiModule.exports.roundtripStr
export const runScript = __napiModule.exports.runScript
export const setSymbolInObj = __napiModule.exports.setSymbolInObj
export const Status = __napiModule.exports.Status
export const sumMapping = __napiModule.exports.sumMapping
export const sumNums = __napiModule.exports.sumNums
export const testSerdeBigNumberPrecision =
  __napiModule.exports.testSerdeBigNumberPrecision
export const testSerdeRoundtrip = __napiModule.exports.testSerdeRoundtrip
export const threadsafeFunctionClosureCapture =
  __napiModule.exports.threadsafeFunctionClosureCapture
export const threadsafeFunctionFatalMode =
  __napiModule.exports.threadsafeFunctionFatalMode
export const threadsafeFunctionFatalModeError =
  __napiModule.exports.threadsafeFunctionFatalModeError
export const threadsafeFunctionThrowError =
  __napiModule.exports.threadsafeFunctionThrowError
export const throwAsyncError = __napiModule.exports.throwAsyncError
export const throwError = __napiModule.exports.throwError
export const throwSyntaxError = __napiModule.exports.throwSyntaxError
export const toJsObj = __napiModule.exports.toJsObj
export const tsfnAsyncCall = __napiModule.exports.tsfnAsyncCall
export const tsfnCallWithCallback = __napiModule.exports.tsfnCallWithCallback
export const tsfnReturnPromise = __napiModule.exports.tsfnReturnPromise
export const tsfnReturnPromiseTimeout =
  __napiModule.exports.tsfnReturnPromiseTimeout
export const tsfnThrowFromJs = __napiModule.exports.tsfnThrowFromJs
export const tsRename = __napiModule.exports.tsRename
export const validateArray = __napiModule.exports.validateArray
export const validateBigint = __napiModule.exports.validateBigint
export const validateBoolean = __napiModule.exports.validateBoolean
export const validateBuffer = __napiModule.exports.validateBuffer
export const validateDate = __napiModule.exports.validateDate
export const validateDateTime = __napiModule.exports.validateDateTime
export const validateExternal = __napiModule.exports.validateExternal
export const validateFunction = __napiModule.exports.validateFunction
export const validateHashMap = __napiModule.exports.validateHashMap
export const validateNull = __napiModule.exports.validateNull
export const validateNumber = __napiModule.exports.validateNumber
export const validateOptional = __napiModule.exports.validateOptional
export const validatePromise = __napiModule.exports.validatePromise
export const validateString = __napiModule.exports.validateString
export const validateSymbol = __napiModule.exports.validateSymbol
export const validateTypedArray = __napiModule.exports.validateTypedArray
export const validateUndefined = __napiModule.exports.validateUndefined
export const withAbortController = __napiModule.exports.withAbortController
export const withoutAbortController =
  __napiModule.exports.withoutAbortController
export const xxh64Alias = __napiModule.exports.xxh64Alias
export const xxh2 = __napiModule.exports.xxh2
export const xxh3 = __napiModule.exports.xxh3
