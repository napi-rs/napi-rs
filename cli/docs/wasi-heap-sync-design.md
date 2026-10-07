# Shared memory growth on wasm32-wasip1-threads: design

How napi-rs works around the stale shared-memory size is in
[wasi.md](./wasi.md), section "Shared memory growth on
`wasm32-wasip1-threads`". This file keeps the why: the bug, the evidence, the
reasons for the shape of the workaround, the rejected alternatives and the
gaps that stay open.

## The bug

```
thread A (out of heap)            thread B (long wasm activation)
  dlmalloc -> sbrk
  memory.grow(n)  ── V8 refreshes A's cached size only
  hands out / frees blocks          malloc() -> block in the new pages
                                    memset / memcpy on it
                                      memory.fill / memory.copy
                                      bounds check vs B's OLD size -> trap
```

- wasi-libc's dlmalloc grows the one shared memory from whichever thread runs
  out of heap (`sbrk` is the only `memory.grow` site in the module).
- The stale size stays until the thread handles V8's grow interrupt, which only
  some code paths do (see "What refreshes a stale thread"). A thread that stays
  in wasm (a pool worker's loop, emnapi async work threads, dlmalloc's spin
  lock) keeps the old size.
- With V8's wasm trap handler, plain loads and stores and TurboFan atomics are
  checked by guard pages against the real size and do not trap.
- It is not MultiThread-specific: CurrentThread traps too, because emnapi async
  work threads allocate.
- It is not heap corruption: a pre-grown heap cures it, which would not cure an
  allocator race.

## Evidence

- A pure V8 repro (two workers, one module, shared memory): after worker A
  grows, worker B's `memory.fill`, `memory.copy` and `i32.atomic.store` on the
  new page trap; a plain store passes; `memory.size` before the touch still
  traps; `memory.grow(0)` before the touch passes.
- A cold B (first call, still Liftoff code) traps every time. A warm B (tiered
  up to TurboFan) traps only in a race.
