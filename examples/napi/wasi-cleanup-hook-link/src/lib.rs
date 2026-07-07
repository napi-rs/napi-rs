use napi::{bindgen_prelude::napi_register_module_v1, sys};

#[no_mangle]
pub unsafe extern "C" fn linked_napi_register_module_v1(
  env: sys::napi_env,
  exports: sys::napi_value,
) -> sys::napi_value {
  unsafe { napi_register_module_v1(env, exports) }
}
