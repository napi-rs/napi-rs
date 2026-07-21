//! A shared, tokio-free async runtime for napi-rs addons.
//!
//! Two layers, one crate:
//!
//! - **Scheduler** (always compiled, napi-free): a pluggable async/CPU/blocking
//!   scheduler with a MultiThread flavor (Rayon-backed worker pool on native
//!   targets) and a CurrentThread flavor (host-driven turns; the only flavor on
//!   WebAssembly). Exposed at the crate root: [`spawn`], [`spawn_blocking`],
//!   [`block_on`], [`sleep_until`], [`configure`], [`start`], [`shutdown`],
//!   the host driver SPIs ([`CurrentThreadTaskDriver`], [`TimerDriver`]), and
//!   the metrics/introspection helpers.
//! - **napi adapter** (feature `napi`, on by default): an
//!   `unsafe impl AsyncRuntime` backend for napi-rs' `async-runtime` SPI plus
//!   the JavaScript-facing host protocol (`registerCurrentThreadTaskHost`,
//!   `registerTimerHost`, config/metrics exports). Hosts call [`install`] from
//!   their own `#[napi_derive::module_init]` hook after resolving their
//!   runtime configuration; this crate deliberately ships no `module_init` of
//!   its own.

/// Maximum number of physical workers a scheduler owned by this crate may
/// create.
pub const MAX_ASYNC_RUNTIME_WORKER_THREADS: usize = 256;

/// Platform-realizable worker ceiling after applying this crate's production
/// cap.
#[cfg(not(target_family = "wasm"))]
pub fn max_async_runtime_worker_threads() -> usize {
  MAX_ASYNC_RUNTIME_WORKER_THREADS.min(::rayon::max_num_threads())
}

/// WebAssembly builds use the current-thread executor.
#[cfg(target_family = "wasm")]
pub const fn max_async_runtime_worker_threads() -> usize {
  1
}

mod async_runtime;
pub use async_runtime::*;

#[cfg(feature = "napi")]
mod adapter;
#[cfg(feature = "napi")]
pub mod js_callback;
#[cfg(feature = "napi")]
pub use adapter::*;
