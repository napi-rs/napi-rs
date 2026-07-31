//! Regression test for issue #3427.
//!
//! Every `#[napi]` class gets a generated `ValidateNapiValue::validate()`. It is used by
//! `Either<&T, ..>` discrimination and by strict argument checking, and it looks the class
//! constructor up in the registry to run an `instanceof` check. That lookup must use the
//! class's registered `js_name`, not the Rust struct ident -- constructors are only ever
//! registered under `js_name`. Before the fix, the lookup key was built from the Rust ident,
//! so for any class whose ident differs from its `js_name` the lookup missed and `validate()`
//! rejected a perfectly valid instance.
//!
//! The class below has a Rust ident (`RenamedForIssue3427Rust`) that differs from its JS name
//! (`RenamedForIssue3427`), so before the fix both functions rejected a real instance at the
//! boundary.

use napi::bindgen_prelude::*;

#[napi(js_name = "RenamedForIssue3427")]
pub struct RenamedForIssue3427Rust {
  value: u32,
}

#[napi]
impl RenamedForIssue3427Rust {
  #[napi(constructor)]
  pub fn new(value: u32) -> Self {
    RenamedForIssue3427Rust { value }
  }
}

/// `Either<&T, ..>` discrimination calls `T::validate()` to decide the branch and treats an
/// error as "not this branch". Before the fix, `validate()` errored on the wrong lookup key,
/// so the class branch was skipped and the call threw instead of matching a valid instance.
#[napi]
pub fn issue_3427_either(input: Either<&RenamedForIssue3427Rust, u32>) -> u32 {
  match input {
    Either::A(instance) => instance.value,
    Either::B(n) => n,
  }
}

/// A strict argument is validated via `ValidateNapiValue::validate()` before conversion, so a
/// strict `&T` parameter exercises the same constructor lookup directly. Before the fix this
/// threw for a valid instance.
#[napi(strict)]
pub fn issue_3427_strict(input: &RenamedForIssue3427Rust) -> u32 {
  input.value
}

/// `Option<&T>` under `#[napi(strict)]` is validated via `Option::validate` -> `T::validate`,
/// the same constructor lookup. `Some` must accept a valid instance, `None` maps from
/// `null`/`undefined`, and a non-instance is rejected. Before the fix, `Some` threw for a valid
/// instance. Returns the wrapped value for `Some`, or `-1` for `None`.
#[napi(strict)]
pub fn issue_3427_option(input: Option<&RenamedForIssue3427Rust>) -> i32 {
  match input {
    Some(instance) => instance.value as i32,
    None => -1,
  }
}
