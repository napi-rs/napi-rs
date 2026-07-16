# napi-async-runtime

A shared, tokio-free async runtime for napi-rs addons: a pluggable
async/CPU/blocking scheduler plus an optional adapter that registers it as the
addon's `AsyncRuntime` backend (napi's `async-runtime` SPI).

## Layers

- **Scheduler** (always compiled, napi-free). Exposed at the crate root:
  `spawn`, `try_spawn`, `spawn_detached`, `spawn_blocking`, `block_on`,
  `sleep_until`, `configure`/`configure_partial`/`configured_options`,
  `start`/`shutdown`, metrics (`metrics`/`reset_metrics`), and the host driver
  SPIs (`CurrentThreadTaskDriver`, `TimerDriver`).
- **napi adapter** (cargo feature `napi`, on by default). `install(options)`
  configures the scheduler and calls `register_async_runtime`; the
  JavaScript-facing host protocol is exported under stable names
  (`reserveCurrentThreadHostRegistration`, `registerCurrentThreadTaskHost`,
  `registerTimerHost`, `unregisterCurrentThreadTaskHost`,
  `unregisterTimerHost`, `isCurrentThreadHostRegistrationActive`,
  `getCurrentThreadTaskHostContractVersion`, `configureAsyncRuntime`,
  `getAsyncRuntimeConfig`, `getAsyncRuntimeMetrics`,
  `resetAsyncRuntimeMetrics`).

## Usage

```rust
use napi_async_runtime::{RuntimeOptions, install};

#[napi_derive::module_init]
fn init() {
  // Resolve your own configuration (env vars, defaults) FIRST; the scheduler
  // never reads the environment itself.
  install(RuntimeOptions::default()).expect("failed to install the shared async runtime");
}
```

This crate deliberately ships **no `module_init` of its own**: the host stays
in charge of configuration resolution order. `@napi-rs/async-runtime` provides
the matching JavaScript host installers (task host + timer host) for
CurrentThread builds.

## Implementation notes

- **Flavors.** `MultiThread` (native only) runs futures on a Rayon-backed
  worker pool; `CurrentThread` (the only flavor on WebAssembly) never creates
  threads and instead publishes _host turns_ through registered
  `CurrentThreadTaskDriver`s — on Node that driver is a native threadsafe
  function installed by `registerCurrentThreadTaskHost` (contract version
  **4**: a registration capability is reserved and validated before host
  installation performs side effects).
- **Timers.** MultiThread owns a timer heap serviced by a timekeeper thread.
  CurrentThread delegates each timer to the host event loop through the JS
  relay installed by `registerTimerHost`
  (`(relayId, ms) => Promise<void>` paired with `(relayId) => void`
  cancellation). Schedule and cancel share ONE per-relay health record (a
  single strike); three consecutive live-host failures evict the host;
  eviction is decided only by `Status::Closing` or the liveness probe, never
  by message text; relay ids are never reused while referable.
- **Blocking admission.** The blocking cap is `worker_threads - 1`: one
  execution lane always stays available for runnable futures and timer
  service. There is no hidden reserve worker, and napi never creates fallback
  threads when `spawn_blocking` declines.
- **Lifecycle.** `shutdown` closes admission, waits for the scheduler
  generation to quiesce, JOINS native workers (TLS destructors retire inside
  the barrier), and releases active resources before returning; generation
  identities fail closed before u64 reuse. Detached-task semantics match
  tokio: dropping a `JoinHandle` detaches, and shutdown may cancel accepted
  work by dropping futures.
- **Threadless wasm** (`wasm32-wasip1`, `wasm32-unknown-unknown`): no threads,
  no `Atomics.wait`. A `block_on` park that provably can never be woken fails
  loudly with the typed `BlockOnDeadlock` panic instead of hanging the JS
  event loop. The `wasm32-wasip1-threads` target is discriminated by this
  crate's build.rs (`napi_runtime_wasi_threads` cfg) because rustc exposes
  identical cfg sets for both WASI targets.

The scheduler and adapter were extracted from rolldown's shared async runtime
(rolldown#9977/#9978) and generalized; the wire behavior of the host protocol
is byte-compatible with the rolldown hosts at contract version 4.
