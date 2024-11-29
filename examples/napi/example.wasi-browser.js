import {
  instantiateNapiModuleSync as __emnapiInstantiateNapiModuleSync,
  getDefaultContext as __emnapiGetDefaultContext,
  WASI as __WASI,
  createOnMessage as __wasmCreateOnMessageForFsProxy,
} from '@napi-rs/wasm-runtime'
import { memfs } from '@napi-rs/wasm-runtime/fs'
import __wasmUrl from './example.wasm32-wasi.wasm?url'

export const { fs: __fs, vol: __volume } = memfs()

const __wasi = new __WASI({
  version: 'preview1',
  fs: __fs,
  preopens: {
    '/': '/',
  }
})

const __emnapiContext = __emnapiGetDefaultContext()

const __sharedMemory = new WebAssembly.Memory({
  initial: 16384,
  maximum: 65536,
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
    const worker = new Worker(new URL('./wasi-worker-browser.mjs', import.meta.url), {
      type: 'module',
    })
    worker.addEventListener('message', __wasmCreateOnMessageForFsProxy(__fs))

    return worker
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
  __napiInstance.exports['__napi_register__Shared_struct_0']?.()
  __napiInstance.exports['__napi_register__DEFAULT_COST_0']?.()
  __napiInstance.exports['__napi_register__TYPE_SKIPPED_CONST_0']?.()
  __napiInstance.exports['__napi_register__get_words_0']?.()
  __napiInstance.exports['__napi_register__get_nums_0']?.()
  __napiInstance.exports['__napi_register__sum_nums_0']?.()
  __napiInstance.exports['__napi_register__to_js_obj_0']?.()
  __napiInstance.exports['__napi_register__get_num_arr_0']?.()
  __napiInstance.exports['__napi_register__get_nested_num_arr_0']?.()
  __napiInstance.exports['__napi_register__read_file_async_0']?.()
  __napiInstance.exports['__napi_register__async_multi_two_0']?.()
  __napiInstance.exports['__napi_register__panic_in_async_0']?.()
  __napiInstance.exports['__napi_register__within_async_runtime_if_available_0']?.()
  __napiInstance.exports['__napi_register__bigint_add_0']?.()
  __napiInstance.exports['__napi_register__create_big_int_0']?.()
  __napiInstance.exports['__napi_register__create_big_int_i64_0']?.()
  __napiInstance.exports['__napi_register__bigint_get_u64_as_string_0']?.()
  __napiInstance.exports['__napi_register__bigint_from_i64_0']?.()
  __napiInstance.exports['__napi_register__bigint_from_i128_0']?.()
  __napiInstance.exports['__napi_register__get_cwd_0']?.()
  __napiInstance.exports['__napi_register__option_end_0']?.()
  __napiInstance.exports['__napi_register__option_start_0']?.()
  __napiInstance.exports['__napi_register__option_start_end_0']?.()
  __napiInstance.exports['__napi_register__option_only_0']?.()
  __napiInstance.exports['__napi_register__read_file_0']?.()
  __napiInstance.exports['__napi_register__callback_return_promise_0']?.()
  __napiInstance.exports['__napi_register__callback_return_promise_and_spawn_0']?.()
  __napiInstance.exports['__napi_register__capture_error_in_callback_0']?.()
  __napiInstance.exports['__napi_register__Animal_struct_0']?.()
  __napiInstance.exports['__napi_register__Animal_impl_0']?.()
  __napiInstance.exports['__napi_register__Dog_struct_0']?.()
  __napiInstance.exports['__napi_register__Bird_struct_0']?.()
  __napiInstance.exports['__napi_register__Bird_impl_0']?.()
  __napiInstance.exports['__napi_register__Blake2bHasher_struct_0']?.()
  __napiInstance.exports['__napi_register__Blake2bHasher_impl_0']?.()
  __napiInstance.exports['__napi_register__Blake2bHasher_impl_1']?.()
  __napiInstance.exports['__napi_register__Blake2bKey_struct_0']?.()
  __napiInstance.exports['__napi_register__Context_struct_0']?.()
  __napiInstance.exports['__napi_register__Context_impl_0']?.()
  __napiInstance.exports['__napi_register__AnimalWithDefaultConstructor_struct_0']?.()
  __napiInstance.exports['__napi_register__NinjaTurtle_struct_0']?.()
  __napiInstance.exports['__napi_register__NinjaTurtle_impl_0']?.()
  __napiInstance.exports['__napi_register__JsAssets_struct_0']?.()
  __napiInstance.exports['__napi_register__JsAssets_impl_0']?.()
  __napiInstance.exports['__napi_register__JsAsset_struct_0']?.()
  __napiInstance.exports['__napi_register__JsAsset_impl_0']?.()
  __napiInstance.exports['__napi_register__Optional_struct_0']?.()
  __napiInstance.exports['__napi_register__Optional_impl_0']?.()
  __napiInstance.exports['__napi_register__ObjectFieldClassInstance_struct_0']?.()
  __napiInstance.exports['__napi_register__create_object_with_class_field_0']?.()
  __napiInstance.exports['__napi_register__receive_object_with_class_field_0']?.()
  __napiInstance.exports['__napi_register__NotWritableClass_struct_0']?.()
  __napiInstance.exports['__napi_register__NotWritableClass_impl_0']?.()
  __napiInstance.exports['__napi_register__CustomFinalize_struct_0']?.()
  __napiInstance.exports['__napi_register__CustomFinalize_impl_0']?.()
  __napiInstance.exports['__napi_register__Width_struct_0']?.()
  __napiInstance.exports['__napi_register__plus_one_0']?.()
  __napiInstance.exports['__napi_register__GetterSetterWithClosures_struct_0']?.()
  __napiInstance.exports['__napi_register__GetterSetterWithClosures_impl_0']?.()
  __napiInstance.exports['__napi_register__CatchOnConstructor_struct_0']?.()
  __napiInstance.exports['__napi_register__CatchOnConstructor_impl_0']?.()
  __napiInstance.exports['__napi_register__CatchOnConstructor2_struct_0']?.()
  __napiInstance.exports['__napi_register__CatchOnConstructor2_impl_0']?.()
  __napiInstance.exports['__napi_register__ClassWithLifetime_struct_0']?.()
  __napiInstance.exports['__napi_register__ClassWithLifetime_impl_0']?.()
  __napiInstance.exports['__napi_register__ClassWithFactory_struct_0']?.()
  __napiInstance.exports['__napi_register__ClassWithFactory_impl_0']?.()
  __napiInstance.exports['__napi_register__Selector_struct_0']?.()
  __napiInstance.exports['__napi_register__date_to_number_0']?.()
  __napiInstance.exports['__napi_register__chrono_utc_date_to_millis_0']?.()
  __napiInstance.exports['__napi_register__chrono_local_date_to_millis_0']?.()
  __napiInstance.exports['__napi_register__chrono_date_with_timezone_to_millis_0']?.()
  __napiInstance.exports['__napi_register__chrono_date_add_1_minute_0']?.()
  __napiInstance.exports['__napi_register__UtcDates_struct_0']?.()
  __napiInstance.exports['__napi_register__LocalDates_struct_0']?.()
  __napiInstance.exports['__napi_register__DatesWithTimeZone_struct_0']?.()
  __napiInstance.exports['__napi_register__chrono_native_date_time_0']?.()
  __napiInstance.exports['__napi_register__chrono_native_date_time_return_0']?.()
  __napiInstance.exports['__napi_register__chrono_utc_date_return_0']?.()
  __napiInstance.exports['__napi_register__chrono_local_date_return_0']?.()
  __napiInstance.exports['__napi_register__chrono_date_with_timezone_return_0']?.()
  __napiInstance.exports['__napi_register__chrono_date_fixture_return1_0']?.()
  __napiInstance.exports['__napi_register__chrono_date_fixture_return2_0']?.()
  __napiInstance.exports['__napi_register__either_string_or_number_0']?.()
  __napiInstance.exports['__napi_register__return_either_0']?.()
  __napiInstance.exports['__napi_register__either3_0']?.()
  __napiInstance.exports['__napi_register__Obj_struct_0']?.()
  __napiInstance.exports['__napi_register__either4_0']?.()
  __napiInstance.exports['__napi_register__JsClassForEither_struct_0']?.()
  __napiInstance.exports['__napi_register__JsClassForEither_impl_0']?.()
  __napiInstance.exports['__napi_register__AnotherClassForEither_struct_0']?.()
  __napiInstance.exports['__napi_register__AnotherClassForEither_impl_0']?.()
  __napiInstance.exports['__napi_register__receive_class_or_number_0']?.()
  __napiInstance.exports['__napi_register__receive_mut_class_or_number_0']?.()
  __napiInstance.exports['__napi_register__receive_different_class_0']?.()
  __napiInstance.exports['__napi_register__return_either_class_0']?.()
  __napiInstance.exports['__napi_register__either_from_option_0']?.()
  __napiInstance.exports['__napi_register__A_struct_0']?.()
  __napiInstance.exports['__napi_register__B_struct_0']?.()
  __napiInstance.exports['__napi_register__C_struct_0']?.()
  __napiInstance.exports['__napi_register__either_from_objects_0']?.()
  __napiInstance.exports['__napi_register__either_bool_or_function_0']?.()
  __napiInstance.exports['__napi_register__promise_in_either_0']?.()
  __napiInstance.exports['__napi_register__either_bool_or_tuple_0']?.()
  __napiInstance.exports['__napi_register__Kind_0']?.()
  __napiInstance.exports['__napi_register__Empty_0']?.()
  __napiInstance.exports['__napi_register__Status_0']?.()
  __napiInstance.exports['__napi_register__StringEnum_0']?.()
  __napiInstance.exports['__napi_register__CustomNumEnum_0']?.()
  __napiInstance.exports['__napi_register__enum_to_i32_0']?.()
  __napiInstance.exports['__napi_register__SkippedEnums_0']?.()
  __napiInstance.exports['__napi_register__CustomStringEnum_0']?.()
  __napiInstance.exports['__napi_register__StructuredKind_struct_0']?.()
  __napiInstance.exports['__napi_register__validate_structured_enum_0']?.()
  __napiInstance.exports['__napi_register__run_script_0']?.()
  __napiInstance.exports['__napi_register__get_module_file_name_0']?.()
  __napiInstance.exports['__napi_register__throw_syntax_error_0']?.()
  __napiInstance.exports['__napi_register__throw_error_0']?.()
  __napiInstance.exports['__napi_register__panic_0']?.()
  __napiInstance.exports['__napi_register__receive_string_0']?.()
  __napiInstance.exports['__napi_register__custom_status_code_0']?.()
  __napiInstance.exports['__napi_register__error_message_contains_null_byte_0']?.()
  __napiInstance.exports['__napi_register__throw_async_error_0']?.()
  __napiInstance.exports['__napi_register__CustomStruct_struct_0']?.()
  __napiInstance.exports['__napi_register__CustomStruct_impl_0']?.()
  __napiInstance.exports['__napi_register__create_external_0']?.()
  __napiInstance.exports['__napi_register__create_external_string_0']?.()
  __napiInstance.exports['__napi_register__get_external_0']?.()
  __napiInstance.exports['__napi_register__mutate_external_0']?.()
  __napiInstance.exports['__napi_register__create_optional_external_0']?.()
  __napiInstance.exports['__napi_register__get_optional_external_0']?.()
  __napiInstance.exports['__napi_register__mutate_optional_external_0']?.()
  __napiInstance.exports['__napi_register__validate_array_0']?.()
  __napiInstance.exports['__napi_register__validate_buffer_0']?.()
  __napiInstance.exports['__napi_register__validate_typed_array_0']?.()
  __napiInstance.exports['__napi_register__validate_typed_array_slice_0']?.()
  __napiInstance.exports['__napi_register__validate_uint8_clamped_slice_0']?.()
  __napiInstance.exports['__napi_register__validate_buffer_slice_0']?.()
  __napiInstance.exports['__napi_register__validate_bigint_0']?.()
  __napiInstance.exports['__napi_register__validate_boolean_0']?.()
  __napiInstance.exports['__napi_register__validate_date_0']?.()
  __napiInstance.exports['__napi_register__validate_date_time_0']?.()
  __napiInstance.exports['__napi_register__validate_external_0']?.()
  __napiInstance.exports['__napi_register__validate_function_0']?.()
  __napiInstance.exports['__napi_register__validate_hash_map_0']?.()
  __napiInstance.exports['__napi_register__validate_null_0']?.()
  __napiInstance.exports['__napi_register__validate_undefined_0']?.()
  __napiInstance.exports['__napi_register__validate_number_0']?.()
  __napiInstance.exports['__napi_register__validate_promise_0']?.()
  __napiInstance.exports['__napi_register__validate_string_0']?.()
  __napiInstance.exports['__napi_register__validate_symbol_0']?.()
  __napiInstance.exports['__napi_register__validate_optional_0']?.()
  __napiInstance.exports['__napi_register__KindInValidate_0']?.()
  __napiInstance.exports['__napi_register__validate_enum_0']?.()
  __napiInstance.exports['__napi_register__StatusInValidate_0']?.()
  __napiInstance.exports['__napi_register__validate_string_enum_0']?.()
  __napiInstance.exports['__napi_register__return_undefined_if_invalid_0']?.()
  __napiInstance.exports['__napi_register__return_undefined_if_invalid_promise_0']?.()
  __napiInstance.exports['__napi_register__ts_rename_0']?.()
  __napiInstance.exports['__napi_register__override_individual_arg_on_function_0']?.()
  __napiInstance.exports['__napi_register__override_individual_arg_on_function_with_cb_arg_0']?.()
  __napiInstance.exports['__napi_register__override_whole_function_type_0']?.()
  __napiInstance.exports['__napi_register__call0_0']?.()
  __napiInstance.exports['__napi_register__call1_0']?.()
  __napiInstance.exports['__napi_register__call2_0']?.()
  __napiInstance.exports['__napi_register__apply0_0']?.()
  __napiInstance.exports['__napi_register__apply1_0']?.()
  __napiInstance.exports['__napi_register__call_function_0']?.()
  __napiInstance.exports['__napi_register__call_function_with_arg_0']?.()
  __napiInstance.exports['__napi_register__create_reference_on_function_0']?.()
  __napiInstance.exports['__napi_register__call_function_with_arg_and_ctx_0']?.()
  __napiInstance.exports['__napi_register__reference_as_callback_0']?.()
  __napiInstance.exports['__napi_register__build_threadsafe_function_from_function_0']?.()
  __napiInstance.exports['__napi_register__build_threadsafe_function_from_function_callee_handle_0']?.()
  __napiInstance.exports['__napi_register__Fib_struct_0']?.()
  __napiInstance.exports['__napi_register__Fib_impl_0']?.()
  __napiInstance.exports['__napi_register__Fib_impl_1']?.()
  __napiInstance.exports['__napi_register__Fib2_struct_0']?.()
  __napiInstance.exports['__napi_register__Fib2_impl_0']?.()
  __napiInstance.exports['__napi_register__Fib2_impl_1']?.()
  __napiInstance.exports['__napi_register__Fib3_struct_0']?.()
  __napiInstance.exports['__napi_register__Fib3_impl_0']?.()
  __napiInstance.exports['__napi_register__ALIGNMENT_0']?.()
  __napiInstance.exports['__napi_register__xxh64_0']?.()
  __napiInstance.exports['__napi_register__xxh128_0']?.()
  __napiInstance.exports['__napi_register__Xxh3_struct_0']?.()
  __napiInstance.exports['__napi_register__Xxh3_impl_0']?.()
  __napiInstance.exports['__napi_register__xxh2_plus_0']?.()
  __napiInstance.exports['__napi_register__xxh3_xxh64_alias_0']?.()
  __napiInstance.exports['__napi_register__xxh64_alias_0']?.()
  __napiInstance.exports['__napi_register__get_mapping_0']?.()
  __napiInstance.exports['__napi_register__sum_mapping_0']?.()
  __napiInstance.exports['__napi_register__get_btree_mapping_0']?.()
  __napiInstance.exports['__napi_register__sum_btree_mapping_0']?.()
  __napiInstance.exports['__napi_register__get_index_mapping_0']?.()
  __napiInstance.exports['__napi_register__sum_index_mapping_0']?.()
  __napiInstance.exports['__napi_register__indexmap_passthrough_0']?.()
  __napiInstance.exports['__napi_register__map_option_0']?.()
  __napiInstance.exports['__napi_register__return_null_0']?.()
  __napiInstance.exports['__napi_register__return_undefined_0']?.()
  __napiInstance.exports['__napi_register__UseNullableStruct_struct_0']?.()
  __napiInstance.exports['__napi_register__NotUseNullableStruct_struct_0']?.()
  __napiInstance.exports['__napi_register__DefaultUseNullableStruct_struct_0']?.()
  __napiInstance.exports['__napi_register__UseNullableClass_struct_0']?.()
  __napiInstance.exports['__napi_register__NotUseNullableClass_struct_0']?.()
  __napiInstance.exports['__napi_register__DefaultUseNullableClass_struct_0']?.()
  __napiInstance.exports['__napi_register__add_0']?.()
  __napiInstance.exports['__napi_register__fibonacci_0']?.()
  __napiInstance.exports['__napi_register__list_obj_keys_0']?.()
  __napiInstance.exports['__napi_register__create_obj_0']?.()
  __napiInstance.exports['__napi_register__get_global_0']?.()
  __napiInstance.exports['__napi_register__get_undefined_0']?.()
  __napiInstance.exports['__napi_register__get_null_0']?.()
  __napiInstance.exports['__napi_register__AllOptionalObject_struct_0']?.()
  __napiInstance.exports['__napi_register__receive_all_optional_object_0']?.()
  __napiInstance.exports['__napi_register__AliasedEnum_0']?.()
  __napiInstance.exports['__napi_register__StructContainsAliasedEnum_struct_0']?.()
  __napiInstance.exports['__napi_register__fn_received_aliased_0']?.()
  __napiInstance.exports['__napi_register__StrictObject_struct_0']?.()
  __napiInstance.exports['__napi_register__receive_strict_object_0']?.()
  __napiInstance.exports['__napi_register__get_str_from_object_0']?.()
  __napiInstance.exports['__napi_register__TsTypeChanged_struct_0']?.()
  __napiInstance.exports['__napi_register__create_obj_with_property_0']?.()
  __napiInstance.exports['__napi_register__getter_from_obj_0']?.()
  __napiInstance.exports['__napi_register__ObjectOnlyFromJs_struct_0']?.()
  __napiInstance.exports['__napi_register__receive_object_only_from_js_0']?.()
  __napiInstance.exports['__napi_register__object_get_named_property_should_perform_typecheck_0']?.()
  __napiInstance.exports['__napi_register__ObjectOnlyToJs_struct_0']?.()
  __napiInstance.exports['__napi_register__return_object_only_to_js_0']?.()
  __napiInstance.exports['__napi_register__TupleObject_struct_0']?.()
  __napiInstance.exports['__napi_register__Data_struct_0']?.()
  __napiInstance.exports['__napi_register__receive_buffer_slice_with_lifetime_0']?.()
  __napiInstance.exports['__napi_register__FunctionData_struct_0']?.()
  __napiInstance.exports['__napi_register__generate_function_and_call_it_0']?.()
  __napiInstance.exports['__napi_register__async_plus_100_0']?.()
  __napiInstance.exports['__napi_register__call_then_on_promise_0']?.()
  __napiInstance.exports['__napi_register__call_catch_on_promise_0']?.()
  __napiInstance.exports['__napi_register__call_finally_on_promise_0']?.()
  __napiInstance.exports['__napi_register__JsRepo_struct_0']?.()
  __napiInstance.exports['__napi_register__JsRepo_impl_0']?.()
  __napiInstance.exports['__napi_register__JsRemote_struct_0']?.()
  __napiInstance.exports['__napi_register__JsRemote_impl_0']?.()
  __napiInstance.exports['__napi_register__CSSRuleList_struct_0']?.()
  __napiInstance.exports['__napi_register__CSSRuleList_impl_0']?.()
  __napiInstance.exports['__napi_register__CSSStyleSheet_struct_0']?.()
  __napiInstance.exports['__napi_register__AnotherCSSStyleSheet_struct_0']?.()
  __napiInstance.exports['__napi_register__AnotherCSSStyleSheet_impl_0']?.()
  __napiInstance.exports['__napi_register__CSSStyleSheet_impl_0']?.()
  __napiInstance.exports['__napi_register__PackageJson_struct_0']?.()
  __napiInstance.exports['__napi_register__read_package_json_0']?.()
  __napiInstance.exports['__napi_register__get_package_json_name_0']?.()
  __napiInstance.exports['__napi_register__test_serde_roundtrip_0']?.()
  __napiInstance.exports['__napi_register__test_serde_big_number_precision_0']?.()
  __napiInstance.exports['__napi_register__test_serde_buffer_bytes_0']?.()
  __napiInstance.exports['__napi_register__pass_set_to_rust_0']?.()
  __napiInstance.exports['__napi_register__pass_set_to_js_0']?.()
  __napiInstance.exports['__napi_register__btree_set_to_rust_0']?.()
  __napiInstance.exports['__napi_register__btree_set_to_js_0']?.()
  __napiInstance.exports['__napi_register__return_from_shared_crate_0']?.()
  __napiInstance.exports['__napi_register__contains_0']?.()
  __napiInstance.exports['__napi_register__concat_str_0']?.()
  __napiInstance.exports['__napi_register__concat_utf16_0']?.()
  __napiInstance.exports['__napi_register__concat_latin1_0']?.()
  __napiInstance.exports['__napi_register__roundtrip_str_0']?.()
  __napiInstance.exports['__napi_register__return_c_string_0']?.()
  __napiInstance.exports['__napi_register__set_symbol_in_obj_0']?.()
  __napiInstance.exports['__napi_register__create_symbol_0']?.()
  __napiInstance.exports['__napi_register__create_symbol_for_0']?.()
  __napiInstance.exports['__napi_register__DelaySum_impl_0']?.()
  __napiInstance.exports['__napi_register__without_abort_controller_0']?.()
  __napiInstance.exports['__napi_register__with_abort_controller_0']?.()
  __napiInstance.exports['__napi_register__AsyncTaskVoidReturn_impl_0']?.()
  __napiInstance.exports['__napi_register__async_task_void_return_0']?.()
  __napiInstance.exports['__napi_register__AsyncTaskOptionalReturn_impl_0']?.()
  __napiInstance.exports['__napi_register__async_task_optional_return_0']?.()
  __napiInstance.exports['__napi_register__AsyncTaskReadFile_impl_0']?.()
  __napiInstance.exports['__napi_register__async_task_read_file_0']?.()
  __napiInstance.exports['__napi_register__call_threadsafe_function_0']?.()
  __napiInstance.exports['__napi_register__call_long_threadsafe_function_0']?.()
  __napiInstance.exports['__napi_register__threadsafe_function_throw_error_0']?.()
  __napiInstance.exports['__napi_register__threadsafe_function_fatal_mode_0']?.()
  __napiInstance.exports['__napi_register__threadsafe_function_fatal_mode_error_0']?.()
  __napiInstance.exports['__napi_register__threadsafe_function_closure_capture_0']?.()
  __napiInstance.exports['__napi_register__tsfn_call_with_callback_0']?.()
  __napiInstance.exports['__napi_register__tsfn_async_call_0']?.()
  __napiInstance.exports['__napi_register__accept_threadsafe_function_0']?.()
  __napiInstance.exports['__napi_register__accept_threadsafe_function_fatal_0']?.()
  __napiInstance.exports['__napi_register__accept_threadsafe_function_tuple_args_0']?.()
  __napiInstance.exports['__napi_register__tsfn_return_promise_0']?.()
  __napiInstance.exports['__napi_register__tsfn_return_promise_timeout_0']?.()
  __napiInstance.exports['__napi_register__tsfn_throw_from_js_0']?.()
  __napiInstance.exports['__napi_register__spawn_thread_in_thread_0']?.()
  __napiInstance.exports['__napi_register__Pet_struct_0']?.()
  __napiInstance.exports['__napi_register__tsfn_in_either_0']?.()
  __napiInstance.exports['__napi_register__get_buffer_0']?.()
  __napiInstance.exports['__napi_register__get_buffer_slice_0']?.()
  __napiInstance.exports['__napi_register__append_buffer_0']?.()
  __napiInstance.exports['__napi_register__get_empty_buffer_0']?.()
  __napiInstance.exports['__napi_register__create_external_buffer_slice_0']?.()
  __napiInstance.exports['__napi_register__create_buffer_slice_from_copied_data_0']?.()
  __napiInstance.exports['__napi_register__get_empty_typed_array_0']?.()
  __napiInstance.exports['__napi_register__convert_u32_array_0']?.()
  __napiInstance.exports['__napi_register__create_external_typed_array_0']?.()
  __napiInstance.exports['__napi_register__mutate_typed_array_0']?.()
  __napiInstance.exports['__napi_register__deref_uint8_array_0']?.()
  __napiInstance.exports['__napi_register__buffer_pass_through_0']?.()
  __napiInstance.exports['__napi_register__buffer_with_async_block_0']?.()
  __napiInstance.exports['__napi_register__array_buffer_pass_through_0']?.()
  __napiInstance.exports['__napi_register__accept_slice_0']?.()
  __napiInstance.exports['__napi_register__accept_arraybuffer_0']?.()
  __napiInstance.exports['__napi_register__create_arraybuffer_0']?.()
  __napiInstance.exports['__napi_register__u8_array_to_array_0']?.()
  __napiInstance.exports['__napi_register__i8_array_to_array_0']?.()
  __napiInstance.exports['__napi_register__u16_array_to_array_0']?.()
  __napiInstance.exports['__napi_register__i16_array_to_array_0']?.()
  __napiInstance.exports['__napi_register__u32_array_to_array_0']?.()
  __napiInstance.exports['__napi_register__i32_array_to_array_0']?.()
  __napiInstance.exports['__napi_register__f32_array_to_array_0']?.()
  __napiInstance.exports['__napi_register__f64_array_to_array_0']?.()
  __napiInstance.exports['__napi_register__u64_array_to_array_0']?.()
  __napiInstance.exports['__napi_register__i64_array_to_array_0']?.()
  __napiInstance.exports['__napi_register__accept_uint8_clamped_slice_0']?.()
  __napiInstance.exports['__napi_register__accept_uint8_clamped_slice_and_buffer_slice_0']?.()
  __napiInstance.exports['__napi_register__AsyncBuffer_impl_0']?.()
  __napiInstance.exports['__napi_register__async_reduce_buffer_0']?.()
  __napiInstance.exports['__napi_register__async_buffer_to_array_0']?.()
  __napiInstance.exports['__napi_register__u_init8_array_from_string_0']?.()
  __napiInstance.exports['__napi_register__AsyncReader_impl_0']?.()
  __napiInstance.exports['__napi_register__Reader_struct_0']?.()
  __napiInstance.exports['__napi_register__Reader_impl_0']?.()
}
export const Animal = __napiModule.exports.Animal
export const AnimalWithDefaultConstructor = __napiModule.exports.AnimalWithDefaultConstructor
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
export const ClassWithLifetime = __napiModule.exports.ClassWithLifetime
export const Context = __napiModule.exports.Context
export const CssRuleList = __napiModule.exports.CssRuleList
export const CSSRuleList = __napiModule.exports.CSSRuleList
export const CssStyleSheet = __napiModule.exports.CssStyleSheet
export const CSSStyleSheet = __napiModule.exports.CSSStyleSheet
export const CustomFinalize = __napiModule.exports.CustomFinalize
export const CustomStruct = __napiModule.exports.CustomStruct
export const DefaultUseNullableClass = __napiModule.exports.DefaultUseNullableClass
export const Dog = __napiModule.exports.Dog
export const Fib = __napiModule.exports.Fib
export const Fib2 = __napiModule.exports.Fib2
export const Fib3 = __napiModule.exports.Fib3
export const GetterSetterWithClosures = __napiModule.exports.GetterSetterWithClosures
export const JsClassForEither = __napiModule.exports.JsClassForEither
export const JsRemote = __napiModule.exports.JsRemote
export const JsRepo = __napiModule.exports.JsRepo
export const NinjaTurtle = __napiModule.exports.NinjaTurtle
export const NotUseNullableClass = __napiModule.exports.NotUseNullableClass
export const NotWritableClass = __napiModule.exports.NotWritableClass
export const Optional = __napiModule.exports.Optional
export const Reader = __napiModule.exports.Reader
export const Selector = __napiModule.exports.Selector
export const UseNullableClass = __napiModule.exports.UseNullableClass
export const Width = __napiModule.exports.Width
export const acceptArraybuffer = __napiModule.exports.acceptArraybuffer
export const acceptSlice = __napiModule.exports.acceptSlice
export const acceptThreadsafeFunction = __napiModule.exports.acceptThreadsafeFunction
export const acceptThreadsafeFunctionFatal = __napiModule.exports.acceptThreadsafeFunctionFatal
export const acceptThreadsafeFunctionTupleArgs = __napiModule.exports.acceptThreadsafeFunctionTupleArgs
export const acceptUint8ClampedSlice = __napiModule.exports.acceptUint8ClampedSlice
export const acceptUint8ClampedSliceAndBufferSlice = __napiModule.exports.acceptUint8ClampedSliceAndBufferSlice
export const add = __napiModule.exports.add
export const ALIAS = __napiModule.exports.ALIAS
export const AliasedEnum = __napiModule.exports.AliasedEnum
export const appendBuffer = __napiModule.exports.appendBuffer
export const apply0 = __napiModule.exports.apply0
export const apply1 = __napiModule.exports.apply1
export const arrayBufferPassThrough = __napiModule.exports.arrayBufferPassThrough
export const asyncBufferToArray = __napiModule.exports.asyncBufferToArray
export const asyncMultiTwo = __napiModule.exports.asyncMultiTwo
export const asyncPlus100 = __napiModule.exports.asyncPlus100
export const asyncReduceBuffer = __napiModule.exports.asyncReduceBuffer
export const asyncTaskOptionalReturn = __napiModule.exports.asyncTaskOptionalReturn
export const asyncTaskReadFile = __napiModule.exports.asyncTaskReadFile
export const asyncTaskVoidReturn = __napiModule.exports.asyncTaskVoidReturn
export const bigintAdd = __napiModule.exports.bigintAdd
export const bigintFromI128 = __napiModule.exports.bigintFromI128
export const bigintFromI64 = __napiModule.exports.bigintFromI64
export const bigintGetU64AsString = __napiModule.exports.bigintGetU64AsString
export const btreeSetToJs = __napiModule.exports.btreeSetToJs
export const btreeSetToRust = __napiModule.exports.btreeSetToRust
export const bufferPassThrough = __napiModule.exports.bufferPassThrough
export const bufferWithAsyncBlock = __napiModule.exports.bufferWithAsyncBlock
export const buildThreadsafeFunctionFromFunction = __napiModule.exports.buildThreadsafeFunctionFromFunction
export const buildThreadsafeFunctionFromFunctionCalleeHandle = __napiModule.exports.buildThreadsafeFunctionFromFunctionCalleeHandle
export const call0 = __napiModule.exports.call0
export const call1 = __napiModule.exports.call1
export const call2 = __napiModule.exports.call2
export const callbackReturnPromise = __napiModule.exports.callbackReturnPromise
export const callbackReturnPromiseAndSpawn = __napiModule.exports.callbackReturnPromiseAndSpawn
export const callCatchOnPromise = __napiModule.exports.callCatchOnPromise
export const callFinallyOnPromise = __napiModule.exports.callFinallyOnPromise
export const callFunction = __napiModule.exports.callFunction
export const callFunctionWithArg = __napiModule.exports.callFunctionWithArg
export const callFunctionWithArgAndCtx = __napiModule.exports.callFunctionWithArgAndCtx
export const callLongThreadsafeFunction = __napiModule.exports.callLongThreadsafeFunction
export const callThenOnPromise = __napiModule.exports.callThenOnPromise
export const callThreadsafeFunction = __napiModule.exports.callThreadsafeFunction
export const captureErrorInCallback = __napiModule.exports.captureErrorInCallback
export const chronoDateAdd1Minute = __napiModule.exports.chronoDateAdd1Minute
export const chronoDateFixtureReturn1 = __napiModule.exports.chronoDateFixtureReturn1
export const chronoDateFixtureReturn2 = __napiModule.exports.chronoDateFixtureReturn2
export const chronoDateWithTimezoneReturn = __napiModule.exports.chronoDateWithTimezoneReturn
export const chronoDateWithTimezoneToMillis = __napiModule.exports.chronoDateWithTimezoneToMillis
export const chronoLocalDateReturn = __napiModule.exports.chronoLocalDateReturn
export const chronoLocalDateToMillis = __napiModule.exports.chronoLocalDateToMillis
export const chronoNativeDateTime = __napiModule.exports.chronoNativeDateTime
export const chronoNativeDateTimeReturn = __napiModule.exports.chronoNativeDateTimeReturn
export const chronoUtcDateReturn = __napiModule.exports.chronoUtcDateReturn
export const chronoUtcDateToMillis = __napiModule.exports.chronoUtcDateToMillis
export const concatLatin1 = __napiModule.exports.concatLatin1
export const concatStr = __napiModule.exports.concatStr
export const concatUtf16 = __napiModule.exports.concatUtf16
export const contains = __napiModule.exports.contains
export const convertU32Array = __napiModule.exports.convertU32Array
export const createArraybuffer = __napiModule.exports.createArraybuffer
export const createBigInt = __napiModule.exports.createBigInt
export const createBigIntI64 = __napiModule.exports.createBigIntI64
export const createBufferSliceFromCopiedData = __napiModule.exports.createBufferSliceFromCopiedData
export const createExternal = __napiModule.exports.createExternal
export const createExternalBufferSlice = __napiModule.exports.createExternalBufferSlice
export const createExternalString = __napiModule.exports.createExternalString
export const createExternalTypedArray = __napiModule.exports.createExternalTypedArray
export const createObj = __napiModule.exports.createObj
export const createObjectWithClassField = __napiModule.exports.createObjectWithClassField
export const createObjWithProperty = __napiModule.exports.createObjWithProperty
export const createOptionalExternal = __napiModule.exports.createOptionalExternal
export const createReferenceOnFunction = __napiModule.exports.createReferenceOnFunction
export const createSymbol = __napiModule.exports.createSymbol
export const createSymbolFor = __napiModule.exports.createSymbolFor
export const CustomNumEnum = __napiModule.exports.CustomNumEnum
export const customStatusCode = __napiModule.exports.customStatusCode
export const CustomStringEnum = __napiModule.exports.CustomStringEnum
export const dateToNumber = __napiModule.exports.dateToNumber
export const DEFAULT_COST = __napiModule.exports.DEFAULT_COST
export const derefUint8Array = __napiModule.exports.derefUint8Array
export const either3 = __napiModule.exports.either3
export const either4 = __napiModule.exports.either4
export const eitherBoolOrFunction = __napiModule.exports.eitherBoolOrFunction
export const eitherBoolOrTuple = __napiModule.exports.eitherBoolOrTuple
export const eitherFromObjects = __napiModule.exports.eitherFromObjects
export const eitherFromOption = __napiModule.exports.eitherFromOption
export const eitherStringOrNumber = __napiModule.exports.eitherStringOrNumber
export const Empty = __napiModule.exports.Empty
export const enumToI32 = __napiModule.exports.enumToI32
export const errorMessageContainsNullByte = __napiModule.exports.errorMessageContainsNullByte
export const f32ArrayToArray = __napiModule.exports.f32ArrayToArray
export const f64ArrayToArray = __napiModule.exports.f64ArrayToArray
export const fibonacci = __napiModule.exports.fibonacci
export const fnReceivedAliased = __napiModule.exports.fnReceivedAliased
export const generateFunctionAndCallIt = __napiModule.exports.generateFunctionAndCallIt
export const getBtreeMapping = __napiModule.exports.getBtreeMapping
export const getBuffer = __napiModule.exports.getBuffer
export const getBufferSlice = __napiModule.exports.getBufferSlice
export const getCwd = __napiModule.exports.getCwd
export const getEmptyBuffer = __napiModule.exports.getEmptyBuffer
export const getEmptyTypedArray = __napiModule.exports.getEmptyTypedArray
export const getExternal = __napiModule.exports.getExternal
export const getGlobal = __napiModule.exports.getGlobal
export const getIndexMapping = __napiModule.exports.getIndexMapping
export const getMapping = __napiModule.exports.getMapping
export const getModuleFileName = __napiModule.exports.getModuleFileName
export const getNestedNumArr = __napiModule.exports.getNestedNumArr
export const getNull = __napiModule.exports.getNull
export const getNumArr = __napiModule.exports.getNumArr
export const getNums = __napiModule.exports.getNums
export const getOptionalExternal = __napiModule.exports.getOptionalExternal
export const getPackageJsonName = __napiModule.exports.getPackageJsonName
export const getStrFromObject = __napiModule.exports.getStrFromObject
export const getterFromObj = __napiModule.exports.getterFromObj
export const getUndefined = __napiModule.exports.getUndefined
export const getWords = __napiModule.exports.getWords
export const i16ArrayToArray = __napiModule.exports.i16ArrayToArray
export const i32ArrayToArray = __napiModule.exports.i32ArrayToArray
export const i64ArrayToArray = __napiModule.exports.i64ArrayToArray
export const i8ArrayToArray = __napiModule.exports.i8ArrayToArray
export const indexmapPassthrough = __napiModule.exports.indexmapPassthrough
export const Kind = __napiModule.exports.Kind
export const KindInValidate = __napiModule.exports.KindInValidate
export const listObjKeys = __napiModule.exports.listObjKeys
export const mapOption = __napiModule.exports.mapOption
export const mutateExternal = __napiModule.exports.mutateExternal
export const mutateOptionalExternal = __napiModule.exports.mutateOptionalExternal
export const mutateTypedArray = __napiModule.exports.mutateTypedArray
export const objectGetNamedPropertyShouldPerformTypecheck = __napiModule.exports.objectGetNamedPropertyShouldPerformTypecheck
export const optionEnd = __napiModule.exports.optionEnd
export const optionOnly = __napiModule.exports.optionOnly
export const optionStart = __napiModule.exports.optionStart
export const optionStartEnd = __napiModule.exports.optionStartEnd
export const overrideIndividualArgOnFunction = __napiModule.exports.overrideIndividualArgOnFunction
export const overrideIndividualArgOnFunctionWithCbArg = __napiModule.exports.overrideIndividualArgOnFunctionWithCbArg
export const overrideWholeFunctionType = __napiModule.exports.overrideWholeFunctionType
export const panic = __napiModule.exports.panic
export const panicInAsync = __napiModule.exports.panicInAsync
export const passSetToJs = __napiModule.exports.passSetToJs
export const passSetToRust = __napiModule.exports.passSetToRust
export const plusOne = __napiModule.exports.plusOne
export const promiseInEither = __napiModule.exports.promiseInEither
export const readFile = __napiModule.exports.readFile
export const readFileAsync = __napiModule.exports.readFileAsync
export const readPackageJson = __napiModule.exports.readPackageJson
export const receiveAllOptionalObject = __napiModule.exports.receiveAllOptionalObject
export const receiveBufferSliceWithLifetime = __napiModule.exports.receiveBufferSliceWithLifetime
export const receiveClassOrNumber = __napiModule.exports.receiveClassOrNumber
export const receiveDifferentClass = __napiModule.exports.receiveDifferentClass
export const receiveMutClassOrNumber = __napiModule.exports.receiveMutClassOrNumber
export const receiveObjectOnlyFromJs = __napiModule.exports.receiveObjectOnlyFromJs
export const receiveObjectWithClassField = __napiModule.exports.receiveObjectWithClassField
export const receiveStrictObject = __napiModule.exports.receiveStrictObject
export const receiveString = __napiModule.exports.receiveString
export const referenceAsCallback = __napiModule.exports.referenceAsCallback
export const returnCString = __napiModule.exports.returnCString
export const returnEither = __napiModule.exports.returnEither
export const returnEitherClass = __napiModule.exports.returnEitherClass
export const returnFromSharedCrate = __napiModule.exports.returnFromSharedCrate
export const returnNull = __napiModule.exports.returnNull
export const returnObjectOnlyToJs = __napiModule.exports.returnObjectOnlyToJs
export const returnUndefined = __napiModule.exports.returnUndefined
export const returnUndefinedIfInvalid = __napiModule.exports.returnUndefinedIfInvalid
export const returnUndefinedIfInvalidPromise = __napiModule.exports.returnUndefinedIfInvalidPromise
export const roundtripStr = __napiModule.exports.roundtripStr
export const runScript = __napiModule.exports.runScript
export const setSymbolInObj = __napiModule.exports.setSymbolInObj
export const spawnThreadInThread = __napiModule.exports.spawnThreadInThread
export const Status = __napiModule.exports.Status
export const StatusInValidate = __napiModule.exports.StatusInValidate
export const StringEnum = __napiModule.exports.StringEnum
export const sumBtreeMapping = __napiModule.exports.sumBtreeMapping
export const sumIndexMapping = __napiModule.exports.sumIndexMapping
export const sumMapping = __napiModule.exports.sumMapping
export const sumNums = __napiModule.exports.sumNums
export const testSerdeBigNumberPrecision = __napiModule.exports.testSerdeBigNumberPrecision
export const testSerdeBufferBytes = __napiModule.exports.testSerdeBufferBytes
export const testSerdeRoundtrip = __napiModule.exports.testSerdeRoundtrip
export const threadsafeFunctionClosureCapture = __napiModule.exports.threadsafeFunctionClosureCapture
export const threadsafeFunctionFatalMode = __napiModule.exports.threadsafeFunctionFatalMode
export const threadsafeFunctionFatalModeError = __napiModule.exports.threadsafeFunctionFatalModeError
export const threadsafeFunctionThrowError = __napiModule.exports.threadsafeFunctionThrowError
export const throwAsyncError = __napiModule.exports.throwAsyncError
export const throwError = __napiModule.exports.throwError
export const throwSyntaxError = __napiModule.exports.throwSyntaxError
export const toJsObj = __napiModule.exports.toJsObj
export const tsfnAsyncCall = __napiModule.exports.tsfnAsyncCall
export const tsfnCallWithCallback = __napiModule.exports.tsfnCallWithCallback
export const tsfnInEither = __napiModule.exports.tsfnInEither
export const tsfnReturnPromise = __napiModule.exports.tsfnReturnPromise
export const tsfnReturnPromiseTimeout = __napiModule.exports.tsfnReturnPromiseTimeout
export const tsfnThrowFromJs = __napiModule.exports.tsfnThrowFromJs
export const tsRename = __napiModule.exports.tsRename
export const u16ArrayToArray = __napiModule.exports.u16ArrayToArray
export const u32ArrayToArray = __napiModule.exports.u32ArrayToArray
export const u64ArrayToArray = __napiModule.exports.u64ArrayToArray
export const u8ArrayToArray = __napiModule.exports.u8ArrayToArray
export const uInit8ArrayFromString = __napiModule.exports.uInit8ArrayFromString
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
export const validateStructuredEnum = __napiModule.exports.validateStructuredEnum
export const validateSymbol = __napiModule.exports.validateSymbol
export const validateTypedArray = __napiModule.exports.validateTypedArray
export const validateTypedArraySlice = __napiModule.exports.validateTypedArraySlice
export const validateUint8ClampedSlice = __napiModule.exports.validateUint8ClampedSlice
export const validateUndefined = __napiModule.exports.validateUndefined
export const withAbortController = __napiModule.exports.withAbortController
export const withinAsyncRuntimeIfAvailable = __napiModule.exports.withinAsyncRuntimeIfAvailable
export const withoutAbortController = __napiModule.exports.withoutAbortController
export const xxh64Alias = __napiModule.exports.xxh64Alias
export const xxh2 = __napiModule.exports.xxh2
export const xxh3 = __napiModule.exports.xxh3
