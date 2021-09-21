#![allow(non_upper_case_globals)]
#![allow(non_camel_case_types)]
#![allow(non_snake_case)]
#![allow(dead_code)]

use std::os::raw::{c_char, c_int, c_uint, c_void};

#[repr(C)]
#[derive(Copy, Clone)]
pub struct napi_env__ {
  _unused: [u8; 0],
}

/// Env ptr
pub type napi_env = *mut napi_env__;
#[repr(C)]
#[derive(Copy, Clone)]
pub struct napi_value__ {
  _unused: [u8; 0],
}

/// JsValue ptr
pub type napi_value = *mut napi_value__;
#[repr(C)]
#[derive(Copy, Clone)]
pub struct napi_ref__ {
  _unused: [u8; 0],
}
pub type napi_ref = *mut napi_ref__;
#[repr(C)]
#[derive(Copy, Clone)]
pub struct napi_handle_scope__ {
  _unused: [u8; 0],
}
pub type napi_handle_scope = *mut napi_handle_scope__;
#[repr(C)]
#[derive(Copy, Clone)]
pub struct napi_escapable_handle_scope__ {
  _unused: [u8; 0],
}
pub type napi_escapable_handle_scope = *mut napi_escapable_handle_scope__;
#[repr(C)]
#[derive(Copy, Clone)]
pub struct napi_callback_info__ {
  _unused: [u8; 0],
}
pub type napi_callback_info = *mut napi_callback_info__;
#[repr(C)]
#[derive(Copy, Clone)]
pub struct napi_deferred__ {
  _unused: [u8; 0],
}
#[repr(C)]
#[derive(Copy, Clone)]
pub struct uv_loop_s {
  _unused: [u8; 0],
}
pub type napi_deferred = *mut napi_deferred__;

#[repr(C)]
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum napi_property_attributes {
  napi_default = 0,
  napi_writable = 1 << 0,
  napi_enumerable = 1 << 1,
  napi_configurable = 1 << 2,

  // Used with napi_define_class to distinguish static properties
  // from instance properties. Ignored by napi_define_properties.
  napi_static = 1 << 10,
}

pub type napi_valuetype = i32;

pub mod ValueType {
  pub const napi_undefined: i32 = 0;
  pub const napi_null: i32 = 1;
  pub const napi_boolean: i32 = 2;
  pub const napi_number: i32 = 3;
  pub const napi_string: i32 = 4;
  pub const napi_symbol: i32 = 5;
  pub const napi_object: i32 = 6;
  pub const napi_function: i32 = 7;
  pub const napi_external: i32 = 8;
  #[cfg(feature = "napi6")]
  pub const napi_bigint: i32 = 9;
}

pub type napi_typedarray_type = i32;

pub mod TypedarrayType {
  pub const napi_int8_array: i32 = 0;
  pub const napi_uint8_array: i32 = 1;
  pub const napi_uint8_clamped_array: i32 = 2;
  pub const napi_int16_array: i32 = 3;
  pub const napi_uint16_array: i32 = 4;
  pub const napi_int32_array: i32 = 5;
  pub const napi_uint32_array: i32 = 6;
  pub const napi_float32_array: i32 = 7;
  pub const napi_float64_array: i32 = 8;
  #[cfg(feature = "napi6")]
  pub const napi_bigint64_array: i32 = 9;
  #[cfg(feature = "napi6")]
  pub const napi_biguint64_array: i32 = 10;
}

pub type napi_status = i32;

