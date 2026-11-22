//! `#[napi] async fn` callbacks whose task is dropped unsettled. The references they hold to
//! their `&T` arguments must be deleted, so the values can be collected while the env lives.

use std::sync::atomic::{AtomicU32, Ordering};

static HOLDERS_DROPPED: AtomicU32 = AtomicU32::new(0);
static FUTURES_STARTED: AtomicU32 = AtomicU32::new(0);
static FUTURES_DROPPED: AtomicU32 = AtomicU32::new(0);

/// A class whose finalizer is counted.
#[napi]
pub struct ArgRefHolder {
  _payload: Vec<u8>,
}

impl Drop for ArgRefHolder {
  fn drop(&mut self) {
    HOLDERS_DROPPED.fetch_add(1, Ordering::SeqCst);
  }
}

/// Counts the drop of the future that owns it.
struct FutureGuard;

impl FutureGuard {
  fn start() -> Self {
    FUTURES_STARTED.fetch_add(1, Ordering::SeqCst);
    FutureGuard
  }
}

impl Drop for FutureGuard {
  fn drop(&mut self) {
    FUTURES_DROPPED.fetch_add(1, Ordering::SeqCst);
  }
}

#[napi]
impl ArgRefHolder {
  #[napi(constructor)]
  pub fn new() -> Self {
    ArgRefHolder {
      _payload: vec![1u8; 1024],
    }
  }

  /// An async `&self` method that never completes.
  #[napi]
  pub async fn pending_forever(&self) -> u32 {
    let _guard = FutureGuard::start();
    std::future::pending::<()>().await;
    self._payload.len() as u32
  }

  /// An async `&self` method that resolves at once.
  #[napi]
  pub async fn resolve_now(&self) -> u32 {
    self._payload.len() as u32
  }
}

/// An `async fn` with a class `&T` and a typed-slice argument that never completes.
#[napi]
pub async fn arg_refs_pending_forever(holder: &ArgRefHolder, data: &[u8]) -> u32 {
  let _guard = FutureGuard::start();
  std::future::pending::<()>().await;
  (holder._payload.len() + data.len()) as u32
}

/// Same arguments, resolves at once.
#[napi]
pub async fn arg_refs_resolve_now(holder: &ArgRefHolder, data: &[u8]) -> u32 {
  (holder._payload.len() + data.len()) as u32
}

/// Only a typed-slice argument, resolves at once.
#[napi]
pub async fn arg_refs_slice_now(data: &[u8]) -> u32 {
  data.len() as u32
}

#[napi(object)]
pub struct ArgRefCounters {
  pub holders_dropped: u32,
  pub futures_started: u32,
  pub futures_dropped: u32,
}

#[napi]
pub fn arg_ref_counters() -> ArgRefCounters {
  ArgRefCounters {
    holders_dropped: HOLDERS_DROPPED.load(Ordering::SeqCst),
    futures_started: FUTURES_STARTED.load(Ordering::SeqCst),
    futures_dropped: FUTURES_DROPPED.load(Ordering::SeqCst),
  }
}
