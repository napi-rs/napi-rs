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

/// `try_clone` shares one `napi_ref` between siblings via an `Arc<ErrorRef>`;
/// dropping a sibling is an atomic refcount decrement, and the underlying
/// reference is released only when the LAST sibling drops. Here the original
/// drops on the JS thread first (a plain decrement, no release), then the last
/// sibling drops off-thread — so the release is routed through the custom-GC
/// TSFN, exactly the path a shared reference must survive without corrupting
/// V8's GlobalHandles from a foreign thread.
#[napi]
pub fn drop_cloned_errors_on_two_threads(value: Unknown) -> Result<()> {
  let error: Error = value.into();
  let sibling = error.try_clone()?;
  // Drop the original on the owning JS thread first — not the last reference.
  drop(error);
  // The last sibling drops off-thread: its release routes through the custom GC.
  std::thread::spawn(move || drop(sibling))
    .join()
    .map_err(|_| Error::from_reason("sibling drop thread panicked"))?;
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

/// Regression cover for napi-rs#3370: `try_clone` off the owning JS thread
/// can't share the thread-affine `napi_ref`, so it must return a reference-less
/// copy that still carries the message — NOT a guard placeholder that discards
/// it. rolldown relies on this to surface plugin errors from its build workers
/// (it does `try_clone().unwrap_or_else(|e| e)` off-thread). Returns the cloned
/// error's message so the test can assert it survived the off-thread clone.
#[napi]
pub fn try_clone_error_off_thread(value: Unknown) -> Result<String> {
  let error: Error = value.into();
  std::thread::spawn(move || {
    // Both arms return the resulting `Error`'s message. Before the fix the
    // off-thread clone failed and this returned the guard's placeholder reason;
    // with the fix it returns the preserved original message.
    match error.try_clone() {
      Ok(clone) => clone.reason.clone(),
      Err(clone_error) => clone_error.reason.clone(),
    }
    // `error` and the clone drop here, off-thread: the original's reference is
    // routed through the custom GC, the reference-less clone's drop no-ops.
  })
  .join()
  .map_err(|_| Error::from_reason("try_clone thread panicked"))
}

/// Regression cover for napi-rs#3370 cause preservation: a JS `Error` carrying
/// a `.cause` cloned off the owning thread must keep the cause chain (rebuilt
/// reference-lessly), not drop it — otherwise the surfaced error loses its
/// underlying cause. Extracts the JS `.cause` into the Rust `Error`'s `cause`
/// field on the JS thread, clones off-thread, and returns the cloned error's
/// cause message (empty string if the cause was lost).
#[napi]
pub fn try_clone_error_cause_off_thread(value: Unknown) -> Result<String> {
  let error: Error = value.into();
  std::thread::spawn(move || {
    error
      .try_clone()
      .ok()
      .and_then(|clone| clone.cause.as_ref().map(|cause| cause.reason.clone()))
      .unwrap_or_default()
  })
  .join()
  .map_err(|_| Error::from_reason("try_clone cause thread panicked"))
}

/// Regression cover for the *transitive* clone case: clone the JS-derived
/// `Error` once ON the owning JS thread (a reference-sharing clone), then move
/// that clone to another thread and clone it AGAIN. Because the on-thread clone
/// keeps a reference-less cause backup, the off-thread re-clone must still carry
/// the cause chain — cause survival must not depend on the order of clones.
/// Returns the re-clone's cause message (empty string if the cause was lost).
#[napi]
pub fn try_clone_error_cause_transitive_off_thread(value: Unknown) -> Result<String> {
  let error: Error = value.into();
  // Reference-sharing clone made on the owning JS thread.
  let on_thread_clone = error.try_clone()?;
  std::thread::spawn(move || {
    // Off-thread re-clone. `on_thread_clone` still carries the shared reference
    // (its `custom_gc` handle is set), so this re-enters the Arc-sharing arm
    // rather than the reference-less path — but that arm ALSO keeps a
    // reference-less cause backup, so the cause chain survives regardless of
    // clone order. `on_thread_clone` drops here off-thread; if it is the last
    // sibling, the shared reference is released through the custom GC.
    on_thread_clone
      .try_clone()
      .ok()
      .and_then(|clone| clone.cause.as_ref().map(|cause| cause.reason.clone()))
      .unwrap_or_default()
  })
  .join()
  .map_err(|_| Error::from_reason("transitive try_clone thread panicked"))
}

/// A reference-less `Error` tagged `Status::PendingException` (the shape a
/// JS-thrown error takes after `try_clone` off the owning thread drops its
/// `napi_ref`) must still be thrown to JS, not silently swallowed. `throw_into`
/// used to skip throwing on that status alone; it now only skips when the env
/// genuinely has a pending exception. Returned as `Err` from a sync `#[napi]`
/// function so it flows through `throw_into`.
#[napi]
pub fn throw_detached_pending_exception() -> Result<()> {
  Err(Error::new(
    Status::PendingException,
    "detached pending exception message".to_owned(),
  ))
}

/// Regression cover for off-thread *fidelity*: an `Error` derived from a JS
/// exception, cloned off the owning thread and then surfaced to JS *on the
/// owning thread*, must reuse the ORIGINAL JS error object — so its `.stack`,
/// subclass, and arbitrary own properties survive, not just the message. This
/// is rolldown's plugin-error path (clone on a build worker, thrown on the JS
/// thread); a reference-less clone would rebuild a bare `Error(message)` and
/// silently drop the stack and props. The clone is made on a spawned thread and
/// returned as `Err`, so it converts back to JS on the owning thread — where
/// `into_value` reads the shared reference and returns the very same object.
#[napi]
pub fn try_clone_error_off_thread_keep_reference(value: Unknown) -> Result<()> {
  let error: Error = value.into();
  let cloned = std::thread::spawn(move || error.try_clone())
    .join()
    .map_err(|_| Error::from_reason("try_clone thread panicked"))??;
  Err(cloned)
}