pub mod Status {
  pub const napi_ok: i32 = 0;
  pub const napi_invalid_arg: i32 = 1;
  pub const napi_object_expected: i32 = 2;
  pub const napi_string_expected: i32 = 3;
  pub const napi_name_expected: i32 = 4;
  pub const napi_function_expected: i32 = 5;
  pub const napi_number_expected: i32 = 6;
  pub const napi_boolean_expected: i32 = 7;
  pub const napi_array_expected: i32 = 8;
  pub const napi_generic_failure: i32 = 9;
  pub const napi_pending_exception: i32 = 10;
  pub const napi_cancelled: i32 = 11;
  pub const napi_escape_called_twice: i32 = 12;
  pub const napi_handle_scope_mismatch: i32 = 13;
  pub const napi_callback_scope_mismatch: i32 = 14;
  pub const napi_queue_full: i32 = 15;
  pub const napi_closing: i32 = 16;
  pub const napi_bigint_expected: i32 = 17;
  pub const napi_date_expected: i32 = 18;
  pub const napi_arraybuffer_expected: i32 = 19;
  pub const napi_detachable_arraybuffer_expected: i32 = 20;
  pub const napi_would_deadlock: i32 = 21; // unused
}

pub type napi_callback =
  Option<unsafe extern "C" fn(env: napi_env, info: napi_callback_info) -> napi_value>;
pub type napi_finalize = Option<
  unsafe extern "C" fn(env: napi_env, finalize_data: *mut c_void, finalize_hint: *mut c_void),
>;
#[repr(C)]
#[derive(Copy, Clone, Debug)]
pub struct napi_property_descriptor {
  pub utf8name: *const c_char,
  pub name: napi_value,
  pub method: napi_callback,
  pub getter: napi_callback,
  pub setter: napi_callback,
  pub value: napi_value,
  pub attributes: napi_property_attributes,
  pub data: *mut c_void,
}

#[repr(C)]
#[derive(Copy, Clone)]
pub struct napi_extended_error_info {
  pub error_message: *const c_char,
  pub engine_reserved: *mut c_void,
  pub engine_error_code: u32,
  pub error_code: napi_status,
}

#[repr(C)]
#[derive(Copy, Clone, PartialEq, Eq, Hash)]
pub enum napi_key_collection_mode {
  napi_key_include_prototypes,
  napi_key_own_only,
}

#[repr(C)]
#[derive(Copy, Clone, PartialEq, Eq, Hash)]
pub enum napi_key_filter {
  napi_key_all_properties = 0,
  napi_key_writable = 1,
  napi_key_enumerable = 1 << 1,
  napi_key_configurable = 1 << 2,
  napi_key_skip_strings = 1 << 3,
  napi_key_skip_symbols = 1 << 4,
}

#[repr(C)]
#[derive(Copy, Clone, PartialEq, Eq, Hash)]
pub enum napi_key_conversion {
  napi_key_keep_numbers,
  napi_key_numbers_to_strings,
}

#[cfg(feature = "napi8")]
#[repr(C)]
#[derive(Debug, Copy, Clone)]
pub struct napi_async_cleanup_hook_handle__ {
  _unused: [u8; 0],
}
#[cfg(feature = "napi8")]
pub type napi_async_cleanup_hook_handle = *mut napi_async_cleanup_hook_handle__;
#[cfg(feature = "napi8")]
pub type napi_async_cleanup_hook =
  Option<unsafe extern "C" fn(handle: napi_async_cleanup_hook_handle, data: *mut c_void)>;

