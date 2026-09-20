use napi::{bindgen_prelude::*, JsExternal};

#[napi]
pub fn create_external(size: u32) -> External<u32> {
  External::new(size)
}

#[napi]
pub fn create_external_string(content: String) -> External<String> {
  External::new(content)
}

#[napi]
pub fn get_external(external: &External<u32>) -> u32 {
  **external
}

#[napi]
pub fn mutate_external(external: &mut External<u32>, new_val: u32) {
  **external = new_val;
}

#[napi]
pub fn create_optional_external(size: Option<u32>) -> Option<External<u32>> {
  size.map(External::new)
}

#[napi]
pub fn get_optional_external(external: Option<&External<u32>>) -> Option<u32> {
  external.map(|external| **external)
}

#[napi]
pub fn mutate_optional_external(external: Option<&mut External<u32>>, new_val: u32) {
  if let Some(external) = external {
    **external = new_val;
  }
}

#[napi]
pub fn create_external_ref(env: &Env, size: u32) -> Result<ExternalRef<u32>> {
  let external = External::new(size).into_js_external(env)?;
  external.create_ref()
}

#[napi]
pub fn get_external_ref(external: ExternalRef<u32>) -> u32 {
  *external
}

unsafe extern "C" fn finalize_foreign_external(
  _env: napi::sys::napi_env,
  data: *mut std::ffi::c_void,
  _hint: *mut std::ffi::c_void,
) {
  drop(unsafe { Box::from_raw(data as *mut u8) });
}

/// Create a `napi_external` whose payload is a foreign 1-byte allocation — not
/// an `External<T>` produced by this crate. Passing it to APIs expecting
/// `External<T>` must fail instead of dereferencing the foreign payload.
#[napi]
pub fn create_foreign_external<'env>(env: &'env Env) -> Result<JsExternal<'env>> {
  let payload = Box::into_raw(Box::new(0xABu8));
  let mut value = std::ptr::null_mut();
  let status = unsafe {
    napi::sys::napi_create_external(
      env.raw(),
      payload.cast(),
      Some(finalize_foreign_external),
      std::ptr::null_mut(),
      &mut value,
    )
  };
  if status != napi::sys::Status::napi_ok {
    drop(unsafe { Box::from_raw(payload) });
    return Err(napi::Error::new(
      napi::Status::GenericFailure,
      "napi_create_external failed".to_owned(),
    ));
  }
  unsafe { JsExternal::from_napi_value(env.raw(), value) }
}
