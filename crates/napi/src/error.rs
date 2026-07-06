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
#[cfg(feature = "napi4")]
use crate::check_status;
use crate::ValueType;
use crate::{bindgen_runtime::ToNapiValue, sys, Env, JsValue, Status, Unknown};

pub type Result<T, S = Status> = std::result::Result<T, Error<S>>;

/// Represent `JsError`.
/// Return this Error in `js_function`, **napi-rs** will throw it as `JsError` for you.
/// If you want throw it as `TypeError` or `RangeError`, you can use `JsTypeError/JsRangeError::from(Error).throw_into(env)`
pub struct Error<S: AsRef<str> = Status> {
  pub status: S,
  pub reason: String,
  pub cause: Option<Box<Error>>,
  // A JS-exception-derived `Error` (`From<Unknown>`, or a ThreadsafeFunction
  // JS-throw) owns a `napi_ref` to the original JS error object, kept behind a
  // shared, reference-counted [`ErrorRef`]. `try_clone` clones this `Arc` — an
  // atomic bump with no napi FFI — so siblings can be sent across threads while
  // the single underlying `napi_ref` is released exactly once, by the last
  // `Arc`, on (or routed to) the owning JS thread. `None` for errors that hold
  // no JS reference (Rust-constructed, or a WASM error built from a JS value).
  pub(crate) maybe_ref: Option<std::sync::Arc<ErrorRef>>,
}

/// Shared owner of a JS error object's thread-affine `napi_ref`.
///
/// One `ErrorRef` backs an `Error` derived from a JS exception and every
/// `try_clone` of it. The `napi_ref` is created once at refcount 1 and is never
/// ref/unref'd for cloning — the number of live `Error` clones is tracked by the
/// `Arc<ErrorRef>` strong count instead (a pure atomic, safe from any thread).
/// The reference itself is released exactly once, when the last `Arc` drops,
/// from `ErrorRef::drop` (directly on the owning JS thread, or routed there via
/// the env's custom-GC TSFN when the last drop happens elsewhere).
pub(crate) struct ErrorRef {
  raw: sys::napi_ref,
  #[cfg_attr(feature = "noop", allow(dead_code))]
  env: sys::napi_env,
  // The owning env's custom-GC handle, captured on the owning JS thread when
  // `raw` is created. Lets the release run safely from any thread: the
  // `napi_ref` is thread-affine, so `napi_reference_unref`/`napi_delete_reference`
  // must run on the owning JS thread (releasing elsewhere mutates V8's
  // `GlobalHandles` concurrently with the JS thread and corrupts it).
  #[cfg(all(feature = "napi4", not(feature = "noop")))]
  custom_gc: Option<std::sync::Arc<crate::bindgen_prelude::CustomGcHandle>>,
}

// SAFETY: the raw `napi_ref`/`napi_env` are only ever dereferenced via napi FFI
// on the owning JS thread — `Error::referenced_value` gates reads on
// `current_thread_owns_custom_gc`, and `ErrorRef::drop` releases on the owning
// thread directly or routes the release through the env's custom-GC TSFN. Moving
// or sharing an `ErrorRef` (and cloning its `Arc`) only copies/reads the pointer
// values; it never touches V8 off-thread. The captured `Arc<CustomGcHandle>` is
// itself `Send + Sync`. Mirrors the `unsafe impl Send/Sync for Error`.
unsafe impl Send for ErrorRef {}
unsafe impl Sync for ErrorRef {}

impl ErrorRef {
  /// Wraps a freshly created (`refcount == 1`) JS error `napi_ref`, capturing
  /// the current thread's custom-GC handle. Must be called on the owning JS
  /// thread with a non-null `raw` — both construction sites (`From<Unknown>` and
  /// the ThreadsafeFunction JS-throw path) only build an `ErrorRef` after
  /// `napi_create_reference` succeeds, so `ErrorRef::drop` can release without a
  /// null check.
  #[cfg(not(target_family = "wasm"))]
  pub(crate) fn new(raw: sys::napi_ref, env: sys::napi_env) -> Self {
    debug_assert!(!raw.is_null(), "ErrorRef must wrap a non-null napi_ref");
    Self {
      raw,
      env,
      #[cfg(all(feature = "napi4", not(feature = "noop")))]
      custom_gc: crate::bindgen_prelude::current_custom_gc_handle(),
    }
  }
}

