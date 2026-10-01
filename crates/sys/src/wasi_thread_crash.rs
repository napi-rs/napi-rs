//! `wasm32-wasip1-threads` only: whether a wasm thread of this instance has died. Not a public
//! API; the generated worker raises it, and napi-async-runtime's shutdown waits read it.
//!
//! A pool thread that traps unwinds nothing: the locks it held stay held, and the counts it
//! would have lowered stay up. The JavaScript thread runs the environment cleanup, and a wait
//! there on such a lock or count parks it in `memory.atomic.wait32` for good, before the loader
//! can see the crash. So when a worker's wasm thread dies, the generated worker (`wasi-worker.mjs`)
//! raises this flag right after the loader's own crash flag, and the cleanup waits on the
//! JavaScript thread check it between short slices and trap once it is up. The loader then
//! reports the crash instead of hanging.
//!
//! The flag is one 4-byte word in linear memory, which is shared with every worker. napi's
//! `napi_wasm_thread_crash_flag_address` export hands its address to the loader, which gives
//! each worker an `Int32Array` over it; the worker raises the flag with `Atomics.store`. That
//! needs no instance, so a worker whose load failed after its thread spawn had already been
//! reported as started raises it too. napi's `napi_wasm_thread_crashed` export stores into the
//! same word, for a worker that has an instance but no view.
//!
//! It lives in napi-sys for the same reason as [`crate::wasi_heap_sync`]: napi-async-runtime
//! reads it and cannot depend on napi. It defines no `#[no_mangle]` item and imports nothing.

use std::sync::atomic::{AtomicI32, Ordering};

/// 0 while every thread is alive, 1 once one died. An `AtomicI32` so the word is 4-aligned and
/// JavaScript's `Atomics` can store into it through an `Int32Array`.
static THREAD_CRASHED: AtomicI32 = AtomicI32::new(0);

/// The flag word itself, whose address napi exports to the loader. Anything written there
/// other than 0 counts as a crash.
pub fn thread_crash_flag() -> &'static AtomicI32 {
  &THREAD_CRASHED
}

/// Record that a wasm thread of this instance has died. It stays set: nothing in the instance
/// can be trusted afterwards.
///
/// `SeqCst`, like the flag the worker raises for the loader just before: a thread that sees
/// this one set and traps then finds the loader's flag set too, so the loader reports the trap
/// as the crash. JavaScript's `Atomics.store` is sequentially consistent as well.
pub fn mark_thread_crashed() {
  THREAD_CRASHED.store(1, Ordering::SeqCst);
}

/// Whether a crash was recorded, by [`mark_thread_crashed`] or by a store to
/// [`thread_crash_flag`].
#[inline]
pub fn thread_crashed() -> bool {
  THREAD_CRASHED.load(Ordering::SeqCst) != 0
}

#[cfg(test)]
mod tests {
  use std::sync::atomic::{AtomicI32, Ordering};

  use super::{mark_thread_crashed, thread_crash_flag, thread_crashed};

  // One test: the flag is process-wide, so parallel tests would see each other's stores.
  #[test]
  fn both_writers_reach_the_word_the_waits_read() {
    let address = std::ptr::from_ref(thread_crash_flag()) as usize;
    // JavaScript builds `new Int32Array(memory.buffer, address, 1)`, which needs a 4-aligned
    // offset and exactly four bytes.
    assert_eq!(address % 4, 0);
    assert_eq!(std::mem::size_of::<AtomicI32>(), 4);
    assert!(!thread_crashed());

    // What the worker's `Atomics.store(view, 0, 1)` does: a store through the exported
    // address, with no Rust call.
    let view = address as *const AtomicI32;
    // SAFETY: `address` is the address of the static above.
    unsafe { &*view }.store(1, Ordering::SeqCst);
    assert!(thread_crashed());

    // SAFETY: as above. Only this test ever lowers the flag.
    unsafe { &*view }.store(0, Ordering::SeqCst);
    assert!(!thread_crashed());

    // What `napi_wasm_thread_crashed` does: the same word, seen through the address.
    mark_thread_crashed();
    assert!(thread_crashed());
    // SAFETY: as above.
    assert_eq!(unsafe { &*view }.load(Ordering::SeqCst), 1);
  }
}
