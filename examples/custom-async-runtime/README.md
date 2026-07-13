# Custom async runtime

This example implements the complete `AsyncRuntime` lifecycle rather than only
the task-submission hooks.

On native targets, `start` creates two blocking workers backed by a bounded
64-item queue. `spawn_blocking` rejects work when the runtime is stopped or the
queue is full. `shutdown` closes admission, drops queued blocking closures,
joins every worker, then cancels and drains scheduler tasks. A later `start`
creates a fresh worker generation.

`block_on` uses thread parking on thread-capable targets, so a pending future
parks the caller instead of busy-spinning. Scheduler submissions also notify
parked callers so deferred task drains cannot strand them. Threadless WASI
returns control when a future cannot make synchronous progress, allowing the
exported wrappers to report the incomplete drive instead of invoking an
unsupported parking primitive.

Threadless `wasm32-wasip1` has no blocking-capable thread. Its runtime hook
therefore rejects blocking submissions, and the exported example API reports
that blocking work is unsupported. The `wasm32-wasip1-threads` flavor retains
the existing threaded-host behavior.

The shutdown path also preserves the unload-safety checks for externally
retained task and `block_on` wakers. Native shutdown returns only after every
backend-owned worker has stopped.
