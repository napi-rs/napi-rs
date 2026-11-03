//! Counters for what napi-rs releases when an env that loaded this addon is
//! torn down. They are process-wide, so a test reads them before and after a
//! worker that loads the addon and exits.

use napi_derive::napi;

/// How many cached `Reflect` holder references env teardown has deleted in this
/// process. Each load of the addon caches one, so each torn-down load must add
/// exactly one.
#[napi]
pub fn reflect_refs_deleted_at_teardown() -> u32 {
  napi::bindgen_prelude::env_teardown_reflect_refs_deleted() as u32
}