extern "C" {
  pub fn napi_get_last_error_info(
    env: napi_env,
    result: *mut *const napi_extended_error_info,
  ) -> napi_status;

  pub fn napi_get_undefined(env: napi_env, result: *mut napi_value) -> napi_status;
  pub fn napi_get_null(env: napi_env, result: *mut napi_value) -> napi_status;
  pub fn napi_get_global(env: napi_env, result: *mut napi_value) -> napi_status;
  pub fn napi_get_boolean(env: napi_env, value: bool, result: *mut napi_value) -> napi_status;
  pub fn napi_create_object(env: napi_env, result: *mut napi_value) -> napi_status;
  pub fn napi_create_array(env: napi_env, result: *mut napi_value) -> napi_status;
  pub fn napi_create_array_with_length(
    env: napi_env,
    length: usize,
    result: *mut napi_value,
  ) -> napi_status;
  pub fn napi_create_double(env: napi_env, value: f64, result: *mut napi_value) -> napi_status;
  pub fn napi_create_int32(env: napi_env, value: i32, result: *mut napi_value) -> napi_status;
  pub fn napi_create_uint32(env: napi_env, value: u32, result: *mut napi_value) -> napi_status;
  pub fn napi_create_int64(env: napi_env, value: i64, result: *mut napi_value) -> napi_status;
  pub fn napi_create_string_latin1(
    env: napi_env,
    str_: *const c_char,
    length: usize,
    result: *mut napi_value,
  ) -> napi_status;
  pub fn napi_create_string_utf8(
    env: napi_env,
    str_: *const c_char,
    length: usize,
    result: *mut napi_value,
  ) -> napi_status;
  pub fn napi_create_string_utf16(
    env: napi_env,
    str_: *const u16,
    length: usize,
    result: *mut napi_value,
  ) -> napi_status;
  pub fn napi_create_symbol(
    env: napi_env,
    description: napi_value,
    result: *mut napi_value,
  ) -> napi_status;
  pub fn napi_create_function(
    env: napi_env,
    utf8name: *const c_char,
    length: usize,
    cb: napi_callback,
    data: *mut c_void,
    result: *mut napi_value,
  ) -> napi_status;
  pub fn napi_create_error(
    env: napi_env,
    code: napi_value,
    msg: napi_value,
    result: *mut napi_value,
  ) -> napi_status;
  pub fn napi_create_type_error(
    env: napi_env,
    code: napi_value,
    msg: napi_value,
    result: *mut napi_value,
  ) -> napi_status;
  pub fn napi_create_range_error(
    env: napi_env,
    code: napi_value,
    msg: napi_value,
    result: *mut napi_value,
  ) -> napi_status;
  pub fn napi_typeof(env: napi_env, value: napi_value, result: *mut napi_valuetype) -> napi_status;
  pub fn napi_get_value_double(env: napi_env, value: napi_value, result: *mut f64) -> napi_status;
  pub fn napi_get_value_int32(env: napi_env, value: napi_value, result: *mut i32) -> napi_status;
  pub fn napi_get_value_uint32(env: napi_env, value: napi_value, result: *mut u32) -> napi_status;
  pub fn napi_get_value_int64(env: napi_env, value: napi_value, result: *mut i64) -> napi_status;
  pub fn napi_get_value_bool(env: napi_env, value: napi_value, result: *mut bool) -> napi_status;
  pub fn napi_get_value_string_latin1(
    env: napi_env,
    value: napi_value,
    buf: *mut c_char,
    bufsize: usize,
    result: *mut usize,
  ) -> napi_status;
  pub fn napi_get_value_string_utf8(
    env: napi_env,
    value: napi_value,
    buf: *mut c_char,
    bufsize: usize,
    result: *mut usize,
  ) -> napi_status;
  pub fn napi_get_value_string_utf16(
    env: napi_env,
    value: napi_value,
    buf: *mut u16,
    bufsize: usize,
    result: *mut usize,
  ) -> napi_status;
  pub fn napi_coerce_to_bool(
    env: napi_env,
    value: napi_value,
    result: *mut napi_value,
  ) -> napi_status;
  pub fn napi_coerce_to_number(
    env: napi_env,
    value: napi_value,
    result: *mut napi_value,
  ) -> napi_status;
  pub fn napi_coerce_to_object(
    env: napi_env,
    value: napi_value,
    result: *mut napi_value,
  ) -> napi_status;
  pub fn napi_coerce_to_string(
    env: napi_env,
    value: napi_value,
    result: *mut napi_value,
  ) -> napi_status;
  pub fn napi_get_prototype(
    env: napi_env,
    object: napi_value,
    result: *mut napi_value,
  ) -> napi_status;
  pub fn napi_get_property_names(
    env: napi_env,
    object: napi_value,
    result: *mut napi_value,
  ) -> napi_status;
  pub fn napi_set_property(
    env: napi_env,
    object: napi_value,
    key: napi_value,
    value: napi_value,
  ) -> napi_status;
  pub fn napi_has_property(
    env: napi_env,
    object: napi_value,
    key: napi_value,
    result: *mut bool,
  ) -> napi_status;
  pub fn napi_get_property(
    env: napi_env,
    object: napi_value,
    key: napi_value,
    result: *mut napi_value,
  ) -> napi_status;
  pub fn napi_delete_property(
    env: napi_env,
    object: napi_value,
    key: napi_value,
    result: *mut bool,
  ) -> napi_status;
  pub fn napi_has_own_property(
    env: napi_env,
    object: napi_value,
    key: napi_value,
    result: *mut bool,
  ) -> napi_status;
  pub fn napi_set_named_property(
    env: napi_env,
    object: napi_value,
    utf8name: *const c_char,
    value: napi_value,
  ) -> napi_status;
  pub fn napi_has_named_property(
    env: napi_env,
    object: napi_value,
    utf8name: *const c_char,
    result: *mut bool,
  ) -> napi_status;
  pub fn napi_get_named_property(
    env: napi_env,
    object: napi_value,
    utf8name: *const c_char,
    result: *mut napi_value,
  ) -> napi_status;
  pub fn napi_set_element(
    env: napi_env,
    object: napi_value,
    index: u32,
    value: napi_value,
  ) -> napi_status;
  pub fn napi_has_element(
    env: napi_env,
    object: napi_value,
    index: u32,
    result: *mut bool,
  ) -> napi_status;
  pub fn napi_get_element(
    env: napi_env,
    object: napi_value,
    index: u32,
    result: *mut napi_value,
  ) -> napi_status;
  pub fn napi_delete_element(
    env: napi_env,
    object: napi_value,
    index: u32,
    result: *mut bool,
  ) -> napi_status;
  pub fn napi_define_properties(
    env: napi_env,
    object: napi_value,
    property_count: usize,
    properties: *const napi_property_descriptor,
  ) -> napi_status;
  pub fn napi_is_array(env: napi_env, value: napi_value, result: *mut bool) -> napi_status;
  pub fn napi_get_array_length(env: napi_env, value: napi_value, result: *mut u32) -> napi_status;
  pub fn napi_strict_equals(
    env: napi_env,
    lhs: napi_value,
    rhs: napi_value,
    result: *mut bool,
  ) -> napi_status;
  pub fn napi_call_function(
    env: napi_env,
    recv: napi_value,
    func: napi_value,
    argc: usize,
    argv: *const napi_value,
    result: *mut napi_value,
  ) -> napi_status;
  pub fn napi_new_instance(
    env: napi_env,
    constructor: napi_value,
    argc: usize,
    argv: *const napi_value,
    result: *mut napi_value,
  ) -> napi_status;
  pub fn napi_instanceof(
    env: napi_env,
    object: napi_value,
    constructor: napi_value,
    result: *mut bool,
  ) -> napi_status;
  pub fn napi_get_cb_info(
    env: napi_env,
    cbinfo: napi_callback_info,
    argc: *mut usize,
    argv: *mut napi_value,
    this_arg: *mut napi_value,
    data: *mut *mut c_void,
  ) -> napi_status;
  pub fn napi_get_new_target(
    env: napi_env,
    cbinfo: napi_callback_info,
    result: *mut napi_value,
  ) -> napi_status;
  pub fn napi_define_class(
    env: napi_env,
    utf8name: *const c_char,
    length: usize,
    constructor: napi_callback,
    data: *mut c_void,
    property_count: usize,
    properties: *const napi_property_descriptor,
    result: *mut napi_value,
  ) -> napi_status;
  pub fn napi_wrap(
    env: napi_env,
    js_object: napi_value,
    native_object: *mut c_void,
    finalize_cb: napi_finalize,
    finalize_hint: *mut c_void,
    result: *mut napi_ref,
  ) -> napi_status;
  pub fn napi_unwrap(env: napi_env, js_object: napi_value, result: *mut *mut c_void)
    -> napi_status;
  pub fn napi_remove_wrap(
    env: napi_env,
    js_object: napi_value,
    result: *mut *mut c_void,
  ) -> napi_status;
  pub fn napi_create_external(
    env: napi_env,
    data: *mut c_void,
    finalize_cb: napi_finalize,
    finalize_hint: *mut c_void,
    result: *mut napi_value,
  ) -> napi_status;
  pub fn napi_get_value_external(
    env: napi_env,
    value: napi_value,
    result: *mut *mut c_void,
  ) -> napi_status;
  pub fn napi_create_reference(
    env: napi_env,
    value: napi_value,
    initial_refcount: u32,
    result: *mut napi_ref,
  ) -> napi_status;
  pub fn napi_delete_reference(env: napi_env, ref_: napi_ref) -> napi_status;
  pub fn napi_reference_ref(env: napi_env, ref_: napi_ref, result: *mut u32) -> napi_status;
  pub fn napi_reference_unref(env: napi_env, ref_: napi_ref, result: *mut u32) -> napi_status;
  pub fn napi_get_reference_value(
    env: napi_env,
    ref_: napi_ref,
    result: *mut napi_value,
  ) -> napi_status;
  pub fn napi_open_handle_scope(env: napi_env, result: *mut napi_handle_scope) -> napi_status;
  pub fn napi_close_handle_scope(env: napi_env, scope: napi_handle_scope) -> napi_status;
  pub fn napi_open_escapable_handle_scope(
    env: napi_env,
    result: *mut napi_escapable_handle_scope,
  ) -> napi_status;
  pub fn napi_close_escapable_handle_scope(
    env: napi_env,
    scope: napi_escapable_handle_scope,
  ) -> napi_status;
  pub fn napi_escape_handle(
    env: napi_env,
    scope: napi_escapable_handle_scope,
    escapee: napi_value,
    result: *mut napi_value,
  ) -> napi_status;
  pub fn napi_throw(env: napi_env, error: napi_value) -> napi_status;
  pub fn napi_throw_error(env: napi_env, code: *const c_char, msg: *const c_char) -> napi_status;
  pub fn napi_throw_type_error(
    env: napi_env,
    code: *const c_char,
    msg: *const c_char,
  ) -> napi_status;
  pub fn napi_throw_range_error(
    env: napi_env,
    code: *const c_char,
    msg: *const c_char,
  ) -> napi_status;
  pub fn napi_is_error(env: napi_env, value: napi_value, result: *mut bool) -> napi_status;
  pub fn napi_is_exception_pending(env: napi_env, result: *mut bool) -> napi_status;
  pub fn napi_get_and_clear_last_exception(env: napi_env, result: *mut napi_value) -> napi_status;
  pub fn napi_is_arraybuffer(env: napi_env, value: napi_value, result: *mut bool) -> napi_status;
  pub fn napi_create_arraybuffer(
    env: napi_env,
    byte_length: usize,
    data: *mut *mut c_void,
    result: *mut napi_value,
  ) -> napi_status;
  pub fn napi_create_external_arraybuffer(
    env: napi_env,
    external_data: *mut c_void,
    byte_length: usize,
    finalize_cb: napi_finalize,
    finalize_hint: *mut c_void,
    result: *mut napi_value,
  ) -> napi_status;
  pub fn napi_get_arraybuffer_info(
    env: napi_env,
    arraybuffer: napi_value,
    data: *mut *mut c_void,
    byte_length: *mut usize,
  ) -> napi_status;
  pub fn napi_is_typedarray(env: napi_env, value: napi_value, result: *mut bool) -> napi_status;
  pub fn napi_create_typedarray(
    env: napi_env,
    type_: napi_typedarray_type,
    length: usize,
    arraybuffer: napi_value,
    byte_offset: usize,
    result: *mut napi_value,
  ) -> napi_status;
  pub fn napi_get_typedarray_info(
    env: napi_env,
    typedarray: napi_value,
    type_: *mut napi_typedarray_type,
    length: *mut usize,
    data: *mut *mut c_void,
    arraybuffer: *mut napi_value,
    byte_offset: *mut usize,
  ) -> napi_status;
  pub fn napi_create_dataview(
    env: napi_env,
    length: usize,
    arraybuffer: napi_value,
    byte_offset: usize,
    result: *mut napi_value,
  ) -> napi_status;
  pub fn napi_is_dataview(env: napi_env, value: napi_value, result: *mut bool) -> napi_status;
  pub fn napi_get_dataview_info(
    env: napi_env,
    dataview: napi_value,
    bytelength: *mut usize,
    data: *mut *mut c_void,
    arraybuffer: *mut napi_value,
    byte_offset: *mut usize,
  ) -> napi_status;
  pub fn napi_get_version(env: napi_env, result: *mut u32) -> napi_status;
  pub fn napi_create_promise(
    env: napi_env,
    deferred: *mut napi_deferred,
    promise: *mut napi_value,
  ) -> napi_status;
  pub fn napi_resolve_deferred(
    env: napi_env,
    deferred: napi_deferred,
    resolution: napi_value,
  ) -> napi_status;
  pub fn napi_reject_deferred(
    env: napi_env,
    deferred: napi_deferred,
    rejection: napi_value,
  ) -> napi_status;
  pub fn napi_is_promise(env: napi_env, value: napi_value, is_promise: *mut bool) -> napi_status;
  pub fn napi_run_script(env: napi_env, script: napi_value, result: *mut napi_value)
    -> napi_status;
  pub fn napi_adjust_external_memory(
    env: napi_env,
    change_in_bytes: i64,
    adjusted_value: *mut i64,
  ) -> napi_status;
  pub fn napi_module_register(mod_: *mut napi_module);
  pub fn napi_fatal_error(
    location: *const c_char,
    location_len: usize,
    message: *const c_char,
    message_len: usize,
  );
  pub fn napi_async_init(
    env: napi_env,
    async_resource: napi_value,
    async_resource_name: napi_value,
    result: *mut napi_async_context,
  ) -> napi_status;
  pub fn napi_async_destroy(env: napi_env, async_context: napi_async_context) -> napi_status;
  pub fn napi_make_callback(
    env: napi_env,
    async_context: napi_async_context,
    recv: napi_value,
    func: napi_value,
    argc: usize,
    argv: *const napi_value,
    result: *mut napi_value,
  ) -> napi_status;
  pub fn napi_create_buffer(
    env: napi_env,
    length: usize,
    data: *mut *mut c_void,
    result: *mut napi_value,
  ) -> napi_status;
  pub fn napi_create_external_buffer(
    env: napi_env,
    length: usize,
    data: *mut c_void,
    finalize_cb: napi_finalize,
    finalize_hint: *mut c_void,
    result: *mut napi_value,
  ) -> napi_status;
  pub fn napi_create_buffer_copy(
    env: napi_env,
    length: usize,
    data: *const c_void,
    result_data: *mut *mut c_void,
    result: *mut napi_value,
  ) -> napi_status;
  pub fn napi_is_buffer(env: napi_env, value: napi_value, result: *mut bool) -> napi_status;
  pub fn napi_get_buffer_info(
    env: napi_env,
    value: napi_value,
    data: *mut *mut c_void,
    length: *mut usize,
  ) -> napi_status;
  pub fn napi_create_async_work(
    env: napi_env,
    async_resource: napi_value,
    async_resource_name: napi_value,
    execute: napi_async_execute_callback,
    complete: napi_async_complete_callback,
    data: *mut c_void,
    result: *mut napi_async_work,
  ) -> napi_status;
  pub fn napi_delete_async_work(env: napi_env, work: napi_async_work) -> napi_status;
  pub fn napi_queue_async_work(env: napi_env, work: napi_async_work) -> napi_status;
  pub fn napi_cancel_async_work(env: napi_env, work: napi_async_work) -> napi_status;
  pub fn napi_get_node_version(
    env: napi_env,
    version: *mut *const napi_node_version,
  ) -> napi_status;
}

