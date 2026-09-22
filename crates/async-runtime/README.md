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

- **Flavors.** `MultiThread` runs futures on a Rayon-backed worker pool; it is
  available on native targets and on `wasm32-wasip1-threads`, and is rejected
  on threadless WebAssembly. `CurrentThread` (the default on every wasm target
  and the only flavor on threadless ones) never creates threads and instead
  publishes _host turns_ through registered
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
  no `Atomics.wait`. `MultiThread` is rejected at `validate()` there. A
  `block_on` park that provably can never be woken fails loudly with the typed
  `BlockOnDeadlock` panic instead of hanging the JS event loop.
- **Threaded wasm** (`wasm32-wasip1-threads`): `wasi.thread-spawn` gives std a
  real `pthread_create`, so both flavors work exactly as on native. rustc
  exposes identical cfg sets for the two WASI targets, so this crate's
  build.rs discriminates them from the exact cargo `TARGET`, emitting
  `napi_runtime_wasi_threads` (the threaded WASI target) and
  `napi_runtime_os_threads` (native **or** the threaded WASI target — "this
  build can create OS threads"). The default flavor stays `CurrentThread` on
  every wasm target: selecting `MultiThread` there is always an explicit host
  act.

## Running MultiThread on `wasm32-wasip1-threads`

Everything below is the host's job; the crate adds no wasm-specific API.

- **Pass a worker count.** `available_parallelism()` answers `Ok(1)` inside a
  WASI host, so a host that flips only the flavor gets MultiThread's clamped
  minimum: `worker_threads = 2`, `max_blocking_tasks = 1`. That is truthful,
  not useful. Read the real number in JavaScript
  (`os.availableParallelism()`, `navigator.hardwareConcurrency`) and pass it
  through `configure` / `configure_partial` before the first async call. The
  crate never probes the CPU count on wasm.
- **Budget `worker_threads + 1` threads.** The first `sleep_until` lazily
  spawns one non-Rayon timekeeper thread — one more Node Worker than the pool
  size suggests.
- **Route through the `try_*` family.** `try_spawn`, `try_spawn_blocking` and
  `try_block_on_dyn` return the pool-build failure (`EAGAIN`, no SAB, a Worker
  that never boots) as an `Err`. The infallible helpers panic instead, and
  `panic = "abort"` makes that a dead instance.
- **Never from a browser main thread.** Under MultiThread, `block_on`,
  shutdown's idle barrier and the worker join all park the calling thread on
  `memory.atomic.wait32`. A browser main thread may not do that — emnapi
  answers `napi_would_deadlock` — so the threaded artifact is a Node /
  WebContainer target today. Inside a Worker it is fine.
- **Panics abort.** Both WASI targets are `panic = "abort"`, so this crate's
  containment (`catch_unwind` around task polls, closure drops and host
  callbacks) never catches anything there: a user panic takes the instance
  down instead of becoming a `JoinError`. That is true on threadless wasm too;
  MultiThread only widens the surface to every worker plus the timekeeper.
- **`shutdown` joins, without a bound.** It waits for every worker to exit
  before returning, and on the WASI loader path it runs inside a synchronous
  wasm export — so the JS thread sits in `pthread_join` for its duration, and
  a blocking closure waiting on a JS turn cannot finish while it does. A
  bounded join would be worse: it would leave a live thread running over
  memory the loader is about to destroy. Use `RuntimeOptions::park_deadline`
  if you need a park to fail loudly instead. The same applies before the join:
  `shutdown` first waits for every accepted blocking closure to return, and
  `park_deadline` does not bound that wait; it bounds parks, not a closure that
  is running. So the rule for hosts is: a blocking closure must never wait on a
  JavaScript turn (no threadsafe-function call, no napi promise, no channel fed
  by JS). Route that work through `spawn` instead, where the await yields. This
  is the same contract native addons already live under (`thread_cleanup` runs
  `shutdown` synchronously on the JS thread); MultiThread on threaded WASI is
  only the first configuration where a closure can be running on another thread
  while it happens.
- **A host that can yield splits the join in two.** `begin_shutdown` publishes
  the stop, closes admission, cancels and drops what is only queued, wakes what
  is parked — and returns without waiting. It answers `true` while
  backend-owned work is still live. `runtime_work_pending` re-answers that
  question at any time, without blocking. `finish_shutdown` is the call that
  waits, joins the workers and publishes `Stopped`, so it is the one that owes
  the quiescence guarantee. `shutdown` is unchanged and is exactly the two in
  sequence, so nothing that calls it behaves differently. Between the phases
  the host may turn its event loop — that is the point, because that turn is
  what a blocking closure is waiting for — but it may not call `start`: a
  restart belongs after `finish_shutdown`. A second `begin_shutdown` before the
  matching `finish_shutdown` re-reports the poll and never waits. The cli's
  WASI loader drives the pair through napi's
  `napi_prepare_wasm_env_cleanup_begin` / `napi_wasm_runtime_work_pending` /
  `…_finish` exports, polling on one-millisecond timer turns for as long as the
  poll keeps answering 1. That poll is **unbounded**, and deliberately so: the
  only way to end it early is to call `finish_shutdown`, which joins on the
  JavaScript thread — the very thread the work it joins may be waiting for a
  turn from. A bound would not end that wait, it would only move it somewhere
  the JavaScript thread can no longer be reached. So a host that breaks the rule
  above keeps its disposal promise pending, with its event loop still turning,
  instead of wedging the thread. The process-exit teardown is the one path with
  no turns left to give: it closes the handshake with `…_finish` and blocks
  there, exactly as the single call always did.
- **The JavaScript hosts go inert, not away.** The cli's
  `napi.wasm.asyncRuntime` loaders install a CurrentThread task host and a
  timer host unconditionally — they cannot know the flavor. MultiThread never
  publishes a host turn and never consults a `TimerDriver`, so both
  registrations simply sit unused, and the task host is an unref'd threadsafe
  function that does not hold the event loop. Leave the flag on.

The scheduler and adapter were extracted from rolldown's shared async runtime
(rolldown#9977/#9978) and generalized; the wire behavior of the host protocol
is byte-compatible with the rolldown hosts at contract version 4.
