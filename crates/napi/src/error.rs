use std::convert::{From, TryFrom};
use std::error;
use std::ffi::CStr;
use std::fmt;
#[cfg(feature = "serde-json")]
use std::fmt::Display;
use std::os::raw::c_void;
use std::ptr;

#[cfg(feature = "serde-json")]
use serde::{de, ser};
#[cfg(feature = "serde-json")]
use serde_json::Error as SerdeJSONError;

#[cfg(target_family = "wasm")]
use crate::bindgen_runtime::JsObjectValue;
use crate::ValueType;
use crate::{bindgen_runtime::ToNapiValue, sys, Env, JsValue, Status, Unknown};

pub type Result<T, S = Status> = std::result::Result<T, Error<S>>;

const ERROR_VALUE_KEY: &CStr = c"[[ErrorValue]]";

#[cfg(feature = "napi4")]
type ErrorRefHandle = std::sync::Arc<ErrorRef>;
#[cfg(not(feature = "napi4"))]
type ErrorRefHandle = std::rc::Rc<ErrorRef>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PendingExceptionState {
  None,
  Cleared(sys::napi_value),
  Unavailable(sys::napi_status),
}

fn take_pending_exception_with(
  check: impl FnOnce() -> std::result::Result<bool, sys::napi_status>,
  clear: impl FnOnce() -> std::result::Result<sys::napi_value, sys::napi_status>,
) -> PendingExceptionState {
  match check() {
    Ok(false) => PendingExceptionState::None,
    Ok(true) => match clear() {
      Ok(exception) if !exception.is_null() => PendingExceptionState::Cleared(exception),
      Ok(_) => PendingExceptionState::Unavailable(sys::Status::napi_generic_failure),
      Err(status) => PendingExceptionState::Unavailable(status),
    },
    Err(status) => PendingExceptionState::Unavailable(status),
  }
}

pub(crate) fn take_pending_exception(env: sys::napi_env) -> PendingExceptionState {
  take_pending_exception_with(
    || {
      let mut is_pending = false;
      let status = unsafe { sys::napi_is_exception_pending(env, &mut is_pending) };
      (status == sys::Status::napi_ok)
        .then_some(is_pending)
        .ok_or(status)
    },
    || {
      let mut exception = ptr::null_mut();
      let status = unsafe { sys::napi_get_and_clear_last_exception(env, &mut exception) };
      (status == sys::Status::napi_ok)
        .then_some(exception)
        .ok_or(status)
    },
  )
}

pub(crate) enum ErrorCaptureResult {
  Captured(Error),
  Failed(Error),
  EnvironmentUnavailable(sys::napi_status),
}

pub(crate) enum CheckedErrorValue {
  Value(sys::napi_value),
  Exception(sys::napi_value),
  Failed(sys::napi_status),
  EnvironmentUnavailable,
}

enum CheckedReferencedValue {
  Value(sys::napi_value),
  Missing,
  Exception(sys::napi_value),
  Failed(sys::napi_status),
  EnvironmentUnavailable,
}

struct ErrorCaptureFailure {
  status: sys::napi_status,
  reason: &'static str,
  environment_unavailable: Option<sys::napi_status>,
}

impl ErrorCaptureFailure {
  fn from_napi_failure(env: sys::napi_env, status: sys::napi_status, reason: &'static str) -> Self {
    let environment_unavailable = match take_pending_exception(env) {
      PendingExceptionState::None | PendingExceptionState::Cleared(_) => None,
      PendingExceptionState::Unavailable(status) => Some(status),
    };
    Self {
      status,
      reason,
      environment_unavailable,
    }
  }

  fn environment_unavailable(status: sys::napi_status, reason: &'static str) -> Self {
    Self {
      status,
      reason,
      environment_unavailable: Some(status),
    }
  }

  fn into_error(self) -> Error {
    Error::new(Status::from(self.status), self.reason)
  }

  fn into_transport_error(self) -> Error {
    Error::new(
      Status::GenericFailure,
      format!("{}: {}", self.reason, Status::from(self.status)),
    )
  }
}

/// Represent `JsError`.
/// Return this Error in `js_function`, **napi-rs** will throw it as `JsError` for you.
/// If you want throw it as `TypeError` or `RangeError`, you can use `JsTypeError/JsRangeError::from(Error).throw_into(env)`
pub struct Error<S: AsRef<str> = Status> {
  pub status: S,
  pub reason: String,
  pub cause: Option<Box<Error>>,
  // A JS-derived `Error` can own a `napi_ref` to its original JS value, kept
  // behind a reference-counted [`ErrorRef`]. Values that N-API cannot reference
  // directly (including primitives) are retained through a private holder
  // object. With N-API 4 this is an `Arc`, so `try_clone` can share it across
  // threads while custom GC routes the single release to the owning JavaScript
  // thread. Earlier N-API versions use `Rc` and keep the owner thread-affine.
  // `None` is used for errors that retain no JS value, including
  // Rust-constructed errors and ordinary WASM `From<Unknown>` conversions.
  pub(crate) maybe_ref: Option<ErrorRefHandle>,
}

/// Shared owner of a JS value's thread-affine `napi_ref`.
///
/// The `napi_ref` is created once at refcount 1. Under N-API 4, `try_clone` may
/// share it through an `Arc` and foreign-thread release is routed through the
/// env's custom-GC TSFN. Earlier N-API versions keep the handle in an
/// owner-thread `Rc` and produce reference-less clones. If no custom-GC handle
/// exists and the final handle reaches a foreign thread, cleanup intentionally
/// leaves the reference for env teardown rather than calling N-API off-thread.
pub(crate) struct ErrorRef {
  raw: sys::napi_ref,
  indirect: bool,
  #[cfg_attr(feature = "noop", allow(dead_code))]
  env: sys::napi_env,
  owner_thread: std::thread::ThreadId,
  // The owning env's custom-GC handle, captured on the owning JS thread when
  // `raw` is created. When available, it lets releases be routed safely from
  // any thread. Otherwise `owner_thread` gates all access and cleanup because
  // the `napi_ref` is thread-affine.
  #[cfg(all(feature = "napi4", not(feature = "noop")))]
  custom_gc: Option<std::sync::Arc<crate::bindgen_prelude::CustomGcHandle>>,
}