#[cfg(feature = "napi2")]
extern "C" {
  pub fn napi_get_uv_event_loop(env: napi_env, loop_: *mut *mut uv_loop_s) -> napi_status;
}

#[cfg(feature = "napi3")]
extern "C" {
  pub fn napi_fatal_exception(env: napi_env, err: napi_value) -> napi_status;
  pub fn napi_add_env_cleanup_hook(
    env: napi_env,
    fun: Option<unsafe extern "C" fn(arg: *mut c_void)>,
    arg: *mut c_void,
  ) -> napi_status;
  pub fn napi_remove_env_cleanup_hook(
    env: napi_env,
    fun: Option<unsafe extern "C" fn(arg: *mut c_void)>,
    arg: *mut c_void,
  ) -> napi_status;
  pub fn napi_open_callback_scope(
    env: napi_env,
    resource_object: napi_value,
    context: napi_async_context,
    result: *mut napi_callback_scope,
  ) -> napi_status;
  pub fn napi_close_callback_scope(env: napi_env, scope: napi_callback_scope) -> napi_status;
}

#[cfg(feature = "napi4")]
extern "C" {
  pub fn napi_create_threadsafe_function(
    env: napi_env,
    func: napi_value,
    async_resource: napi_value,
    async_resource_name: napi_value,
    max_queue_size: usize,
    initial_thread_count: usize,
    thread_finalize_data: *mut c_void,
    thread_finalize_cb: napi_finalize,
    context: *mut c_void,
    call_js_cb: napi_threadsafe_function_call_js,
    result: *mut napi_threadsafe_function,
  ) -> napi_status;
  pub fn napi_get_threadsafe_function_context(
    func: napi_threadsafe_function,
    result: *mut *mut c_void,
  ) -> napi_status;
  pub fn napi_call_threadsafe_function(
    func: napi_threadsafe_function,
    data: *mut c_void,
    is_blocking: napi_threadsafe_function_call_mode,
  ) -> napi_status;
  pub fn napi_acquire_threadsafe_function(func: napi_threadsafe_function) -> napi_status;
  pub fn napi_release_threadsafe_function(
    func: napi_threadsafe_function,
    mode: napi_threadsafe_function_release_mode,
  ) -> napi_status;
  pub fn napi_unref_threadsafe_function(
    env: napi_env,
    func: napi_threadsafe_function,
  ) -> napi_status;
  pub fn napi_ref_threadsafe_function(env: napi_env, func: napi_threadsafe_function)
    -> napi_status;
}

