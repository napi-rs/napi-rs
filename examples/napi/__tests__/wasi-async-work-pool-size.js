import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

// Drives the threaded WASI loader through one async export so emnapi actually
// builds its in-wasm libuv threadpool. The pool is created lazily, on the
// first async-work submission, and `abort()`s the whole module when a thread
// cannot be created — so an unusable `NAPI_RS_ASYNC_WORK_POOL_SIZE` surfaces
// here as `RuntimeError: unreachable`, not as a merely wrong number.
const require = createRequire(import.meta.url)
const binding = require('../example.wasi.cjs')

// Each pool thread reserves 8 MiB of linear memory for its stack (wasi-libc's
// default thread stack), so the growth across the first async call is a proxy
// for the pool size the loader actually asked for.
const THREAD_STACK_BYTES = 8 * 1024 * 1024
const MAX_EXPECTED_THREADS = 8

const before = binding.wasmMemorySizeBytes()
const sum = await binding.withoutAbortController(1, 2)
assert.equal(sum, 3)
const grown = binding.wasmMemorySizeBytes() - before
assert.ok(
  grown <= MAX_EXPECTED_THREADS * THREAD_STACK_BYTES,
  `async work pool grew linear memory by ${grown} bytes, more than ${MAX_EXPECTED_THREADS} threads' worth`,
)

process.stdout.write(`async work pool size accepted: grew ${grown} bytes\n`)