// SAFETY: N-API 4 provides the custom-GC TSFN used by `ErrorRef::drop` to route
// foreign-thread releases back to the owning JavaScript thread. If no handle
// was captured, reads are rejected and drops intentionally leak off-thread
// instead of calling N-API.
#[cfg(feature = "napi4")]
unsafe impl Send for ErrorRef {}
#[cfg(feature = "napi4")]
unsafe impl Sync for ErrorRef {}

impl ErrorRef {
  /// Wraps a freshly created (`refcount == 1`) JS value `napi_ref`, capturing
  /// the current thread's custom-GC handle. Must be called on the owning JS
  /// thread with a non-null `raw`. Every construction site builds an `ErrorRef`
  /// only after `napi_create_reference` succeeds, so `ErrorRef::drop` can
  /// release without a null check.
  pub(crate) fn new(raw: sys::napi_ref, env: sys::napi_env) -> Self {
    debug_assert!(!raw.is_null(), "ErrorRef must wrap a non-null napi_ref");
    Self {
      raw,
      indirect: false,
      env,
      owner_thread: std::thread::current().id(),
      #[cfg(all(feature = "napi4", not(feature = "noop")))]
      custom_gc: crate::bindgen_prelude::current_custom_gc_handle(env),
    }
  }

  #[cfg_attr(
    not(any(feature = "tokio_rt", feature = "async-runtime")),
    allow(dead_code)
  )]
  fn new_indirect(raw: sys::napi_ref, env: sys::napi_env) -> Self {
    let mut value = Self::new(raw, env);
    value.indirect = true;
    value
  }
}

/// Releases a JS value's `napi_ref` on the owning JS thread: unref to 0, then
/// delete. Called exactly once, from `ErrorRef::drop`.
#[cfg(not(feature = "noop"))]
fn release_error_reference(env: sys::napi_env, reference: sys::napi_ref) {
  let mut ref_count = 0;
  let status = unsafe { sys::napi_reference_unref(env, reference, &mut ref_count) };
  if status != sys::Status::napi_ok {
    eprintln!("unref error reference failed: {}", Status::from(status));
    return;
  }
  if ref_count == 0 {
    let status = unsafe { sys::napi_delete_reference(env, reference) };
    if status != sys::Status::napi_ok {
      eprintln!("delete error reference failed: {}", Status::from(status));
    }
  }
}

#[cfg(not(feature = "noop"))]
impl Drop for ErrorRef {
  fn drop(&mut self) {
    #[cfg(all(feature = "napi4", not(feature = "noop")))]
    if let Some(handle) = self.custom_gc.take() {
      let status = handle.release_reference(self.raw);
      assert!(
        status == sys::Status::napi_ok || status == sys::Status::napi_closing,
        "Call custom GC in ErrorRef::drop failed {}",
        Status::from(status)
      );
      return;
    }
    // No custom-GC handle captured (pre-napi4 build, or the reference was
    // created before module registration). Never call N-API from a foreign
    // thread; leaking here is safe because env teardown reclaims the reference.
    if self.owner_thread != std::thread::current().id() {
      return;
    }
    release_error_reference(self.env, self.raw);
  }
}

impl<S: AsRef<str>> Error<S> {
  pub fn set_cause(&mut self, cause: Error) {
    self.cause = Some(Box::new(cause));
  }
}

impl Error {
  /// Retains an arbitrary JavaScript value as the exact value produced when this
  /// error is converted back to JavaScript.
  ///
  /// Unlike [`From<Unknown>`], this never coerces the value. Non-Error values are
  /// not inspected at all. For actual JavaScript Error values, it copies a
  /// string-valued `message` as an owned cross-env fallback; a hostile accessor
  /// is ignored and its exception is cleared. This is useful for APIs such as
  /// `Promise` and async-generator rejection paths, where JavaScript permits any
  /// value and requires its identity to be preserved in the originating env.
  pub fn from_unknown_without_coercion(value: Unknown<'_>) -> Self {
    Self::try_from_unknown_without_coercion_inner(value, false)
      .unwrap_or_else(ErrorCaptureFailure::into_error)
  }

  pub(crate) fn capture_unknown_with_status_and_diagnostics(
    value: Unknown<'_>,
    status: Status,
  ) -> ErrorCaptureResult {
    match Self::try_from_unknown_without_coercion_inner(value, true) {
      Ok(mut error) => {
        error.status = status;
        ErrorCaptureResult::Captured(error)
      }
      Err(failure) => match failure.environment_unavailable {
        Some(status) => ErrorCaptureResult::EnvironmentUnavailable(status),
        None => ErrorCaptureResult::Failed(failure.into_transport_error()),
      },
    }
  }

  fn try_from_unknown_without_coercion_inner(
    value: Unknown<'_>,
    include_diagnostics: bool,
  ) -> std::result::Result<Self, ErrorCaptureFailure> {
    let env = value.0.env;
    let mut holder = ptr::null_mut();
    let status = unsafe { sys::napi_create_object(env, &mut holder) };
    if status != sys::Status::napi_ok {
      return Err(ErrorCaptureFailure::from_napi_failure(
        env,
        status,
        "Create Error value holder failed",
      ));
    }
    let properties = [sys::napi_property_descriptor {
      utf8name: ERROR_VALUE_KEY.as_ptr().cast(),
      name: ptr::null_mut(),
      method: None,
      getter: None,
      setter: None,
      value: value.0.value,
      attributes: sys::PropertyAttributes::default,
      data: ptr::null_mut(),
    }];
    let status =
      unsafe { sys::napi_define_properties(env, holder, properties.len(), properties.as_ptr()) };
    if status != sys::Status::napi_ok {
      return Err(ErrorCaptureFailure::from_napi_failure(
        env,
        status,
        "Store Error value in holder failed",
      ));
    }
    let mut reference = ptr::null_mut();
    let status = unsafe { sys::napi_create_reference(env, holder, 1, &mut reference) };
    if status != sys::Status::napi_ok {
      return Err(ErrorCaptureFailure::from_napi_failure(
        env,
        status,
        "Create Error value holder reference failed",
      ));
    }
    let maybe_ref = Some(ErrorRefHandle::new(ErrorRef::new_indirect(reference, env)));
    let (reason, cause) = if include_diagnostics {
      match owned_error_diagnostics_without_coercion(value) {
        Ok(diagnostics) => diagnostics,
        Err(status) => {
          // The environment cannot prove whether a pending exception remains.
          // Avoid any release call in that unknown state; env teardown owns the
          // leaked reference.
          std::mem::forget(maybe_ref);
          return Err(ErrorCaptureFailure::environment_unavailable(
            status,
            "Capture Error diagnostics failed",
          ));
        }
      }
    } else {
      match owned_error_message_without_coercion(value) {
        Ok(reason) => (reason, None),
        Err(status) => {
          std::mem::forget(maybe_ref);
          return Err(ErrorCaptureFailure::environment_unavailable(
            status,
            "Capture Error message failed",
          ));
        }
      }
    };
    Ok(Self {
      status: Status::GenericFailure,
      reason,
      cause,
      maybe_ref,
    })
  }
}

