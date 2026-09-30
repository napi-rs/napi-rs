# napi-build

<a href="https://docs.rs/crate/napi-build"><img src="https://docs.rs/napi-build/badge.svg"></img></a>
<a href="https://crates.io/crates/napi-build"><img src="https://img.shields.io/crates/v/napi-build.svg"></img></a>
<a href="https://discord.gg/SpWzYHsKHs">
<img src="https://img.shields.io/discord/874290842444111882.svg?logo=discord&style=flat-square"
    alt="chat" />
</a>

> Build support for napi-rs

Setup `N-API` build in your `build.rs`:

```rust
extern crate napi_build;

fn main() {
    napi_build::setup();
}
```

## wasm32-wasip1-threads allocator lock

On `wasm32-wasip1-threads`, V8 keeps a stale memory size on a thread that did
not grow the shared memory itself, so `memory.fill` / `memory.copy` (and, on
hosts without V8's wasm trap handler, any access) on heap pages another thread
grew can trap with "memory access out of bounds". `napi` works around it in the
allocator: one lock around every call into wasi-libc's allocator, and a refresh
of the thread's memory size under that lock.

`setup()` does the link side. With the `wasi-heap-sync` feature, and only for
the exact `wasm32-wasip1-threads` target, it passes `--wrap` for `malloc`,
`free`, `calloc`, `realloc`, `posix_memalign`, `aligned_alloc`,
`malloc_usable_size`, `__libc_malloc`, `__libc_free`, `__libc_calloc` and
`sbrk`, so every caller (Rust's `System`, wasi-libc, emnapi) reaches the
`__wrap_*` functions `napi` defines. It also links a small bundled wasm object
that keeps the `malloc` / `free` exports `@emnapi/core` calls pointed at the
wrapped entries (source: `src/wasi_heap_sync_exports.c`).

- The feature is off by default. `napi` turns it on through its
  build-dependency; an addon does not enable it by hand.
- Opt out with `--cfg napi_wasi_no_heap_sync` in the target rustflags, e.g.
  `RUSTFLAGS="--cfg napi_wasi_no_heap_sync"`. `napi-build` and `napi` both read
  it, and `setup()` declares it, so addon code can test it too.
- A `#[global_allocator]` is locked only when it ends in libc `malloc`, as
  std's `System` does. An allocator that calls `memory.grow` itself (the
  mimalloc WASI build, talc, lol_alloc, the `dlmalloc` crate) bypasses the lock.
