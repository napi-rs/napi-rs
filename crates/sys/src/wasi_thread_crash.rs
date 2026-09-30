//! `wasm32-wasip1-threads` only: whether a wasm thread of this instance has died. Not a public
//! API; napi's `napi_wasm_thread_crashed` export raises it, and napi-async-runtime's shutdown
//! waits read it.
//!
//! A pool thread that traps unwinds nothing: the locks it held stay held, and the counts it
//! would have lowered stay up. The JavaScript thread runs the environment cleanup, and a wait
//! there on such a lock or count parks it in `memory.atomic.wait32` for good, before the loader
//! can see the crash. So the generated worker (`wasi-worker.mjs`) calls
//! `napi_wasm_thread_crashed` when its wasm thread dies, right after it raises the loader's own
//! crash flag, and the cleanup waits on the JavaScript thread check this flag between short
//! slices and trap once it is up. The loader then reports the crash instead of hanging.
//!
//! It lives in napi-sys for the same reason as [`crate::wasi_heap_sync`]: napi-async-runtime
//! reads it and cannot depend on napi. It defines no `#[no_mangle]` item and imports nothing.

use std::sync::atomic::{AtomicBool, Ordering};

static THREAD_CRASHED: AtomicBool = AtomicBool::new(false);

/// Record that a wasm thread of this instance has died. It stays set: nothing in the instance
/// can be trusted afterwards.
///
/// `SeqCst`, like the flag the worker raises for the loader just before: a thread that sees
/// this one set and traps then finds the loader's flag set too, so the loader reports the trap
/// as the crash.
pub fn mark_thread_crashed() {
  THREAD_CRASHED.store(true, Ordering::SeqCst);
}

/// Whether [`mark_thread_crashed`] has run.
#[inline]
pub fn thread_crashed() -> bool {
  THREAD_CRASHED.load(Ordering::SeqCst)
}

#[cfg(test)]
mod tests {
  #[test]
  fn only_a_reported_crash_raises_the_flag() {
    assert!(!super::thread_crashed());
    super::mark_thread_crashed();
    assert!(super::thread_crashed());
  }
}