fn recover_from_napi_failure(env: sys::napi_env) -> std::result::Result<(), sys::napi_status> {
  match take_pending_exception(env) {
    PendingExceptionState::None | PendingExceptionState::Cleared(_) => Ok(()),
    PendingExceptionState::Unavailable(status) => Err(status),
  }
}

fn owned_error_message_without_coercion(
  value: Unknown<'_>,
) -> std::result::Result<String, sys::napi_status> {
  if !is_error_without_coercion(value)? {
    return Ok(String::new());
  }

  Ok(
    owned_named_string_property_without_coercion(value, c"message")?
      .unwrap_or_else(|| "JavaScript Error".to_owned()),
  )
}

fn owned_error_diagnostics_without_coercion(
  value: Unknown<'_>,
) -> std::result::Result<(String, Option<Box<Error>>), sys::napi_status> {
  if !is_error_without_coercion(value)? {
    return Ok((String::new(), None));
  }

  let message = owned_named_string_property_without_coercion(value, c"message")?;
  let stack = owned_named_string_property_without_coercion(value, c"stack")?;
  let reason = stack
    .filter(|stack| !stack.is_empty())
    .or(message)
    .unwrap_or_else(|| "JavaScript Error".to_owned());
  let cause = owned_error_cause_without_coercion(value)?;
  Ok((reason, cause))
}

fn is_error_without_coercion(value: Unknown<'_>) -> std::result::Result<bool, sys::napi_status> {
  let env = value.0.env;
  let mut is_error = false;
  let status = unsafe { sys::napi_is_error(env, value.0.value, &mut is_error) };
  if status != sys::Status::napi_ok {
    recover_from_napi_failure(env)?;
    return Ok(false);
  }
  Ok(is_error)
}

fn owned_named_string_property_without_coercion(
  value: Unknown<'_>,
  key: &CStr,
) -> std::result::Result<Option<String>, sys::napi_status> {
  let env = value.0.env;
  let mut property = ptr::null_mut();
  let status =
    unsafe { sys::napi_get_named_property(env, value.0.value, key.as_ptr(), &mut property) };
  if status != sys::Status::napi_ok {
    recover_from_napi_failure(env)?;
    return Ok(None);
  }
  owned_string_without_coercion(env, property)
}

fn owned_string_without_coercion(
  env: sys::napi_env,
  value: sys::napi_value,
) -> std::result::Result<Option<String>, sys::napi_status> {
  let mut value_type = -1;
  let status = unsafe { sys::napi_typeof(env, value, &mut value_type) };
  if status != sys::Status::napi_ok {
    recover_from_napi_failure(env)?;
    return Ok(None);
  }
  if value_type != sys::ValueType::napi_string {
    return Ok(None);
  }

  let mut length = 0;
  let status =
    unsafe { sys::napi_get_value_string_utf8(env, value, ptr::null_mut(), 0, &mut length) };
  if status != sys::Status::napi_ok {
    recover_from_napi_failure(env)?;
    return Ok(None);
  }
  let mut bytes = vec![0; length + 1];
  let mut written = 0;
  let status = unsafe {
    sys::napi_get_value_string_utf8(
      env,
      value,
      bytes.as_mut_ptr().cast(),
      bytes.len(),
      &mut written,
    )
  };
  if status != sys::Status::napi_ok {
    recover_from_napi_failure(env)?;
    return Ok(None);
  }
  bytes.truncate(written);
  Ok(String::from_utf8(bytes).ok())
}

fn owned_error_cause_without_coercion(
  value: Unknown<'_>,
) -> std::result::Result<Option<Box<Error>>, sys::napi_status> {
  let env = value.0.env;
  let mut raw_cause = ptr::null_mut();
  let status =
    unsafe { sys::napi_get_named_property(env, value.0.value, c"cause".as_ptr(), &mut raw_cause) };
  if status != sys::Status::napi_ok {
    recover_from_napi_failure(env)?;
    return Ok(None);
  }

  let mut value_type = -1;
  let status = unsafe { sys::napi_typeof(env, raw_cause, &mut value_type) };
  if status != sys::Status::napi_ok {
    recover_from_napi_failure(env)?;
    return Ok(None);
  }
  if value_type == sys::ValueType::napi_undefined || value_type == sys::ValueType::napi_null {
    return Ok(None);
  }

  match Error::try_from_unknown_without_coercion_inner(
    unsafe { Unknown::from_raw_unchecked(env, raw_cause) },
    false,
  ) {
    Ok(error) => Ok(Some(Box::new(error))),
    Err(failure) => match failure.environment_unavailable {
      Some(status) => Err(status),
      None => Ok(None),
    },
  }
}

impl<S: AsRef<str>> std::fmt::Debug for Error<S> {
  fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
    write!(
      f,
      "Error {{ status: {:?}, reason: {:?} }}",
      self.status.as_ref(),
      self.reason
    )
  }
}

impl<S: AsRef<str>> ToNapiValue for Error<S> {
  unsafe fn to_napi_value(env: sys::napi_env, val: Self) -> Result<sys::napi_value> {
    if let Some(value) = unsafe { val.referenced_value(env) } {
      // Reuse the original JS value. For errors this keeps the subclass, stack,
      // and own properties; arbitrary rejection values preserve exact identity.
      // The shared `napi_ref` is released when `val`'s handle drops.
      Ok(value)
    } else {
      // No JS reference, or converting off the owning thread: rebuild a fresh
      // error from `status`/`reason`/`cause`.
      Ok(unsafe { JsError::from(val).into_value(env) })
    }
  }
}

