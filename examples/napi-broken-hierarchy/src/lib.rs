//! Test-only "broken hierarchy" addon (issue #1164).
//!
//! Its module registration deliberately fails: a class is hand-registered whose
//! `#[napi(extends)]` parent tag is never registered, so `build_hierarchy`
//! returns `Err` and `napi_register_module_v1` throws on every `require`. This
//! exists to prove the fail-fast property under concurrency — when the same
//! broken addon is `require()`d simultaneously from two worker_threads, BOTH
//! throw promptly and neither hangs (the `CLASS_HIERARCHY` `get_or_init` runs
//! `build_hierarchy` once and every caller observes the stored `Err`, while the
//! `FirstRegistrationGuard` guarantees no waiter is ever left blocked).
//!
//! A broken hierarchy cannot arise from ordinary macro use — a missing,
//! duplicate, or iterator-involved edge is rejected at compile time, and
//! content-derived type tags never collide between two distinct classes — so it
//! is forced here through the public `register_class` entry point.

use napi_derive::napi;

/// A trivial real class, so the addon links the full registration machinery and
/// exports `napi_register_module_v1`.
#[napi]
pub struct Anchor {
  pub value: i32,
}

// Runs at dylib load, before Node calls `napi_register_module_v1`. Registers a
// phantom class whose parent tag matches nothing else in the module; the
// resulting hierarchy build fails with "references a parent class that is not
// registered".
napi::ctor::declarative::ctor! {
  #[ctor(unsafe)]
  fn force_broken_hierarchy() {
    struct PhantomChildType;

    let own_tag = napi::sys::napi_type_tag {
      lower: 0x1164_0000_0000_0001,
      upper: 0x1164_0000_0000_0002,
    };
    // Deliberately not the tag of any registered class (including `Anchor`).
    let missing_parent_tag = napi::sys::napi_type_tag {
      lower: 0xDEAD_BEEF_DEAD_BEEF,
      upper: 0xFEED_FACE_FEED_FACE,
    };

    napi::__private::register_class(
      std::any::TypeId::of::<PhantomChildType>(),
      None,
      "PhantomChild",
      Vec::new(),
      false,
      Some(own_tag),
      Some(missing_parent_tag),
    );
  }
}