#[cfg(feature = "napi5")]
extern "C" {
  pub fn napi_create_date(env: napi_env, time: f64, result: *mut napi_value) -> napi_status;
  pub fn napi_is_date(env: napi_env, value: napi_value, is_date: *mut bool) -> napi_status;
  pub fn napi_get_date_value(env: napi_env, value: napi_value, result: *mut f64) -> napi_status;
  pub fn napi_add_finalizer(
    env: napi_env,
    js_object: napi_value,
    native_object: *mut c_void,
    finalize_cb: napi_finalize,
    finalize_hint: *mut c_void,
    result: *mut napi_ref,
  ) -> napi_status;
}

#[cfg(feature = "napi6")]
extern "C" {
  pub fn napi_create_bigint_int64(
    env: napi_env,
    value: i64,
    result: *mut napi_value,
  ) -> napi_status;
  pub fn napi_create_bigint_uint64(
    env: napi_env,
    value: u64,
    result: *mut napi_value,
  ) -> napi_status;
  pub fn napi_create_bigint_words(
    env: napi_env,
    sign_bit: c_int,
    word_count: usize,
    words: *const u64,
    result: *mut napi_value,
  ) -> napi_status;
  pub fn napi_get_value_bigint_int64(
    env: napi_env,
    value: napi_value,
    result: *mut i64,
    lossless: *mut bool,
  ) -> napi_status;
  pub fn napi_get_value_bigint_uint64(
    env: napi_env,
    value: napi_value,
    result: *mut u64,
    lossless: *mut bool,
  ) -> napi_status;
  pub fn napi_get_value_bigint_words(
    env: napi_env,
    value: napi_value,
    sign_bit: *mut c_int,
    word_count: *mut usize,
    words: *mut u64,
  ) -> napi_status;
  pub fn napi_get_all_property_names(
    env: napi_env,
    object: napi_value,
    key_mode: napi_key_collection_mode,
    key_filter: napi_key_filter,
    key_conversion: napi_key_conversion,
    result: *mut napi_value,
  ) -> napi_status;
  pub fn napi_set_instance_data(
    env: napi_env,
    data: *mut c_void,
    finalize_cb: napi_finalize,
    finalize_hint: *mut c_void,
  ) -> napi_status;
  pub fn napi_get_instance_data(env: napi_env, data: *mut *mut c_void) -> napi_status;
}