#[cfg(feature = "napi4")]
unsafe impl<S> Send for Error<S> where S: Send + AsRef<str> {}
#[cfg(feature = "napi4")]
unsafe impl<S> Sync for Error<S> where S: Sync + AsRef<str> {}

impl<S: AsRef<str> + std::fmt::Debug> error::Error for Error<S> {}

impl<S: AsRef<str>> From<std::convert::Infallible> for Error<S> {
  fn from(_: std::convert::Infallible) -> Self {
    unreachable!()
  }
}

#[cfg(feature = "serde-json")]
impl ser::Error for Error {
  fn custom<T: Display>(msg: T) -> Self {
    Error::new(Status::InvalidArg, msg.to_string())
  }
}

#[cfg(feature = "serde-json")]
impl de::Error for Error {
  fn custom<T: Display>(msg: T) -> Self {
    Error::new(Status::InvalidArg, msg.to_string())
  }
}

#[cfg(feature = "serde-json")]
impl From<SerdeJSONError> for Error {
  fn from(value: SerdeJSONError) -> Self {
    Error::new(Status::InvalidArg, format!("{value}"))
  }
}

#[cfg(not(target_family = "wasm"))]
impl From<Unknown<'_>> for Error {
  fn from(value: Unknown) -> Self {
    let mut result = std::ptr::null_mut();
    let status = unsafe { sys::napi_create_reference(value.0.env, value.0.value, 1, &mut result) };
    if status != sys::Status::napi_ok {
      return Error::new(
        Status::from(status),
        "Create Error reference failed".to_owned(),
      );
    }
    let maybe_env = value.0.env;
    let maybe_error_message = value
      .coerce_to_string()
      .and_then(|a| a.into_utf8().and_then(|a| a.into_owned()));
    let maybe_cause = extract_error_cause(value).unwrap_or(None);

    if let Ok(error_message) = maybe_error_message {
      return Self {
        status: Status::GenericFailure,
        reason: error_message,
        cause: maybe_cause,
        maybe_ref: Some(ErrorRefHandle::new(ErrorRef::new(result, maybe_env))),
      };
    }

    Self {
      status: Status::GenericFailure,
      reason: "".to_string(),
      cause: maybe_cause,
      maybe_ref: Some(ErrorRefHandle::new(ErrorRef::new(result, maybe_env))),
    }
  }
}

#[cfg(target_family = "wasm")]
impl From<Unknown<'_>> for Error {
  fn from(value: Unknown) -> Self {
    let value_type = value.get_type();

    let maybe_error_message;

    if let Ok(vt) = value_type {
      if vt == ValueType::Object {
        maybe_error_message = value
          .coerce_to_object()
          .and_then(|obj| obj.get_named_property::<Unknown>("message"))
          .and_then(|message| {
            message
              .coerce_to_string()
              .and_then(|message| message.into_utf8().and_then(|message| message.into_owned()))
          });
      } else {
        maybe_error_message = value
          .coerce_to_string()
          .and_then(|a| a.into_utf8().and_then(|a| a.into_owned()));
      }
    } else {
      maybe_error_message = value
        .coerce_to_string()
        .and_then(|a| a.into_utf8().and_then(|a| a.into_owned()));
    };

    let maybe_cause = extract_error_cause(value).unwrap_or(None);

    if let Ok(error_message) = maybe_error_message {
      return Self {
        status: Status::GenericFailure,
        reason: error_message,
        cause: maybe_cause,
        maybe_ref: None,
      };
    }

    Self {
      status: Status::GenericFailure,
      reason: "".to_string(),
      cause: maybe_cause,
      maybe_ref: None,
    }
  }
}

#[cfg(feature = "anyhow")]
impl From<anyhow::Error> for Error {
  fn from(value: anyhow::Error) -> Self {
    Error::new(Status::GenericFailure, format!("{:?}", value))
  }
}

impl<S: AsRef<str> + std::fmt::Debug> fmt::Display for Error<S> {
  fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
    if !self.reason.is_empty() {
      write!(f, "{:?}, {}", self.status, self.reason)
    } else {
      write!(f, "{:?}", self.status)
    }
  }
}

impl<S: AsRef<str>> Error<S> {
  pub fn new<R: ToString>(status: S, reason: R) -> Self {
    Error {
      status,
      reason: reason.to_string(),
      cause: None,
      maybe_ref: None,
    }
  }

  pub fn from_status(status: S) -> Self {
    Error {
      status,
      reason: "".to_owned(),
      cause: None,
      maybe_ref: None,
    }
  }

  pub(crate) fn forget_reference_handles(&mut self) {
    if let Some(error_ref) = self.maybe_ref.take() {
      std::mem::forget(error_ref);
    }
    if let Some(cause) = self.cause.as_mut() {
      cause.forget_reference_handles();
    }
  }

  unsafe fn checked_referenced_value(&mut self, env: sys::napi_env) -> CheckedReferencedValue {
    let Some(error_ref) = self.maybe_ref.as_ref() else {
      return CheckedReferencedValue::Missing;
    };
    if error_ref.env != env || error_ref.owner_thread != std::thread::current().id() {
      return CheckedReferencedValue::Missing;
    }
    #[cfg(all(feature = "napi4", not(feature = "noop")))]
    if let Some(handle) = &error_ref.custom_gc {
      if !handle.can_access_from_current_thread(env) {
        return CheckedReferencedValue::Missing;
      }
    }

    let indirect = error_ref.indirect;
    let reference = error_ref.raw;
    let mut result = ptr::null_mut();
    let status = unsafe { sys::napi_get_reference_value(env, reference, &mut result) };
    if status != sys::Status::napi_ok {
      return self.checked_reference_failure(env, status);
    }
    if indirect {
      let status = unsafe {
        sys::napi_get_named_property(env, result, ERROR_VALUE_KEY.as_ptr().cast(), &mut result)
      };
      if status != sys::Status::napi_ok {
        return self.checked_reference_failure(env, status);
      }
    }
    CheckedReferencedValue::Value(result)
  }

