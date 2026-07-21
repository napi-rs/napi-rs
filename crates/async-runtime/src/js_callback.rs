//! Generic JavaScript-callback alias used by the host protocol exports.

use std::{ptr, sync::Arc};

use napi::{
  Either, Status, ValueType,
  bindgen_prelude::{FromNapiValue, TypeName, ValidateNapiValue},
  sys,
  threadsafe_function::ThreadsafeFunction,
};

/// Used as the fallback branch in `Either<Ret, InvalidReturnValue>` to catch
/// type mismatches from JS function options. Always passes NAPI validation so
/// that when `Ret` validation fails, the error is handled in Rust with a clear
/// message instead of becoming an uncatchable `napi_fatal_exception`.
pub struct InvalidReturnValue {
  pub value_type: ValueType,
}

impl TypeName for InvalidReturnValue {
  fn type_name() -> &'static str {
    "InvalidReturnValue"
  }

  fn value_type() -> ValueType {
    ValueType::Unknown
  }
}

impl ValidateNapiValue for InvalidReturnValue {
  unsafe fn validate(
    _env: sys::napi_env,
    _napi_val: sys::napi_value,
  ) -> napi::Result<sys::napi_value> {
    Ok(ptr::null_mut())
  }
}

impl FromNapiValue for InvalidReturnValue {
  unsafe fn from_napi_value(env: sys::napi_env, napi_val: sys::napi_value) -> napi::Result<Self> {
    let value_type = napi::type_of!(env, napi_val)?;
    Ok(InvalidReturnValue { value_type })
  }
}

/// `JsCallback` is a type alias for a weak, caller-handled
/// [`ThreadsafeFunction`] whose return value is validated in Rust: it
/// represents a JavaScript function passed to the Rust side.
///
/// - Rust: `JsCallback<FnArgs<(u32, f64)>, Promise<()>>`
/// - JS: `(id: number, ms: number) => Promise<void>`
///
/// The `Weak = true` parameter means the callback does not keep its owning
/// event loop alive, which is exactly what the host protocol needs: a worker
/// that registered a timer or task host may exit at any time, and the runtime
/// detects that through the threadsafe function's `aborted` flag instead of
/// pinning the worker.
pub type JsCallback<Args = (), Ret = ()> =
  Arc<ThreadsafeFunction<Args, Either<Ret, InvalidReturnValue>, Args, Status, false, true>>;