#[cfg(feature = "napi7")]
extern "C" {
  pub fn napi_detach_arraybuffer(env: napi_env, arraybuffer: napi_value) -> napi_status;
  pub fn napi_is_detached_arraybuffer(
    env: napi_env,
    value: napi_value,
    result: *mut bool,
  ) -> napi_status;
}

#[cfg(feature = "napi8")]
extern "C" {
  pub fn napi_add_async_cleanup_hook(
    env: napi_env,
    hook: napi_async_cleanup_hook,
    arg: *mut c_void,
    remove_handle: *mut napi_async_cleanup_hook_handle,
  ) -> napi_status;

  pub fn napi_remove_async_cleanup_hook(
    remove_handle: napi_async_cleanup_hook_handle,
  ) -> napi_status;

  pub fn napi_object_freeze(env: napi_env, object: napi_value) -> napi_status;

  pub fn napi_object_seal(env: napi_env, object: napi_value) -> napi_status;
}

#[repr(C)]
#[derive(Copy, Clone)]
pub struct napi_callback_scope__ {
  _unused: [u8; 0],
}
pub type napi_callback_scope = *mut napi_callback_scope__;
#[repr(C)]
#[derive(Copy, Clone)]
pub struct napi_async_context__ {
  _unused: [u8; 0],
}
pub type napi_async_context = *mut napi_async_context__;
#[repr(C)]
#[derive(Copy, Clone)]
pub struct napi_async_work__ {
  _unused: [u8; 0],
}
pub type napi_async_work = *mut napi_async_work__;