  fn checked_reference_failure(
    &mut self,
    env: sys::napi_env,
    status: sys::napi_status,
  ) -> CheckedReferencedValue {
    match take_pending_exception(env) {
      PendingExceptionState::None => CheckedReferencedValue::Failed(status),
      PendingExceptionState::Cleared(exception) => CheckedReferencedValue::Exception(exception),
      PendingExceptionState::Unavailable(_) => {
        self.forget_reference_handles();
        CheckedReferencedValue::EnvironmentUnavailable
      }
    }
  }

  pub(crate) unsafe fn into_checked_js_error_value(
    mut self,
    env: sys::napi_env,
  ) -> CheckedErrorValue {
    match unsafe { self.checked_referenced_value(env) } {
      CheckedReferencedValue::Value(value) => {
        let mut is_error = false;
        let status = unsafe { sys::napi_is_error(env, value, &mut is_error) };
        if status == sys::Status::napi_ok {
          if is_error {
            return CheckedErrorValue::Value(value);
          }
        } else {
          return self.checked_napi_failure(env, status);
        }
      }
      CheckedReferencedValue::Missing => {}
      CheckedReferencedValue::Exception(exception) => {
        return CheckedErrorValue::Exception(exception);
      }
      CheckedReferencedValue::Failed(status) => {
        return CheckedErrorValue::Failed(status);
      }
      CheckedReferencedValue::EnvironmentUnavailable => {
        return CheckedErrorValue::EnvironmentUnavailable;
      }
    }
    unsafe { self.build_checked_js_error_value(env) }
  }

  unsafe fn into_checked_napi_value(mut self, env: sys::napi_env) -> CheckedErrorValue {
    match unsafe { self.checked_referenced_value(env) } {
      CheckedReferencedValue::Value(value) => CheckedErrorValue::Value(value),
      CheckedReferencedValue::Missing => unsafe { self.build_checked_js_error_value(env) },
      CheckedReferencedValue::Exception(exception) => CheckedErrorValue::Exception(exception),
      CheckedReferencedValue::Failed(status) => CheckedErrorValue::Failed(status),
      CheckedReferencedValue::EnvironmentUnavailable => CheckedErrorValue::EnvironmentUnavailable,
    }
  }

  unsafe fn build_checked_js_error_value(&mut self, env: sys::napi_env) -> CheckedErrorValue {
    let mut error_code = ptr::null_mut();
    let status = unsafe {
      sys::napi_create_string_utf8(
        env,
        self.status.as_ref().as_ptr().cast(),
        self.status.as_ref().len() as isize,
        &mut error_code,
      )
    };
    if status != sys::Status::napi_ok {
      return self.checked_napi_failure(env, status);
    }

    let mut reason = ptr::null_mut();
    let status = unsafe {
      sys::napi_create_string_utf8(
        env,
        self.reason.as_ptr().cast(),
        self.reason.len() as isize,
        &mut reason,
      )
    };
    if status != sys::Status::napi_ok {
      return self.checked_napi_failure(env, status);
    }

    let mut error_value = ptr::null_mut();
    let status = unsafe { sys::napi_create_error(env, error_code, reason, &mut error_value) };
    if status != sys::Status::napi_ok {
      return self.checked_napi_failure(env, status);
    }

    if let Some(cause) = self.cause.take() {
      let cause = match unsafe { cause.into_checked_napi_value(env) } {
        CheckedErrorValue::Value(cause) => cause,
        CheckedErrorValue::EnvironmentUnavailable => {
          self.forget_reference_handles();
          return CheckedErrorValue::EnvironmentUnavailable;
        }
        result => return result,
      };
      let status =
        unsafe { sys::napi_set_named_property(env, error_value, c"cause".as_ptr(), cause) };
      if status != sys::Status::napi_ok {
        return self.checked_napi_failure(env, status);
      }
    }
    CheckedErrorValue::Value(error_value)
  }

  fn checked_napi_failure(
    &mut self,
    env: sys::napi_env,
    status: sys::napi_status,
  ) -> CheckedErrorValue {
    match take_pending_exception(env) {
      PendingExceptionState::None => CheckedErrorValue::Failed(status),
      PendingExceptionState::Cleared(exception) => CheckedErrorValue::Exception(exception),
      PendingExceptionState::Unavailable(_) => {
        self.forget_reference_handles();
        CheckedErrorValue::EnvironmentUnavailable
      }
    }
  }
}

impl<S: AsRef<str> + Clone> Error<S> {
  /// Builds a copy carrying only the thread-safe data: `status`, `reason`, and a
  /// recursively reference-less `cause` chain. It owns no [`ErrorRef`] (`maybe_ref`
  /// is `None`), so it is safe to create and drop on any thread because it reads
  /// only owned Rust data and never touches a thread-affine reference.
  /// `try_clone` uses it whenever it cannot share the original's `napi_ref`: with
  /// no custom-GC handle to route an off-thread release, or when the error holds
  /// no reference at all (for example, a Rust-constructed error). Cloning it
  /// preserves the cause chain so a later reference-less conversion
  /// (`into_value` with `maybe_ref == None`) can re-attach `.cause`.
  fn reference_less_clone(&self) -> Self {
    Self {
      status: self.status.clone(),
      reason: self.reason.clone(),
      cause: self
        .cause
        .as_ref()
        .map(|cause| Box::new(cause.reference_less_clone())),
      maybe_ref: None,
    }
  }

