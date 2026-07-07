use std::cell::Cell;
#[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
use std::{
  cell::RefCell,
  ffi::c_void,
  ptr,
  sync::atomic::{AtomicUsize, Ordering},
};

use napi::bindgen_prelude::*;
use napi::JsExternal;

#[cfg(not(feature = "noop"))]
struct RuntimeLifecycleExternalProbe {
  result_path: String,
}

#[cfg(not(feature = "noop"))]
impl Drop for RuntimeLifecycleExternalProbe {
  fn drop(&mut self) {
    crate::env::record_runtime_transition_probe(&self.result_path);
  }
}

#[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
thread_local! {
  static LIFECYCLE_STASHED_EXTERNAL_REF: RefCell<Option<ExternalRef<Cell<u32>>>> =
    const { RefCell::new(None) };
  static LIFECYCLE_TEARDOWN_EXTERNAL_REF: RefCell<Option<ExternalRefTeardownProbe>> =
    const { RefCell::new(None) };
}

#[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
struct ExternalRefTeardownProbe {
  result_path: String,
  reference: Option<ExternalRef<Cell<u32>>>,
}

#[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
#[repr(C, align(16))]
struct ForeignExternalPayload {
  _bytes: [u8; 32],
}

#[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
static EXTERNAL_TOKEN_GC_FINALIZE_COUNT: AtomicUsize = AtomicUsize::new(0);

#[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
pub(crate) struct ExternalTokenGcProbe {
  value: Cell<u32>,
}

#[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
impl Drop for ExternalTokenGcProbe {
  fn drop(&mut self) {
    EXTERNAL_TOKEN_GC_FINALIZE_COUNT.fetch_add(1, Ordering::SeqCst);
  }
}

#[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
unsafe extern "C" fn finalize_foreign_external(
  _env: sys::napi_env,
  data: *mut c_void,
  _hint: *mut c_void,
) {
  if !data.is_null() {
    drop(unsafe { Box::from_raw(data.cast::<ForeignExternalPayload>()) });
  }
}

#[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
impl Drop for ExternalRefTeardownProbe {
  fn drop(&mut self) {
    let Some(reference) = self.reference.take() else {
      return;
    };
    let value = reference.get();
    let conversion = match reference.get_value() {
      Err(error)
        if error.status == Status::InvalidArg
          && error.reason.contains("owner environment has closed") =>
      {
        "closed"
      }
      Err(_) => "wrong-error",
      Ok(_) => "open",
    };
    drop(reference);
    let _ = std::fs::write(
      &self.result_path,
      format!("value={value};conversion={conversion}"),
    );
  }
}

#[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
#[napi(
  js_name = "inspectExternalRefAcrossDuplicateLoad",
  ts_args_type = "value: ExternalObject<number>"
)]
fn inspect_lifecycle_external_ref(value: ExternalRef<Cell<u32>>) -> u32 {
  value.get()
}

#[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
#[napi(
  js_name = "stashExternalRefAcrossDuplicateLoad",
  ts_args_type = "value: ExternalObject<number>"
)]
fn stash_lifecycle_external_ref(value: ExternalRef<Cell<u32>>) {
  LIFECYCLE_STASHED_EXTERNAL_REF.with(|stored| *stored.borrow_mut() = Some(value));
}

#[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
#[napi(
  js_name = "takeExternalRefAcrossDuplicateLoad",
  ts_return_type = "ExternalObject<number>"
)]
fn take_lifecycle_external_ref() -> Result<ExternalRef<Cell<u32>>> {
  LIFECYCLE_STASHED_EXTERNAL_REF
    .with(|stored| stored.borrow_mut().take())
    .ok_or_else(|| Error::from_reason("no lifecycle ExternalRef was stashed"))
}

#[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
#[napi(js_name = "stashExternalRefForTeardown")]
fn stash_lifecycle_external_ref_for_teardown(
  env: &Env,
  result_path: String,
  value: u32,
) -> Result<()> {
  let reference = ExternalRef::new(env, Cell::new(value))?;
  LIFECYCLE_TEARDOWN_EXTERNAL_REF.with(|stored| {
    *stored.borrow_mut() = Some(ExternalRefTeardownProbe {
      result_path,
      reference: Some(reference),
    });
  });
  Ok(())
}

#[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
#[napi(js_name = "createExternalRefProvenanceProbe")]
pub fn create_external_ref_provenance_probe(env: &Env, forged: bool) -> Result<Unknown<'_>> {
  let data = if forged {
    ptr::without_provenance_mut::<c_void>(1)
  } else {
    Box::into_raw(Box::new(ForeignExternalPayload { _bytes: [0; 32] })).cast()
  };
  let finalize: sys::napi_finalize = if forged {
    None
  } else {
    Some(finalize_foreign_external)
  };
  let mut value = ptr::null_mut();
  let status =
    unsafe { sys::napi_create_external(env.raw(), data, finalize, ptr::null_mut(), &mut value) };
  if status != sys::Status::napi_ok {
    if !forged {
      drop(unsafe { Box::from_raw(data.cast::<ForeignExternalPayload>()) });
    }
    return Err(Error::new(
      Status::from(status),
      "Failed to create foreign External provenance probe".to_owned(),
    ));
  }
  Ok(unsafe { Unknown::from_raw_unchecked(env.raw(), value) })
}