#[cfg(feature = "napi4")]
#[repr(C)]
#[derive(Copy, Clone)]
pub struct napi_threadsafe_function__ {
  _unused: [u8; 0],
}

#[cfg(feature = "napi4")]
pub type napi_threadsafe_function = *mut napi_threadsafe_function__;

#[cfg(feature = "napi4")]
#[repr(C)]
#[derive(Copy, Clone, PartialEq, Eq, Hash)]
pub enum napi_threadsafe_function_release_mode {
  napi_tsfn_release,
  napi_tsfn_abort,
}

#[cfg(feature = "napi4")]
#[repr(C)]
#[derive(Copy, Clone, PartialEq, Eq, Hash)]
pub enum napi_threadsafe_function_call_mode {
  napi_tsfn_nonblocking,
  napi_tsfn_blocking,
}

pub type napi_async_execute_callback =
  Option<unsafe extern "C" fn(env: napi_env, data: *mut c_void)>;
pub type napi_async_complete_callback =
  Option<unsafe extern "C" fn(env: napi_env, status: napi_status, data: *mut c_void)>;

#[cfg(feature = "napi4")]
pub type napi_threadsafe_function_call_js = Option<
  unsafe extern "C" fn(
    env: napi_env,
    js_callback: napi_value,
    context: *mut c_void,
    data: *mut c_void,
  ),
>;
#[repr(C)]
#[derive(Copy, Clone)]
pub struct napi_node_version {
  pub major: u32,
  pub minor: u32,
  pub patch: u32,
  pub release: *const c_char,
}

pub type napi_addon_register_func =
  Option<unsafe extern "C" fn(env: napi_env, exports: napi_value) -> napi_value>;
#[repr(C)]
#[derive(Copy, Clone)]
pub struct napi_module {
  pub nm_version: c_int,
  pub nm_flags: c_uint,
  pub nm_filename: *const c_char,
  pub nm_register_func: napi_addon_register_func,
  pub nm_modname: *const c_char,
  pub nm_priv: *mut c_void,
  pub reserved: [*mut c_void; 4usize],
}