  /// Clones this `Error`.
  ///
  /// An `Error` derived from a JS exception or rejection may own a `napi_ref`
  /// to the original JS value, kept behind a shared `ErrorRef`. The
  /// clone shares that reference under N-API 4 by cloning the `Arc` — an atomic
  /// bump with no napi FFI — so both map back to the same JS object and the clone
  /// can be sent to another thread; the single `napi_ref` is released exactly
  /// once, when the last clone drops. When the clone is later converted back to
  /// a JS value *on the owning JS thread*, it reuses the original object
  /// (preserving its subclass, stack, and own properties); converted on any
  /// other thread it degrades to a fresh `Error` rebuilt from `status`/`reason`/
  /// `cause`. Sharing needs the owning env's custom-GC handle (the only safe
  /// off-thread release path); without one — a pre-`napi4` build, or a reference
  /// created before module registration — and for errors that hold no reference,
  /// `try_clone` returns a reference-less copy that still carries the `status`,
  /// `reason`, and `cause` chain.
  pub fn try_clone(&self) -> Result<Self> {
    match &self.maybe_ref {
      // Share the JS reference with the clone. Cloning the `Arc` is an atomic
      // refcount bump with no napi FFI, so it is safe from any thread; the
      // single `napi_ref` stays at count 1 and is released once, by the last
      // `Arc`. The shared object carries its own `.cause`, so `into_value`
      // ignores the Rust `cause` field when it reuses the object on the owning
      // thread — but we still keep a reference-less cause backup so a clone
      // converted off the owning thread (rebuilt from `reason`) keeps the chain.
      #[cfg(all(feature = "napi4", not(feature = "noop")))]
      Some(error_ref) if error_ref.custom_gc.is_some() => Ok(Self {
        status: self.status.clone(),
        reason: self.reason.clone(),
        cause: self
          .cause
          .as_ref()
          .map(|cause| Box::new(cause.reference_less_clone())),
        maybe_ref: Some(error_ref.clone()),
      }),
      // No custom-GC handle (pre-`napi4` build, or a reference created before
      // module registration, which has no safe off-thread release path), or no
      // JS reference at all: rebuild from the owned fields, preserving the
      // cause chain instead of dropping it.
      _ => Ok(self.reference_less_clone()),
    }
  }
}

impl<S: AsRef<str>> Error<S> {
  /// Reads the referenced JS value, but only when it is safe to touch on
  /// the current thread. The `napi_ref` is thread-affine, so with a napi4
  /// custom-GC handle we read it only with proof we are on the owning JS thread;
  /// off the owning thread (a shared clone being converted on a foreign env) it
  /// returns `None`, so the caller rebuilds a fresh error from `reason` instead
  /// of dereferencing a foreign env's reference. The captured owner thread also
  /// gates references without custom-GC machinery (non-`napi4`, or a reference
  /// created before module registration).
  ///
  /// # Safety
  ///
  /// `env` must be a valid `napi_env` for the current thread.
  pub(crate) unsafe fn referenced_value(&self, env: sys::napi_env) -> Option<sys::napi_value> {
    let error_ref = self.maybe_ref.as_ref()?;
    if error_ref.env != env {
      return None;
    }
    if error_ref.owner_thread != std::thread::current().id() {
      return None;
    }
    #[cfg(all(feature = "napi4", not(feature = "noop")))]
    if let Some(handle) = &error_ref.custom_gc {
      if !handle.can_access_from_current_thread(env) {
        return None;
      }
    }
    let mut result = ptr::null_mut();
    let status = unsafe { sys::napi_get_reference_value(env, error_ref.raw, &mut result) };
    if status != sys::Status::napi_ok {
      return None;
    }
    if error_ref.indirect {
      let status = unsafe {
        sys::napi_get_named_property(env, result, ERROR_VALUE_KEY.as_ptr().cast(), &mut result)
      };
      if status != sys::Status::napi_ok {
        return None;
      }
    }
    Some(result)
  }
}

/// Outlined helper for `#[napi(object)]` deserialization: decorate a field-getter
/// error with its `Struct.field` location.
///
/// The `#[napi]` derive used to inline this `format!` into every generated
/// `FromNapiValue` impl, once per field — hundreds of identical copies in a large
/// addon. Keeping it non-generic and out-of-line collapses all of them to a single
/// shared function on the (cold) error path. The produced message is byte-for-byte
/// identical to the previous inline version.
#[cold]
#[inline(never)]
#[doc(hidden)]
pub fn decorate_field_error(mut err: Error, struct_name: &str, field: &str) -> Error {
  err.reason = format!("{} on {}.{}", err.reason, struct_name, field);
  err
}

/// Outlined helper for `#[napi(object)]` deserialization: build the error returned
/// when a required field is missing. Non-generic and out-of-line for the same
/// code-size reason as [`decorate_field_error`]; the message is unchanged.
#[cold]
#[inline(never)]
#[doc(hidden)]
pub fn missing_field_error(field: &str) -> Error {
  Error::new(Status::InvalidArg, format!("Missing field `{}`", field))
}

impl Error {
  pub fn from_reason<T: Into<String>>(reason: T) -> Self {
    Error {
      status: Status::GenericFailure,
      reason: reason.into(),
      cause: None,
      maybe_ref: None,
    }
  }
}

impl From<std::ffi::NulError> for Error {
  fn from(error: std::ffi::NulError) -> Self {
    Error {
      status: Status::GenericFailure,
      reason: format!("{error}"),
      cause: None,
      maybe_ref: None,
    }
  }
}

impl From<std::io::Error> for Error {
  fn from(error: std::io::Error) -> Self {
    Error {
      status: Status::GenericFailure,
      reason: format!("{error}"),
      cause: None,
      maybe_ref: None,
    }
  }
}

#[derive(Clone, Debug)]
pub struct ExtendedErrorInfo {
  pub message: String,
  pub engine_reserved: *mut c_void,
  pub engine_error_code: u32,
  pub error_code: Status,
}

impl TryFrom<sys::napi_extended_error_info> for ExtendedErrorInfo {
  type Error = Error;

  fn try_from(value: sys::napi_extended_error_info) -> Result<Self> {
    Ok(Self {
      message: if value.error_message.is_null() {
        String::new()
      } else {
        unsafe {
          CStr::from_ptr(value.error_message.cast())
            .to_str()
            .map_err(|e| Error::new(Status::GenericFailure, format!("{e}")))?
            .to_owned()
        }
      },
      engine_error_code: value.engine_error_code,
      engine_reserved: value.engine_reserved,
      error_code: Status::from(value.error_code),
    })
  }
}

pub struct JsError<S: AsRef<str> = Status>(Error<S>);

#[cfg(feature = "anyhow")]
impl From<anyhow::Error> for JsError {
  fn from(value: anyhow::Error) -> Self {
    JsError(Error::new(Status::GenericFailure, value.to_string()))
  }
}

pub struct JsTypeError<S: AsRef<str> = Status>(Error<S>);

pub struct JsRangeError<S: AsRef<str> = Status>(Error<S>);

#[cfg(feature = "napi9")]
pub struct JsSyntaxError<S: AsRef<str> = Status>(Error<S>);