/// Releases a JS error's `napi_ref` on the owning JS thread: unref to 0, then
/// delete. Called exactly once, from `ErrorRef::drop`.
#[cfg(not(feature = "noop"))]
fn release_error_reference(env: sys::napi_env, reference: sys::napi_ref) {
  let mut ref_count = 0;
  let status = unsafe { sys::napi_reference_unref(env, reference, &mut ref_count) };
  if status != sys::Status::napi_ok {
    eprintln!("unref error reference failed: {}", Status::from(status));
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
      let env = self.env;
      let raw = self.raw;
      // Read-lock held across the call so the custom-GC TSFN can't be
      // finalized mid-call (same protocol as ArrayBuffer/TypedArray drops).
      handle.with_read_aborted(|aborted| {
        if aborted {
          // The owning env is gone and V8 has already invalidated the
          // reference — releasing it now would be a use-after-free. Leaking
          // it is safe: the env teardown reclaimed the handle's storage.
          return;
        }
        if crate::bindgen_prelude::current_thread_owns_custom_gc(&handle) {
          release_error_reference(env, raw);
        } else {
          // The last `Arc` dropped off the owning JS thread. Route the release
          // through the env's custom-GC TSFN, exactly like Buffer/TypedArray
          // drops.
          let status =
            unsafe { sys::napi_call_threadsafe_function(handle.get_raw(), raw.cast(), 1) };
          assert!(
            status == sys::Status::napi_ok || status == sys::Status::napi_closing,
            "Call custom GC in ErrorRef::drop failed {}",
            Status::from(status)
          );
        }
      });
      return;
    }
    // No custom-GC handle captured (pre-napi4 build, or the reference was
    // created before module registration): previous behavior, which is only
    // correct on the owning JS thread.
    release_error_reference(self.env, self.raw);
  }
}

impl<S: AsRef<str>> Error<S> {
  pub fn set_cause(&mut self, cause: Error) {
    self.cause = Some(Box::new(cause));
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
      // Reuse the original JS error object (keeps its subclass, stack, and own
      // properties). The shared `napi_ref` is released when `val`'s `Arc` drops.
      Ok(value)
    } else {
      // No JS reference, or converting off the owning thread: rebuild a fresh
      // error from `status`/`reason`/`cause`.
      Ok(unsafe { JsError::from(val).into_value(env) })
    }
  }
}

unsafe impl<S> Send for Error<S> where S: Send + AsRef<str> {}
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
        maybe_ref: Some(std::sync::Arc::new(ErrorRef::new(result, maybe_env))),
      };
    }

    Self {
      status: Status::GenericFailure,
      reason: "".to_string(),
      cause: maybe_cause,
      maybe_ref: Some(std::sync::Arc::new(ErrorRef::new(result, maybe_env))),
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
}

impl<S: AsRef<str> + Clone> Error<S> {
  /// Builds a copy carrying only the thread-safe data: `status`, `reason`, and a
  /// recursively reference-less `cause` chain. It owns no [`ErrorRef`] (`maybe_ref`
  /// is `None`), so it is safe to create and drop on any thread because it reads
  /// only owned Rust data and never touches a thread-affine reference.
  /// `try_clone` uses it whenever it cannot share the original's `napi_ref`: with
  /// no custom-GC handle to route an off-thread release, or when the error holds
  /// no reference at all (a Rust-constructed error, or a WASM error built from a
  /// JS value). Cloning it preserves the cause chain so a later reference-less
  /// conversion (`into_value` with `maybe_ref == None`) can re-attach `.cause`.
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
  /// An `Error` derived from a JS exception (e.g. a `Promise` rejection) owns a
  /// `napi_ref` to the original JS value, kept behind a shared [`ErrorRef`]. The
  /// clone shares that reference by cloning the `Arc` — a thread-safe atomic
  /// bump with no napi FFI — so both map back to the same JS object and the
  /// clone can be sent to another thread; the single `napi_ref` is released
  /// exactly once, when the last clone drops. When the clone is later converted
  /// back to a JS value *on the owning JS thread*, it reuses the original object
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
      // JS reference at all (a Rust-constructed error, or a WASM error built
      // from a JS value): rebuild from the owned fields, preserving the cause
      // chain instead of dropping it.
      _ => Ok(self.reference_less_clone()),
    }
  }
}

