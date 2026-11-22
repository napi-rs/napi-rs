use napi::{bindgen_prelude::*, threadsafe_function::ThreadsafeFunction, JsExternal, Task};

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

#[napi]
pub fn alias_mut_mut_external(a: &mut External<u32>, b: &mut External<u32>) -> u32 {
  **a += 1;
  **b += 2;
  **a + **b
}

#[napi]
pub fn alias_mut_ref_external(a: &mut External<u32>, b: &External<u32>) -> u32 {
  **a += 1;
  **a + **b
}

#[napi]
pub fn alias_ref_mut_external(a: &External<u32>, b: &mut External<u32>) -> u32 {
  **b += 1;
  **a + **b
}

#[napi]
pub fn alias_ref_ref_external(a: &External<u32>, b: &External<u32>) -> u32 {
  **a + **b
}

#[napi]
pub fn alias_optional_mut_external(
  a: Option<&mut External<u32>>,
  b: Option<&mut External<u32>>,
) -> u32 {
  let left = a.map_or(0, |v| {
    **v += 1;
    **v
  });
  let right = b.map_or(0, |v| {
    **v += 2;
    **v
  });
  left + right
}

#[napi]
pub fn alias_vec_mut_external(mut items: Vec<&mut External<u32>>) -> u32 {
  let mut sum = 0;
  for item in &mut items {
    ***item += 1;
    sum += ***item;
  }
  sum
}

#[napi]
pub fn alias_either_mut_external(a: Either<&mut External<u32>, u32>, b: &External<u32>) -> u32 {
  match a {
    Either::A(ext) => {
      **ext += 1;
      **ext + **b
    }
    Either::B(n) => n + **b,
  }
}

#[napi]
pub fn alias_external_ref_and_ref(mut a: ExternalRef<u32>, b: &External<u32>) -> u32 {
  *a += 1;
  *a + **b
}

#[napi]
pub fn alias_external_ref_and_mut(mut a: ExternalRef<u32>, b: &mut External<u32>) -> u32 {
  *a += 1;
  **b += 2;
  *a + **b
}

#[napi]
pub fn alias_external_ref_pair(mut a: ExternalRef<u32>, mut b: ExternalRef<u32>) -> u32 {
  *a += 1;
  *b += 2;
  *a + *b
}

#[napi]
pub fn create_duplicate_external_ref(env: &Env, size: u32) -> Result<u32> {
  let external = External::new(size).into_js_external(env)?;
  let first = external.create_ref::<u32>()?;
  let second_err = external.create_ref::<u32>().err().ok_or_else(|| {
    Error::new(
      Status::GenericFailure,
      "Expected second create_ref while first ExternalRef is active to fail".to_owned(),
    )
  })?;
  if second_err.status != Status::InvalidArg {
    return Err(Error::new(
      Status::GenericFailure,
      format!(
        "Expected InvalidArg from duplicate create_ref, got {}",
        second_err.status
      ),
    ));
  }
  drop(first);
  let second = external.create_ref::<u32>()?;
  Ok(*second)
}

#[napi]
pub fn reenter_external_callback(ext: &External<u32>, cb: Function<(), ()>) -> Result<u32> {
  cb.call(())?;
  Ok(**ext)
}

#[napi]
pub fn reenter_mut_external_callback(ext: &mut External<u32>, cb: Function<(), ()>) -> Result<u32> {
  cb.call(())?;
  **ext += 1;
  Ok(**ext)
}

#[napi]
pub fn escape_external_from_object(obj: Object) -> Result<u32> {
  let ext: &mut External<u32> = obj.get("ext")?.ok_or_else(|| {
    Error::new(
      Status::InvalidArg,
      "Expected `ext` property on object".to_owned(),
    )
  })?;
  Ok(**ext)
}

#[napi]
pub fn create_closure_reading_external<'env>(
  env: &'env Env,
) -> Result<Function<'env, Unknown<'env>, u32>> {
  env.create_function_from_closure("readExternalInClosure", |ctx| {
    let ext = ctx.get::<&mut External<u32>>(0)?;
    Ok(**ext)
  })
}

#[napi]
pub async fn accept_promise_external(p: Promise<&'static mut External<u32>>) -> Result<u32> {
  let ext = p.await?;
  Ok(**ext)
}

#[napi]
pub async fn tsfn_return_external(
  func: ThreadsafeFunction<u32, &'static mut External<u32>>,
) -> Result<u32> {
  let ext = func.call_async(Ok(1)).await?;
  Ok(**ext)
}

#[napi]
pub fn reenter_during_external_arg_conversion(items: Vec<u32>, ext: &External<u32>) -> u32 {
  items.into_iter().sum::<u32>() + **ext
}

pub struct ReadBorrowedExternalTask<'a> {
  ext: &'a External<u32>,
  gate: u32,
}

#[napi]
impl<'task> Task for ReadBorrowedExternalTask<'task> {
  type Output = u32;
  type JsValue = u32;

  fn compute(&mut self) -> Result<Self::Output> {
    crate::issue_3583::wait_borrow_gate(self.gate)?;
    Ok(**self.ext)
  }

  fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
    Ok(output)
  }
}

#[napi]
pub fn read_borrowed_external_task<'a>(
  ext: &'a External<u32>,
  gate: u32,
) -> AsyncTask<ReadBorrowedExternalTask<'a>> {
  AsyncTask::new(ReadBorrowedExternalTask { ext, gate })
}

#[napi]
pub async fn read_borrowed_external_async_fn(ext: &External<u32>, gate: u32) -> Result<u32> {
  crate::issue_3583::wait_borrow_gate(gate)?;
  Ok(**ext)
}

#[napi]
pub async fn read_optional_external_async_fn(
  ext: Option<&External<String>>,
  gate: u32,
) -> Result<Option<String>> {
  crate::issue_3583::wait_borrow_gate(gate)?;
  Ok(ext.map(|value| (**value).clone()))
}
