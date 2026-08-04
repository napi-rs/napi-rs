//! GC finalize / `Drop` fixtures for `#[napi(extends = Parent)]` (issue #1164).
//!
//! Proves two distinct, easily-conflated claims about how a descendant tears
//! down, using test-only atomic counters that JS can read after forcing GC:
//!
//! 1. The parent's custom [`ObjectFinalize`] callback is **not** invoked when a
//!    *child* is finalized. `finalize` is a per-class napi finalizer registered
//!    at wrap time for the class actually wrapped — here the child, which does
//!    not declare `custom_finalize`, so it gets the default (drop-the-box)
//!    finalizer, never the parent's.
//! 2. The parent's Rust `Drop` **still runs exactly once**, reached through the
//!    child's own `Drop` glue dropping the embedded `base` field.
//!
//! (When a *parent* instance is finalized, both its custom `ObjectFinalize` and
//! its `Drop` run — the contrasting case.)

use std::sync::atomic::{AtomicU32, Ordering};

use napi::bindgen_prelude::ObjectFinalize;
use napi::{Env, Result};
use napi_derive::napi;

static BASE_FINALIZE_COUNT: AtomicU32 = AtomicU32::new(0);
static BASE_DROP_COUNT: AtomicU32 = AtomicU32::new(0);
static SUB_DROP_COUNT: AtomicU32 = AtomicU32::new(0);

/// Parent carrying BOTH a custom `ObjectFinalize` (counted) and a `Drop`
/// (counted), so the two teardown paths can be told apart.
#[napi(custom_finalize)]
pub struct FinalizeBase {
  value: i32,
}

#[napi]
impl FinalizeBase {
  #[napi(constructor)]
  pub fn new(value: i32) -> Self {
    FinalizeBase { value }
  }

  #[napi(getter)]
  pub fn get_value(&self) -> i32 {
    self.value
  }
}

impl ObjectFinalize for FinalizeBase {
  fn finalize(self, _env: Env) -> Result<()> {
    BASE_FINALIZE_COUNT.fetch_add(1, Ordering::SeqCst);
    Ok(())
    // `self` is consumed here, so `FinalizeBase::drop` runs immediately after,
    // incrementing BASE_DROP_COUNT: a finalized *parent* bumps both counters.
  }
}

impl Drop for FinalizeBase {
  fn drop(&mut self) {
    BASE_DROP_COUNT.fetch_add(1, Ordering::SeqCst);
  }
}

/// Child of [`FinalizeBase`]. Deliberately does NOT declare `custom_finalize`:
/// a collected child runs the DEFAULT finalizer for its own class (drop the
/// boxed child), which runs `FinalizeSub::drop` and then — via ordinary Rust
/// drop glue — drops the embedded `base`, running `FinalizeBase::drop`. The
/// parent's custom `ObjectFinalize` is never reached this way.
#[napi(extends = FinalizeBase)]
#[repr(C)]
pub struct FinalizeSub {
  base: FinalizeBase,
  extra: i32,
}

#[napi]
impl FinalizeSub {
  #[napi(factory)]
  pub fn create(value: i32, extra: i32) -> Self {
    FinalizeSub {
      base: FinalizeBase::new(value),
      extra,
    }
  }

  #[napi(getter)]
  pub fn get_extra(&self) -> i32 {
    self.extra
  }
}

impl Drop for FinalizeSub {
  fn drop(&mut self) {
    SUB_DROP_COUNT.fetch_add(1, Ordering::SeqCst);
  }
}

/// Snapshot of the three teardown counters, read from JS after forcing GC.
#[napi(object)]
pub struct FinalizeCounters {
  pub base_finalize: u32,
  pub base_drop: u32,
  pub sub_drop: u32,
}

#[napi]
pub fn read_finalize_counters() -> FinalizeCounters {
  FinalizeCounters {
    base_finalize: BASE_FINALIZE_COUNT.load(Ordering::SeqCst),
    base_drop: BASE_DROP_COUNT.load(Ordering::SeqCst),
    sub_drop: SUB_DROP_COUNT.load(Ordering::SeqCst),
  }
}

#[napi]
pub fn reset_finalize_counters() {
  BASE_FINALIZE_COUNT.store(0, Ordering::SeqCst);
  BASE_DROP_COUNT.store(0, Ordering::SeqCst);
  SUB_DROP_COUNT.store(0, Ordering::SeqCst);
}