#[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
#[napi(
  js_name = "copyExternalTokenAlias",
  ts_args_type = "value: ExternalObject<number>",
  ts_return_type = "ExternalObject<number>"
)]
pub fn copy_external_token_alias<'env>(
  env: &'env Env,
  value: Unknown<'env>,
) -> Result<Unknown<'env>> {
  let mut data = ptr::null_mut();
  check_status!(
    unsafe { sys::napi_get_value_external(env.raw(), value.raw(), &mut data) },
    "Failed to read External token"
  )?;
  let mut alias = ptr::null_mut();
  check_status!(
    unsafe { sys::napi_create_external(env.raw(), data, None, ptr::null_mut(), &mut alias,) },
    "Failed to copy External token"
  )?;
  Ok(unsafe { Unknown::from_raw_unchecked(env.raw(), alias) })
}

#[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
#[napi(
  js_name = "createExternalTokenGcProbe",
  ts_return_type = "ExternalObject<number>"
)]
pub fn create_external_token_gc_probe(value: u32) -> External<ExternalTokenGcProbe> {
  External::new(ExternalTokenGcProbe {
    value: Cell::new(value),
  })
}

#[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
#[napi(
  js_name = "inspectExternalTokenGcProbe",
  ts_args_type = "value: ExternalObject<number>"
)]
pub fn inspect_external_token_gc_probe(value: &External<ExternalTokenGcProbe>) -> u32 {
  value.value.get()
}

#[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
#[napi(js_name = "externalTokenGcProbeFinalizeCount")]
pub fn external_token_gc_probe_finalize_count() -> u32 {
  EXTERNAL_TOKEN_GC_FINALIZE_COUNT.load(Ordering::SeqCst) as u32
}

#[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
#[napi(
  js_name = "createExternalPublicBorrowProbe",
  ts_return_type = "(value: ExternalObject<number>) => number"
)]
pub fn create_external_public_borrow_probe<'env>(
  env: &'env Env,
) -> Result<Function<'env, Unknown<'env>, u32>> {
  env.create_function_from_closure("externalPublicBorrowProbe", |ctx| {
    let value = ctx.get::<&External<Cell<u32>>>(0)?;
    Ok(value.get())
  })
}

#[cfg(not(feature = "noop"))]
#[napi]
pub fn create_runtime_lifecycle_external_probe(
  env: &Env,
  result_path: String,
) -> Result<Unknown<'_>> {
  External::new(RuntimeLifecycleExternalProbe { result_path }).into_unknown(env)
}

#[napi(ts_return_type = "ExternalObject<number>")]
pub fn create_external(size: u32) -> External<Cell<u32>> {
  External::new(Cell::new(size))
}

#[napi]
pub fn create_external_string(content: String) -> External<String> {
  External::new(content)
}

#[napi(ts_args_type = "external: ExternalObject<number>")]
pub fn get_external(external: &External<Cell<u32>>) -> u32 {
  external.get()
}

#[napi(ts_args_type = "external: ExternalObject<number>")]
pub fn get_js_external(external: JsExternal<'_>) -> Result<u32> {
  Ok(external.get_value::<Cell<u32>>()?.get())
}

#[napi(ts_args_type = "external: ExternalObject<number>, newVal: number")]
pub fn mutate_external(external: &External<Cell<u32>>, new_val: u32) {
  external.set(new_val);
}

#[napi(ts_return_type = "ExternalObject<number> | null")]
pub fn create_optional_external(size: Option<u32>) -> Option<External<Cell<u32>>> {
  size.map(|value| External::new(Cell::new(value)))
}

#[napi(ts_args_type = "external?: ExternalObject<number> | undefined | null")]
pub fn get_optional_external(external: Option<&External<Cell<u32>>>) -> Option<u32> {
  external.map(|external| external.get())
}

#[napi(ts_args_type = "external: ExternalObject<number> | undefined | null, newVal: number")]
pub fn mutate_optional_external(external: Option<&External<Cell<u32>>>, new_val: u32) {
  if let Some(external) = external {
    external.set(new_val);
  }
}

#[napi(ts_return_type = "ExternalObject<number>")]
pub fn create_external_ref(env: &Env, size: u32) -> Result<ExternalRef<Cell<u32>>> {
  let external = External::new(Cell::new(size)).into_js_external(env)?;
  external.create_ref()
}