macro_rules! impl_object_methods {
  ($js_value:ident, $kind:expr) => {
    impl<S: AsRef<str>> $js_value<S> {
      /// # Safety
      ///
      /// This function is safety if env is not null ptr.
      pub unsafe fn into_value(mut self, env: sys::napi_env) -> sys::napi_value {
        // Reuse the original JS error object when it is safe to read on this
        // thread (owning JS thread). The shared `napi_ref` is released when
        // `self`'s `Arc` drops at the end of this function — never here.
        if let Some(err) = unsafe { self.0.referenced_value(env) } {
          let mut is_error = false;
          let is_error_status = unsafe { sys::napi_is_error(env, err, &mut is_error) };
          debug_assert!(
            is_error_status == sys::Status::napi_ok,
            "Check Error failed"
          );
          // make sure ref_value is a valid error at first and avoid throw error failed.
          if is_error {
            return err;
          }
        }

        let error_status = self.0.status.as_ref();
        let status_len = error_status.len();
        let reason_len = self.0.reason.len();
        let mut error_code = ptr::null_mut();
        let mut reason_string = ptr::null_mut();
        let mut js_error = ptr::null_mut();
        let create_code_status = unsafe {
          sys::napi_create_string_utf8(
            env,
            error_status.as_ptr().cast(),
            status_len as isize,
            &mut error_code,
          )
        };
        debug_assert!(create_code_status == sys::Status::napi_ok);
        let create_reason_status = unsafe {
          sys::napi_create_string_utf8(
            env,
            self.0.reason.as_ptr().cast(),
            reason_len as isize,
            &mut reason_string,
          )
        };
        debug_assert!(create_reason_status == sys::Status::napi_ok);
        let create_error_status = unsafe { $kind(env, error_code, reason_string, &mut js_error) };
        debug_assert!(create_error_status == sys::Status::napi_ok);
        if let Some(cause_error) = self.0.cause.take() {
          let cause = ToNapiValue::to_napi_value(env, *cause_error)
            .expect("Convert cause Error to napi_value should never error");
          let set_cause_status =
            unsafe { sys::napi_set_named_property(env, js_error, c"cause".as_ptr().cast(), cause) };
          debug_assert!(
            set_cause_status == sys::Status::napi_ok,
            "Set cause property failed"
          );
        }
        js_error
      }

      pub fn into_unknown<'env>(self, env: Env) -> Unknown<'env> {
        let value = unsafe { self.into_value(env.raw()) };
        unsafe { Unknown::from_raw_unchecked(env.raw(), value) }
      }

      /// # Safety
      ///
      /// This function is safety if env is not null ptr.
      pub unsafe fn throw_into(self, env: sys::napi_env) {
        #[cfg(debug_assertions)]
        let reason = self.0.reason.clone();
        let status = self.0.status.as_ref().to_string();
        // Detect whether the env actually has a pending exception before
        // deciding how to surface this error.
        let mut is_pending_exception = false;
        assert_eq!(
          unsafe { $crate::sys::napi_is_exception_pending(env, &mut is_pending_exception) },
          $crate::sys::Status::napi_ok,
          "Check exception status failed"
        );
        // Skip re-throwing only when the exception is genuinely pending. An
        // error tagged `PendingException` can be a detached (reference-less)
        // clone — e.g. one produced by `try_clone` off the owning JS thread —
        // whose original JS exception was already cleared, so nothing is
        // pending. Such an error must still be surfaced from `reason` instead of
        // being silently dropped.
        if is_pending_exception && status == Status::PendingException.as_ref() {
          return;
        }
        let js_error = match is_pending_exception {
          true => {
            let mut error_result = std::ptr::null_mut();
            assert_eq!(
              unsafe { $crate::sys::napi_get_and_clear_last_exception(env, &mut error_result) },
              $crate::sys::Status::napi_ok,
              "Get and clear last exception failed"
            );
            error_result
          }
          false => unsafe { self.into_value(env) },
        };
        let _throw_status = unsafe { sys::napi_throw(env, js_error) };
        #[cfg(debug_assertions)]
        assert!(
          _throw_status == sys::Status::napi_ok,
          "Throw error failed, status: [{}], raw message: \"{}\", raw status: [{}]",
          Status::from(_throw_status),
          reason,
          status
        );
      }
    }

    impl<S: AsRef<str>> From<Error<S>> for $js_value<S> {
      fn from(err: Error<S>) -> Self {
        Self(err)
      }
    }

    impl crate::bindgen_prelude::ToNapiValue for $js_value {
      unsafe fn to_napi_value(env: sys::napi_env, val: Self) -> Result<sys::napi_value> {
        unsafe { ToNapiValue::to_napi_value(env, val.0) }
      }
    }
  };
}

impl_object_methods!(JsError, sys::napi_create_error);
impl_object_methods!(JsTypeError, sys::napi_create_type_error);
impl_object_methods!(JsRangeError, sys::napi_create_range_error);
#[cfg(feature = "napi9")]
impl_object_methods!(JsSyntaxError, sys::node_api_create_syntax_error);

#[doc(hidden)]
#[macro_export]
macro_rules! error {
  ($status:expr, $($msg:tt)*) => {
    $crate::Error::new($status, format!($($msg)*))
  };
}

#[doc(hidden)]
#[macro_export]
macro_rules! check_status {
  ($code:expr) => {{
    let c = $code;
    match c {
      $crate::sys::Status::napi_ok => Ok(()),
      _ => Err($crate::Error::new($crate::Status::from(c), "".to_owned())),
    }
  }};

  ($code:expr, $($msg:tt)*) => {{
    let c = $code;
    match c {
      $crate::sys::Status::napi_ok => Ok(()),
      _ => Err($crate::Error::new($crate::Status::from(c), format!($($msg)*))),
    }
  }};

  ($code:expr, $msg:expr, $env:expr, $val:expr) => {{
    let c = $code;
    match c {
      $crate::sys::Status::napi_ok => Ok(()),
      _ => Err($crate::Error::new($crate::Status::from(c), format!($msg, $crate::type_of!($env, $val)?))),
    }
  }};
}

