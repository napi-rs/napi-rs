//! `wasm32-wasip1-threads` only: every thread's view of the shared memory size. Not a public
//! API; napi's allocator wrappers and napi-async-runtime's scheduler hook share it.
//!
//! # The V8 bug
//!
//! All threads of a `wasm32-wasip1-threads` addon share one wasm memory, and wasi-libc's
//! dlmalloc grows it (`memory.grow` in `sbrk`) from whichever thread runs out of heap. V8
//! updates the size on that thread only; every other thread keeps its old size until it
//! handles V8's grow interrupt, which a thread inside one long wasm activation does late. On
//! such a stale thread `memory.fill`, `memory.copy`, Liftoff atomics and atomic wait/notify are
//! bounds-checked against the old size, so they trap on pages another thread grew; on hosts
//! without V8's wasm trap handler (for example Node's `--disable-wasm-trap-handler`), plain
//! loads and stores do too. `memory.grow(0)` on the stale thread makes V8 reload the size and
//! returns it; `memory.size` returns the stale size and reloads nothing. V8 fixed it in
//! v8/v8@34241014663390c72e08c123faef6fedf395be8e. The evidence and the rejected alternatives
//! are in rolldown's `internal-docs/wasi-shared-memory-grow/design.md`.
//!
//! # The state
//!
//! - `LOCAL_PAGES` (thread-local): the size this thread's bounds were last refreshed to. It is
//!   only set from the result of `memory.grow(0)` run on this thread, and memory never shrinks,
//!   so it never exceeds the size V8 checks on this thread.
//! - `MAX_SEEN_PAGES`: the largest `LOCAL_PAGES` any thread has stored.
//!
//! napi's allocator wrappers call [`grow_zero`] under their lock, so a thread that grows the
//! memory publishes the new size before any other thread allocates. napi-async-runtime calls
//! [`refresh_if_behind`] at every scheduler handoff, because a task can allocate on one thread
//! and then fill or copy into that memory on another without allocating there.
//!
//! # Why in napi-sys
//!
//! Both users must read and write the same statics: with two copies, the hook would read a
//! `MAX_SEEN_PAGES` the allocator never writes, and silently never refresh. napi cannot depend
//! on napi-async-runtime (its default `napi` feature depends on napi, a cycle), and hosts build
//! napi-async-runtime without napi, so the state lives in napi-sys: napi already depends on it,
//! and napi-async-runtime can without napi. It defines no `#[no_mangle]` item and imports
//! nothing, so napi-free test binaries still link.

use std::{
  cell::Cell,
  sync::atomic::{AtomicU32, AtomicUsize, Ordering},
};

/// Wasm page size in bytes.
const PAGE: u64 = 65536;

/// Index of [`handoff_refreshes`] in napi's `napi_wasm_heap_sync_stat` export; 0-4 are napi's
/// allocator counters.
pub const HANDOFF_REFRESHES_STAT: u32 = 5;

/// Keeps a value alone in its cache line.
#[repr(align(128))]
struct Padded<T>(T);

/// The largest `LOCAL_PAGES` any thread has stored.
///
/// Every scheduler handoff reads it, and napi's allocator lock is taken all the time, so the
/// two must not share a cache line. When they shared one (as in rolldown's first copy of this
/// code), the handoff check cost 0.89 ns instead of 0.24 ns (3.7x) while another thread took
/// the lock in a loop, and that thread ran 12% slower (node 24.21, arm64 with 128-byte lines).
/// 128 bytes also covers x86, which prefetches 64-byte lines in pairs.
static MAX_SEEN_PAGES: Padded<AtomicUsize> = Padded(AtomicUsize::new(0));

/// Refreshes run by [`refresh_if_behind`]. Only written on its cold path.
static HANDOFF_REFRESHES: AtomicU32 = AtomicU32::new(0);

thread_local! {
  /// Memory size (pages) this thread's bounds were last refreshed to; 0 before its first refresh.
  static LOCAL_PAGES: Cell<usize> = const { Cell::new(0) };
}

/// Whether a thread whose bounds were refreshed to `local_pages` must refresh before it
/// touches a block that ends at byte `end` (exclusive).
///
/// `end` is `u64` because a block may end exactly at 4 GiB, and the pages are multiplied as
/// `u64` because 65536 pages * 64 KiB overflows the 32-bit `usize` of wasm32.
#[inline]
pub const fn needs_refresh(end: u64, local_pages: usize) -> bool {
  end > local_pages as u64 * PAGE
}

// The largest wasm32 memory. Checked when this module compiles, so also on wasm32, where the
// same math in `usize` would overflow.
const _: () = assert!(!needs_refresh(65536 * PAGE, 65536));

/// Run `memory.grow(0)` on this thread: V8 reloads this thread's size and returns it. Records
/// it in `LOCAL_PAGES` and publishes it to `MAX_SEEN_PAGES`, then returns it.
#[cfg(napi_wasi_threads)]
#[inline]
pub fn grow_zero() -> usize {
  let now = core::arch::wasm32::memory_grow::<0>(0);
  LOCAL_PAGES.with(|pages| pages.set(now));
  MAX_SEEN_PAGES.0.fetch_max(now, Ordering::AcqRel);
  now
}

/// Refresh when another thread has seen a larger memory than this thread.
///
/// Runs outside napi's allocator lock. Hot path: one atomic load and one thread-local load.
#[cfg(napi_wasi_threads)]
#[inline]
pub fn refresh_if_behind() {
  if max_seen_pages() > local_pages() {
    handoff_refresh();
  }
}

#[cfg(napi_wasi_threads)]
#[cold]
fn handoff_refresh() {
  grow_zero();
  HANDOFF_REFRESHES.fetch_add(1, Ordering::Relaxed);
}

/// `LOCAL_PAGES` of this thread.
#[inline]
pub fn local_pages() -> usize {
  LOCAL_PAGES.with(Cell::get)
}

/// `MAX_SEEN_PAGES`, with `Acquire` to pair with the publish in [`grow_zero`].
#[inline]
pub fn max_seen_pages() -> usize {
  MAX_SEEN_PAGES.0.load(Ordering::Acquire)
}

/// How many refreshes [`refresh_if_behind`] has run, on every thread.
#[inline]
pub fn handoff_refreshes() -> u32 {
  HANDOFF_REFRESHES.load(Ordering::Relaxed)
}

#[cfg(test)]
mod tests {
  use super::{needs_refresh, PAGE};

  #[test]
  fn a_thread_that_never_refreshed_needs_a_refresh() {
    assert!(needs_refresh(1, 0));
  }

  #[test]
  fn needs_refresh_only_past_the_last_page() {
    assert!(!needs_refresh(PAGE, 1));
    assert!(needs_refresh(PAGE + 1, 1));
  }

  #[test]
  fn needs_refresh_at_4_gib() {
    // 65536 pages is the largest wasm32 memory; its end does not fit in a 32-bit `usize`.
    assert!(!needs_refresh(65536 * PAGE, 65536));
    assert!(needs_refresh(65536 * PAGE, 65535));
    assert!(needs_refresh(65536 * PAGE + 1, 65536));
  }
}
