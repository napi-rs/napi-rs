use std::sync::atomic::{AtomicU32, Ordering};

use napi::bindgen_prelude::*;

// Repro coverage for napi-rs#3602: when `napi_wrap` fails inside a `#[napi]`
// constructor (`CallbackInfo::_construct`) or factory (`CallbackInfo::_factory`),
// the boxed Rust value was never adopted by a finalizer, so it leaked, and so
// did the finalize-callbacks `Arc` that was allocated before the wrap.
// JavaScript can reach a failing `napi_wrap` in three ways:
// - the constructor returns while an exception is pending
//   (`napi_pending_exception`);
// - the constructor is called on an object that is already wrapped, e.g.
//   `Klass.call(existing)` (`napi_invalid_arg`);
// - the factory is called with a `this` whose `new` returns an object that is
//   already wrapped, e.g. `Klass.create.call(function () { return existing })`
//   (`napi_invalid_arg`).
// The value is dropped synchronously on that error path, so the drop counters
// below show the fix without any GC. The `Arc` cannot be observed from
// JavaScript, so these tests do not cover it; it is allocated only after a
// successful wrap now.

static TRACKED_CREATED: AtomicU32 = AtomicU32::new(0);
static TRACKED_DROPPED: AtomicU32 = AtomicU32::new(0);
static THROW_IN_CTOR_DROPPED: AtomicU32 = AtomicU32::new(0);
static EMPTY_CREATED: AtomicU32 = AtomicU32::new(0);
static EMPTY_DROPPED: AtomicU32 = AtomicU32::new(0);

#[napi]
pub struct Issue3602Tracked {
  id: u32,
  payload: Vec<u8>,
}

impl Issue3602Tracked {
  fn with_size(size: usize) -> Self {
    Self {
      id: TRACKED_CREATED.fetch_add(1, Ordering::SeqCst) + 1,
      payload: vec![0; size],
    }
  }
}

impl Drop for Issue3602Tracked {
  fn drop(&mut self) {
    TRACKED_DROPPED.fetch_add(1, Ordering::SeqCst);
  }
}

#[napi]
impl Issue3602Tracked {
  #[napi(constructor)]
  pub fn new() -> Self {
    Self::with_size(1024)
  }

  // A different size than the constructor, so a test can tell which value an
  // object wraps.
  #[napi(factory)]
  pub fn create() -> Self {
    Self::with_size(2048)
  }

  #[napi(getter)]
  pub fn id(&self) -> u32 {
    self.id
  }

  #[napi(getter)]
  pub fn size(&self) -> u32 {
    self.payload.len() as u32
  }
}

#[napi]
pub struct Issue3602ThrowInCtor {
  _payload: Vec<u8>,
}

impl Drop for Issue3602ThrowInCtor {
  fn drop(&mut self) {
    THROW_IN_CTOR_DROPPED.fetch_add(1, Ordering::SeqCst);
  }
}

#[napi]
impl Issue3602ThrowInCtor {
  // Leaves an exception pending and still returns the value, so the glue
  // reaches `CallbackInfo::_construct` and `napi_wrap` returns
  // `napi_pending_exception`.
  #[napi(constructor)]
  pub fn new(env: Env) -> Self {
    let _ = env.throw_error("issue3602 pending exception", None);
    Self {
      _payload: vec![0; 1024],
    }
  }
}

// Zero-sized: the constructor and the factory wrap a 1-byte placeholder
// pointer instead of the dangling `Box` pointer.
#[napi]
pub struct Issue3602Empty;

impl Drop for Issue3602Empty {
  fn drop(&mut self) {
    EMPTY_DROPPED.fetch_add(1, Ordering::SeqCst);
  }
}

#[napi]
impl Issue3602Empty {
  #[napi(constructor)]
  pub fn new() -> Self {
    EMPTY_CREATED.fetch_add(1, Ordering::SeqCst);
    Self
  }

  #[napi(factory)]
  pub fn create() -> Self {
    EMPTY_CREATED.fetch_add(1, Ordering::SeqCst);
    Self
  }

  // Unwraps `this`, so it only works while the object's wrap is intact.
  #[napi]
  pub fn ping(&self) -> bool {
    true
  }
}

#[napi]
pub fn issue3602_tracked_created() -> u32 {
  TRACKED_CREATED.load(Ordering::SeqCst)
}

#[napi]
pub fn issue3602_tracked_dropped() -> u32 {
  TRACKED_DROPPED.load(Ordering::SeqCst)
}

#[napi]
pub fn issue3602_throw_in_ctor_dropped() -> u32 {
  THROW_IN_CTOR_DROPPED.load(Ordering::SeqCst)
}

#[napi]
pub fn issue3602_empty_created() -> u32 {
  EMPTY_CREATED.load(Ordering::SeqCst)
}

#[napi]
pub fn issue3602_empty_dropped() -> u32 {
  EMPTY_DROPPED.load(Ordering::SeqCst)
}
