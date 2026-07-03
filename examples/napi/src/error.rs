use napi::bindgen_prelude::*;

#[napi]
pub fn throw_error() -> Result<()> {
  Err(Error::new(Status::InvalidArg, "Manual Error".to_owned()))
}

#[napi]
pub fn throw_error_with_cause() -> Result<()> {
  let mut err = Error::new(Status::GenericFailure, "Manual Error".to_owned());
  err.set_cause(Error::new(Status::InvalidArg, "Inner Error".to_owned()));
  Err(err)
}

#[napi(catch_unwind)]
pub fn panic() {
  panic!("Don't panic");
}

#[napi]
pub fn receive_string(s: String) -> String {
  s
}

pub enum CustomError {
  NapiError(Error<Status>),
  Panic,
}

impl AsRef<str> for CustomError {
  fn as_ref(&self) -> &str {
    match self {
      CustomError::Panic => "Panic",
      CustomError::NapiError(e) => e.status.as_ref(),
    }
  }
}

#[napi]
pub fn custom_status_code() -> Result<(), CustomError> {
  Err(Error::new(CustomError::Panic, "don't panic"))
}

#[napi]
pub fn error_message_contains_null_byte(msg: Utf16String) -> Result<()> {
  Err(Error::new(Status::InvalidArg, msg))
}

#[napi]
pub async fn throw_async_error() -> Result<()> {
  Err(Error::new(Status::InvalidArg, "Async Error".to_owned()))
}

#[napi]
pub struct CustomStruct();

#[napi]
impl CustomStruct {
  #[napi(factory)]
  pub fn custom_status_code_for_factory() -> Result<Self, CustomError> {
    Err(Error::new(CustomError::Panic, "don't panic"))
  }

  #[napi(constructor)]
  pub fn custom_status_code_for_constructor() -> Result<Self, CustomError> {
    Err(Error::new(CustomError::Panic, "don't panic"))
  }
}

#[napi]
pub fn js_error_callback(value: Unknown) -> Result<Vec<JsError>> {
  let error: Error = value.into();
  Ok(vec![error.try_clone()?.into(), error.into()])
}

#[napi]
pub fn extends_javascript_error(env: Env, error_class: Function<String>) -> Result<()> {
  let instance = error_class.new_instance("Error message in Rust".to_owned())?;
  let mut error_object = instance.coerce_to_object()?;
  error_object.set("name", "RustError")?;
  error_object.set(
    "nativeStackTrace",
    std::backtrace::Backtrace::capture().to_string(),
  )?;
  env.throw(error_object)?;
  Ok(())
}

// ---------------------------------------------------------------------------
// Regression exports for JS-derived `Error`s released off the JS thread
// (napi-rs#3368): an `Error` created from a JS value owns a `napi_ref`, is
// `Send`, and its `Drop` must be safe on any thread.
// ---------------------------------------------------------------------------

/// Converts `value` into an `Error` — creating a `napi_ref` to it, the same
/// code path a `Promise` rejection takes — and drops it on a spawned thread.
#[napi]
pub fn drop_error_from_value_off_thread(value: Unknown) -> Result<()> {
  let error: Error = value.into();
  // Deliberately detached: the drop racing the JS thread's concurrent
  // GlobalHandles churn IS the regression under test; joining would
  // serialize them and mask the unfixed crash.
  std::thread::spawn(move || drop(error));
  Ok(())
}

/// Creates and deletes `count` references on the calling JS thread, so
/// concurrent off-thread releases have live `GlobalHandles` traffic to race
/// with (this is what made the corruption deterministic in napi-rs#3368).
#[napi]
pub fn churn_global_handles(env: Env, value: Unknown, count: u32) -> Result<()> {
  for _ in 0..count {
    let mut reference = std::ptr::null_mut();
    check_status!(
      unsafe { sys::napi_create_reference(env.raw(), value.raw(), 1, &mut reference) },
      "napi_create_reference failed"
    )?;
    check_status!(
      unsafe { sys::napi_delete_reference(env.raw(), reference) },
      "napi_delete_reference failed"
    )?;
  }
  Ok(())
}

/// Awaits `promise` on the async runtime; a rejection materializes as an
/// `Error` carrying a `napi_ref` and is dropped here, off the JS thread.
/// Returns `true` when the promise rejected.
#[napi]
pub async fn await_rejection_off_thread(promise: Promise<()>) -> Result<bool> {
  match promise.await {
    Ok(()) => Ok(false),
    Err(error) => {
      drop(error);
      Ok(true)
    }
  }
}

/// `try_clone` shares one `napi_ref` between siblings: drop one off-thread
/// (routed through the custom GC) and one on the JS thread. The reference
/// must be deleted only when the last sibling drops.
#[napi]
pub fn drop_cloned_errors_on_two_threads(value: Unknown) -> Result<()> {
  let error: Error = value.into();
  let sibling = error.try_clone()?;
  std::thread::spawn(move || drop(sibling))
    .join()
    .map_err(|_| Error::from_reason("sibling drop thread panicked"))?;
  drop(error);
  Ok(())
}

thread_local! {
  static STASHED_ERRORS: std::cell::RefCell<Vec<Error>> = const { std::cell::RefCell::new(Vec::new()) };
}

/// Stashes a JS-derived `Error` in a Rust thread_local on the calling JS
/// thread. In a worker it drops at thread-exit, AFTER env teardown — the
/// release must no-op (leak), not use-after-free.
#[napi]
pub fn stash_error_in_thread_local(value: Unknown) {
  STASHED_ERRORS.with(|c| c.borrow_mut().push(value.into()));
}

/// `try_clone` must refuse to run off the owning JS thread (the refcount
/// increment is thread-affine). Returns what it produced there: the clone
/// outcome or the guard's error message.
#[napi]
pub fn try_clone_error_off_thread(value: Unknown) -> Result<String> {
  let error: Error = value.into();
  std::thread::spawn(move || {
    let outcome = match error.try_clone() {
      Ok(_clone) => "cloned".to_owned(),
      Err(guard_error) => guard_error.reason.clone(),
    };
    // `error` (and a clone, if the guard ever regressed) drops here,
    // off-thread — routed through the custom GC by the fix.
    outcome
  })
  .join()
  .map_err(|_| Error::from_reason("try_clone thread panicked"))
}
