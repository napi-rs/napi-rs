# WASI heap sync stress

Loads for napi's allocator lock on `wasm32-wasip1-threads`
(`crates/napi/src/wasi_heap_sync.rs`), run by the `test-wasi-heap-sync` CI job.

V8 updates a shared wasm memory's size only on the thread that grew it. Every
other thread checks `memory.fill`, `memory.copy` and atomics (and, without V8's
wasm trap handler, every load and store) against its own older size, so a
thread that touches pages another thread just grew traps. napi takes a lock
around wasi-libc's allocator and refreshes the thread's size inside it.

`src/lib.rs` allocates, fills, copies and frees on OS threads and on emnapi's
async-work pool, and passes blocks between threads and to JavaScript.
`foreignGrow` checks that napi's `sbrk` never hands dlmalloc pages that another
grower took, and `rawSbrkRace` that threads calling `sbrk` directly take the
allocator lock. `stress.mjs` runs each case in a child process; its header
lists the options.

```sh
yarn workspace @napi-rs/wasm-runtime build
yarn workspace @examples/wasi-heap-sync build:wasi-threads
cd examples/wasi-heap-sync
node stress.mjs --runs 20 --node-flag=--wasm-enforce-bounds-checks
node stress.mjs --runs 20 --initial-pages min --expect-grows some --node-flag=--wasm-enforce-bounds-checks
node stress.mjs --cases foreign --initial-pages min
node stress.mjs --cases raw-sbrk --runs 5 --expect-grows zero
```

To check that the loads still catch the bug, build without the lock and expect
failures (about a quarter to two fifths of the runs trapped or hung when this
was written):

```sh
RUSTFLAGS="--cfg napi_wasi_no_heap_sync" yarn workspace @examples/wasi-heap-sync build:wasi-threads
node stress.mjs --opted-out --runs 20 --node-flag=--wasm-enforce-bounds-checks
```