impl<S: AsRef<str>> Error<S> {
  /// Reads the referenced JS error object, but only when it is safe to touch on
  /// the current thread. The `napi_ref` is thread-affine, so with a napi4
  /// custom-GC handle we read it only with proof we are on the owning JS thread;
  /// off the owning thread (a shared clone being converted on a foreign env) it
  /// returns `None`, so the caller rebuilds a fresh error from `reason` instead
  /// of dereferencing a foreign env's reference. When the build carries no
  /// custom-GC machinery (non-`napi4`, or a reference created before module
  /// registration) there is no primitive to check thread ownership, so the read
  /// is unconditional — the same contract as before this change: `try_clone`
  /// never *shares* such a reference across threads (it clones reference-lessly),
  /// so only a directly-moved owning `Error` could reach here off-thread, which
  /// was already unsound and is unchanged.
  ///
  /// # Safety
  ///
  /// `env` must be a valid `napi_env` for the current thread.
  pub(crate) unsafe fn referenced_value(&self, env: sys::napi_env) -> Option<sys::napi_value> {
    let error_ref = self.maybe_ref.as_ref()?;
    #[cfg(all(feature = "napi4", not(feature = "noop")))]
    if let Some(handle) = &error_ref.custom_gc {
      if !handle.with_read_aborted(|aborted| {
        !aborted && crate::bindgen_prelude::current_thread_owns_custom_gc(handle)
      }) {
        return None;
      }
    }
    let mut result = ptr::null_mut();
    let status = unsafe { sys::napi_get_reference_value(env, error_ref.raw, &mut result) };
    if status != sys::Status::napi_ok {
      return None;
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

#[cfg(feature = "napi4")]
pub(crate) fn get_error_message_and_stack_trace(
  env: sys::napi_env,
  err: sys::napi_value,
) -> Result<String> {
  use crate::bindgen_runtime::FromNapiValue;

  let mut error_string = ptr::null_mut();
  check_status!(
    unsafe { sys::napi_coerce_to_string(env, err, &mut error_string) },
    "Get error message failed"
  )?;
  let mut result = unsafe { String::from_napi_value(env, error_string) }?;

  let mut stack_trace = ptr::null_mut();
  check_status!(
    unsafe { sys::napi_get_named_property(env, err, c"stack".as_ptr().cast(), &mut stack_trace) },
    "Get stack trace failed"
  )?;
  let mut stack_type = -1;
  check_status!(
    unsafe { sys::napi_typeof(env, stack_trace, &mut stack_type) },
    "Get stack trace type failed"
  )?;
  if stack_type == sys::ValueType::napi_string {
    let stack_trace = unsafe { String::from_napi_value(env, stack_trace) }?;
    result.push('\n');
    result.push_str(&stack_trace);
  }

  Ok(result)
}

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
        #[cfg(debug_assertions)]
        let throw_status = unsafe { sys::napi_throw(env, js_error) };
        unsafe { sys::napi_throw(env, js_error) };
        #[cfg(debug_assertions)]
        assert!(
          throw_status == sys::Status::napi_ok,
          "Throw error failed, status: [{}], raw message: \"{}\", raw status: [{}]",
          Status::from(throw_status),
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