- V8 fixed it upstream: "[wasm] Atomic memory.size and dynamic bounds checks
  for shared memory",
  [v8/v8@3424101](https://github.com/v8/v8/commit/34241014663390c72e08c123faef6fedf395be8e)
  (V8 15.7).

## Mechanism (V8 source, node v24.12.0 `deps/v8`)

- `memory.grow` on A updates A's own isolate and only requests a
  `GROW_SHARED_MEMORY` interrupt on every other isolate
  (src/wasm/wasm-objects.cc:1223, src/objects/backing-store.cc:855-869). B
  updates when it handles that interrupt (src/execution/stack-guard.cc:337-339).
- Until then B's `memory.copy` / `memory.fill` check against B's per-isolate
  size (src/wasm/wasm-external-refs.cc:786-790, 806-807).
- Under Node's default dynamic tiering, Liftoff emits no loop stack check
  (src/wasm/baseline/liftoff-compiler.cc:1415-1420), and wasm has no OSR. So a
  worker loop entered once stays in a Liftoff frame that handles interrupts
  only at a function-entry stack check or when its tier-up budget runs out.
- A TurboFan activation checks the stack on every loop pass, so it only misses
  a grow requested in the same pass.
- `memory.grow(0)` goes through the same `Grow` and updates the caller's own
  isolate (backing-store.cc:869). `memory.size` reads the stale size and
  handles no interrupt.

Which operations check the cached size:

| operation                                  | trap handler on (default) | trap handler off / `--wasm-enforce-bounds-checks` |
| ------------------------------------------ | ------------------------- | ------------------------------------------------- |
| `memory.fill` / `memory.copy` (both tiers) | cached size, can trap     | cached size, can trap                             |
| Liftoff atomics, wait/notify (both tiers)  | cached size, can trap     | cached size, can trap                             |
| TurboFan atomic load / store / rmw         | guard pages, safe         | cached size, can trap                             |
| plain load / store                         | guard pages, safe         | cached size, can trap                             |

Liftoff forces the check on atomics (liftoff-compiler.cc:5649-5650); TurboFan
omits it under the trap handler (src/wasm/turboshaft-graph-interface.cc:4094-4096,
7162-7165) and keeps it for wait/notify (:3921, :3943).

### What refreshes a stale thread

Each "yes" is a code path that runs `StackGuard::HandleInterrupts` for B's
pending grow interrupt (two-worker probes, node 24.12.0 and 24.21.0):

| B does this between "A grew" and "B touches"                         | refreshes? |
| -------------------------------------------------------------------- | ---------- |
| `memory.grow(0)` (in wasm or in JS)                                  | yes        |
| `wait32` on a private word, expected = its value, timeout 0          | yes        |
| a futex wait (wasm `wait32` or JS `Atomics.wait`) that sleeps        | yes        |
| call a Liftoff function (its entry stack check)                      | yes        |
| call a TurboFan non-leaf function that is not inlined                | yes        |
| call any JS function or JS builtin (emnapi imports, `Atomics.store`) | yes        |
| return to the Worker event loop (postMessage, `waitAsync`)           | yes        |
| nothing (stay in one activation)                                     | no         |
| `memory.size`                                                        | no, stale  |
| a futex wait that returns not-equal                                  | no         |
| `memory.atomic.notify`                                               | no         |
| call a TurboFan leaf function, or an inlined one                     | no         |
| return to JS and enter wasm again, nothing else                      | **no**     |

A futex wait handles the interrupt only after its value check
(src/execution/futex-emulation.cc:395, 405-428). The JS -> wasm wrapper checks
only the real stack limit (src/builtins/arm64/builtins-arm64.cc:4229-4470).

## Design principles

1. **Refresh under the allocator lock, and publish growth before unlocking.**
   Without the trap handler the first stale access is dlmalloc's own
   chunk-header store, made while dlmalloc holds its lock. A refresh before the
   call cannot close it: a thread waiting on dlmalloc's lock gets it right
   after the growing thread unlocks and before that thread publishes the new
   size. So napi owns an outer lock: take it, refresh if another thread saw a
   larger memory, call dlmalloc, and let `sbrk` publish any growth before the
   unlock.

   **Trade-off: the lock also covers calloc's fill and realloc's copy.**
   wasi-libc runs them after dlmalloc releases its own lock, so the outer lock
   is wider: a large zeroed allocation or realloc copy holds every other
   thread's allocator calls. Kept on purpose. Moving the fill and copy out of
   the lock did not help on the measured loads. dlmalloc has no in-place-only
   realloc entry, so a realloc outside the lock costs a second lock round trip
   and loses in-place growth. It would matter with several threads making
   multi-MiB zeroed allocations or reallocs at once, worst on a browser main
   thread, which spins while it waits; not measured. If a profile shows time
   spinning in the lock behind `calloc` or `realloc`: do calloc as malloc under
   the lock and fill after it, and for large reallocs do malloc and free under
   the lock with the copy between them. Filling outside the lock is safe
   because taking the lock refreshed the thread.

2. **Refresh at the scheduler handoff too.** A MultiThread task can allocate a
   `Vec` on worker A, yield, resume on worker B, and write into the existing
   capacity without entering the allocator on B. A blocking closure built on
   one thread runs on another. So a task poll or a blocking closure start
   refreshes when another thread has seen a larger memory, on the schedulers
   napi drives: napi-async-runtime's task and `block_on` polls and blocking
   closures, every `AsyncRuntimeTask` poll, `AsyncTask` compute, the task polls
   of napi's own multi-thread Tokio runtime, and the closures given to napi's
   `spawn_blocking`. A runtime passed to `create_custom_tokio_runtime` and
   direct `tokio::task::spawn_blocking` calls get no refresh (see "What it does
   not cover" in [wasi.md](./wasi.md)).
3. **`memory.grow(0)`, not `memory.size`.** Only a grow updates the thread's
   size (see "Mechanism").
4. **Use the memory the loader created before growing it.** wasi-libc's `sbrk`
   starts at `memory.size`, the loader's initial memory, which the addon's
   `napi.wasm.initialMemory` sets. The pages below it are the reserve. The
   break starts at `__heap_end` (the end of the module's own initial memory)
   instead, so the heap uses the reserve before any thread grows the memory,
   and those pages are current on every thread from instantiation. With a
   loader memory of 1 GiB (16384 pages) and a module whose own memory ends at
   64 MiB, the heap uses about 960 MiB before anything grows:

   ```
   wasi-libc: [stack+data 64 MiB][ unused 960 MiB ][ heap, grows from 1 GiB ][ 2^31 ]
   break:     [stack+data 64 MiB][ heap, no growth up to ~960 MiB ][ grows, 16 MiB if it can ][ 2^31 ]
   ```

   Past the reserve, a grow first tries 16 MiB, or the request if it is
   larger, capped by the room left below 2^31. When that grow fails, it retries
   with exactly the pages the request needs, so a grow can be as small as one
   page.

   The break never passes 2^31: Node's `node:wasi` (v24 and later) answers
   `EINVAL` (os error 28) to `clock_time_get` and `fd_seek` when a pointer is at
   or above it, so an allocation that would cross it fails instead. In the
   example that gives about 1.94 GiB of heap, where wasi-libc's own `sbrk` gave
   about 1 GiB.

5. **The allocator exports JS calls must be the locked ones.** `@emnapi/core`
   calls the module's `malloc` / `free` exports, and under `--wrap=malloc` the
   `--export=malloc` link argument names `__wrap_malloc`, so the module has no
   export called `malloc`. napi-build links a small object whose `malloc` /
   `free` exports forward to `__wrap_malloc` / `__wrap_free`. The exports must
   forward to the wrappers: a wrong forward loads and runs without the lock.
6. **Threaded build only.** The threadless `wasm32-wasip1` build has one thread
   and never sees a stale size; native builds are untouched.

## Rejected alternatives

- **A bigger loader `initial`, or pre-growing through dlmalloc.** A bigger
  `initial` does nothing on its own: wasi-libc's `sbrk` starts at the top of
  memory. Pre-growing through dlmalloc passes only until a load outgrows it.
  The break (principle 4) uses the loader's pages without allocating them.
- **Link the module's initial memory to the loader's** (`--initial-memory` =
  the loader's size). Same effect on growth, but a loader or host that passes a
  smaller memory gets a `LinkError`.
- **`memory.size` as the refresh.** It does not reload V8's bounds
  (principle 3).
- **Refresh on the emnapi / JS side.** The traps are inside wasm activations
  that never return to JS, so a JS-side refresh never runs on the trapping
  thread.
- **`--liftoff-only`.** Makes the trap rare, not impossible, and removes the
  MultiThread speedup.
- **Refresh before the allocation, inside dlmalloc's own lock.** Failed every
  run under `--wasm-enforce-bounds-checks`, always on the same dlmalloc
  chunk-header store: the waiter takes dlmalloc's lock before the grower
  publishes (principle 1).
- **Replace the allocator in Rust** (a `#[global_allocator]` over
  dlmalloc-rs). It leaves emnapi's and wasi-libc's C allocations on libc's
  dlmalloc, the same heap.
- **Host-driven worker loops** (a hosted event loop, or a JS-resident loop).
  They refresh only between tasks, where the handoff refresh already runs; the
  traps are mid-task.
- **Stop the world on grow** (the grower waits until every thread refreshed).
  A thread asleep in a std `Mutex` / `Condvar` futex wait cannot acknowledge.
  It can deadlock: the grower holds the allocator lock and waits on T1, T1
  waits on a mutex held by T2, T2 spins on the allocator lock. And one thread's
  crash would hang the whole process.

## Hosts without the trap handler

There plain loads and stores are checked against the stale size too. Node's
bundled `trap-handler.h` (v24.12.0, V8 `13.6-lkgr`) supports x64 on Linux,
Windows, macOS and FreeBSD; arm64 on Linux, Windows and macOS; loong64 and
riscv64 on Linux. v22 has arm64 on macOS and Linux only, v20 macOS only. Node's
`src/node.cc` installs it only on `__APPLE__ || __linux__ || _WIN32`, and not
under `--disable-wasm-trap-handler`. Node has no runtime check for it.

| Official Node build        | Handler       |
| -------------------------- | ------------- |
| darwin x64 / arm64         | yes           |
| linux-x64, win-x64         | yes           |
| linux-arm64                | Node 22+ only |
| win-arm64                  | Node 24+ only |
| linux-ppc64le              | no            |
| linux-s390x                | no            |
| aix-ppc64                  | no            |
| linux-armv7l (Node 20, 22) | no            |
| win-x86 (Node 20, 22)      | no            |

On any host, an addon's root loader takes the WASI path in four ways:

- on its own, when the native binding is missing or fails to load (so by
  default on a build marked "no" that the addon ships no native binding for);
- `NAPI_RS_FORCE_WASI=true`: WASI first, native still the fallback;
- `NAPI_RS_FORCE_WASI=error`: WASI required, no native fallback;
- `NAPI_RS_WASI_FLAVOR=wasm32-wasi`: exactly the threaded flavor, no other
  flavor and no native fallback.

The first three try the threaded flavor before the threadless one (see
"Selecting a WASI flavor in Node.js" in [wasi.md](./wasi.md)).

## A block delivered mid-poll

Thread A grows, allocates a block in the new pages and hands it to thread B
inside one poll; B fills, copies or uses atomics on it before its next refresh
point. Every allocator call refreshes, and so does every task poll and blocking
closure start on the schedulers principle 2 lists, plus V8's own points (see
"What refreshes a stale thread"). The paths that deliver a block inside one
poll:

| delivery path                                                                     | covered?                                                                                                                                                                                                        |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Arc` / `Mutex` / `DashMap` / runtime queue reads                                 | no hook                                                                                                                                                                                                         |
| async-channel, async-broadcast, oneshot, std `mpsc`, value ready in the same poll | no                                                                                                                                                                                                              |
| `spawn_blocking` results                                                          | yes when the waiting task runs on napi-async-runtime or napi's own multi-thread Tokio runtime: it is polled again, and the poll refreshes; no when it runs on a runtime passed to `create_custom_tokio_runtime` |
| threadsafe-function call to JS                                                    | yes: emnapi runs JS frames before it calls back into the module; only its own C read of the queue node is open, on hosts without the trap handler                                                               |

A grow happens only once the heap passes the loader's reserve, so the window is
rare, not closed. When it fires the worker traps and dies. A lock it held stays
held, and every other thread that allocates spins on it, which can hang the
process; "Shutdown polls never wait" in [wasi.md](./wasi.md) describes the
crash flag that lets the loader report the crash instead of hanging in its
cleanup.

**Not measured:** x64, Linux and Windows hosts, real hosts without the
handler, and browsers. The flag runs used `--wasm-enforce-bounds-checks` and
`--disable-wasm-trap-handler` on macOS arm64.

## Unresolved questions

- **Grow early by a margin.** Computing the grow from `new_brk + MARGIN`
  (16-64 MiB) in napi's `__wrap_sbrk` would keep the block that triggers a grow
  in pages every thread already knows, closing most of the mid-poll window.
  Cost: the memory runs MARGIN ahead of the break (commit charge on Windows).
  Not built.

## When to remove

When every Node version an addon's threaded WASI package supports ships
[v8/v8@34241014663390c72e08c123faef6fedf395be8e](https://github.com/v8/v8/commit/34241014663390c72e08c123faef6fedf395be8e)
(or a backport), the workaround can go: out of napi-rs, or out of one addon
with `--cfg napi_wasi_no_heap_sync` (see "Opting out" in [wasi.md](./wasi.md)).
Confirm it on each of those Node versions with the recipe in
`examples/wasi-heap-sync/README.md`: build opted out, then
`node stress.mjs --opted-out`.

The heap break goes with it. The heap then starts again at the top of the
loader's reserve, so with the 1 GiB example it has about 1 GiB below 2^31
instead of about 1.94 GiB, until Node accepts WASI pointers at or above 2^31.