#[doc(hidden)]
#[macro_export]
macro_rules! check_status_and_type {
  ($code:expr, $env:ident, $val:ident, $msg:expr) => {{
    let c = $code;
    match c {
      $crate::sys::Status::napi_ok => Ok(()),
      _ => {
        use $crate::js_values::JsValue;
        let value_type = $crate::type_of!($env, $val)?;
        let error_msg = match value_type {
          ValueType::Function => {
            let function_name = unsafe {
              $crate::bindgen_prelude::Function::<
                $crate::bindgen_prelude::Unknown,
                $crate::bindgen_prelude::Unknown,
              >::from_napi_value($env, $val)?
              .name()?
            };
            format!(
              $msg,
              format!(
                "function {}(..) ",
                if function_name.len() == 0 {
                  "anonymous".to_owned()
                } else {
                  function_name
                }
              )
            )
          }
          ValueType::Object => {
            let env_ = $crate::Env::from($env);
            let json: $crate::JSON = env_.get_global()?.get_named_property_unchecked("JSON")?;
            let object = json.stringify($crate::bindgen_prelude::Object::from_raw($env, $val))?;
            format!($msg, format!("Object {}", object))
          }
          ValueType::Boolean | ValueType::Number => {
            let val = $crate::Unknown::from_raw_unchecked($env, $val);
            let value = val.coerce_to_string()?.into_utf8()?;
            format!($msg, format!("{} {} ", value_type, value.as_str()?))
          }
          #[cfg(feature = "napi6")]
          ValueType::BigInt => {
            let val = $crate::Unknown::from_raw_unchecked($env, $val);
            let value = val.coerce_to_string()?.into_utf8()?;
            format!($msg, format!("{} {} ", value_type, value.as_str()?))
          }
          _ => format!($msg, value_type),
        };
        Err($crate::Error::new($crate::Status::from(c), error_msg))
      }
    }
  }};
}

#[doc(hidden)]
#[macro_export]
macro_rules! check_pending_exception {
  ($env:expr, $code:expr) => {{
    let c = $code;
    match c {
      $crate::sys::Status::napi_ok => Ok(()),
      $crate::sys::Status::napi_pending_exception => {
        let mut error_result = std::ptr::null_mut();
        assert_eq!(
          unsafe { $crate::sys::napi_get_and_clear_last_exception($env, &mut error_result) },
          $crate::sys::Status::napi_ok
        );
        return Err($crate::Error::from(unsafe {
          $crate::bindgen_prelude::Unknown::from_raw_unchecked($env, error_result)
        }));
      }
      _ => Err($crate::Error::new($crate::Status::from(c), "".to_owned())),
    }
  }};

  ($env:expr, $code:expr, $($msg:tt)*) => {{
    let c = $code;
    match c {
      $crate::sys::Status::napi_ok => Ok(()),
      $crate::sys::Status::napi_pending_exception => {
        let mut error_result = std::ptr::null_mut();
        assert_eq!(
          unsafe { $crate::sys::napi_get_and_clear_last_exception($env, &mut error_result) },
          $crate::sys::Status::napi_ok
        );
        return Err($crate::Error::from(unsafe {
          $crate::bindgen_prelude::Unknown::from_raw_unchecked($env, error_result)
        }));
      }
      _ => Err($crate::Error::new($crate::Status::from(c), format!($($msg)*))),
    }
  }};
}

pub(crate) fn extract_error_cause(value: Unknown<'_>) -> Result<Option<Box<Error>>> {
  if value.get_type()? != ValueType::Object {
    return Ok(None);
  }

  let env = value.0.env;
  let key = c"cause";
  let mut raw_cause = ptr::null_mut();
  check_pending_exception!(
    env,
    unsafe { sys::napi_get_named_property(env, value.0.value, key.as_ptr(), &mut raw_cause) },
    "get_named_property error"
  )?;

  let cause = unsafe { Unknown::from_raw_unchecked(env, raw_cause) };
  match cause.get_type()? {
    ValueType::Undefined | ValueType::Null => Ok(None),
    _ => Ok(Some(Box::new(cause.into()))),
  }
}

#[cfg(test)]
mod tests {
  use std::{
    cell::Cell,
    ptr::{self, NonNull},
  };

  use super::{take_pending_exception_with, ErrorCaptureFailure, PendingExceptionState, Status};
  use crate::sys;

  #[test]
  fn pending_exception_probe_skips_clear_when_none_is_pending() {
    let clear_called = Cell::new(false);
    let state = take_pending_exception_with(
      || Ok(false),
      || {
        clear_called.set(true);
        Ok(ptr::null_mut())
      },
    );

    assert_eq!(state, PendingExceptionState::None);
    assert!(!clear_called.get());
  }

  #[test]
  fn pending_exception_probe_clears_hidden_exception_independent_of_call_status() {
    let exception: sys::napi_value = NonNull::<u8>::dangling().as_ptr().cast();
    let state = take_pending_exception_with(|| Ok(true), || Ok(exception));

    assert_eq!(state, PendingExceptionState::Cleared(exception));
  }

  #[test]
  fn pending_exception_probe_stops_when_state_check_fails() {
    let clear_called = Cell::new(false);
    let state = take_pending_exception_with(
      || Err(sys::Status::napi_closing),
      || {
        clear_called.set(true);
        Ok(ptr::null_mut())
      },
    );

    assert_eq!(
      state,
      PendingExceptionState::Unavailable(sys::Status::napi_closing)
    );
    assert!(!clear_called.get());
  }

  #[test]
  fn pending_exception_probe_rejects_failed_or_null_clear_results() {
    assert_eq!(
      take_pending_exception_with(|| Ok(true), || Err(sys::Status::napi_generic_failure)),
      PendingExceptionState::Unavailable(sys::Status::napi_generic_failure)
    );
    assert_eq!(
      take_pending_exception_with(|| Ok(true), || Ok(ptr::null_mut())),
      PendingExceptionState::Unavailable(sys::Status::napi_generic_failure)
    );
  }

  #[test]
  fn capture_failure_is_not_mislabeled_as_the_original_pending_exception() {
    let error = ErrorCaptureFailure {
      status: sys::Status::napi_pending_exception,
      reason: "Create Error value holder failed",
      environment_unavailable: None,
    }
    .into_transport_error();

    assert_eq!(error.status, Status::GenericFailure);
    assert!(error.reason.contains("PendingException"));
  }
}
