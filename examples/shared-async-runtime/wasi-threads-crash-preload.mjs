// Preload (`node --import`) for test-wasi-threads-crash.mjs. The generated
// threaded loader passes this process's execArgv on to its pool workers, so
// this module runs in each of them too, before wasi-worker.mjs.
//
// NAPI_RS_TEST_FAIL_WORKER=<threadId>: in that worker, the wasm instantiation
// waits NAPI_RS_TEST_FAIL_DELAY_MS, then throws. The worker then fails while it
// loads: its wasm thread never starts, although the thread spawn that created
// it returned long ago, and it has no instance to call into.
//
// NAPI_RS_TEST_DROP_ADDON_CRASH_FLAG=1: every worker drops the view of the
// addon's crash flag the loader passed it, as a worker without that bridge
// would have none.

import { writeSync } from 'node:fs'
import { isMainThread, threadId, workerData } from 'node:worker_threads'

// A worker's process.stderr goes through the loader thread, which is blocked
// in wasm or already exiting: write to the file descriptor directly.
const log = (line) => writeSync(2, `${line}\n`)

if (!isMainThread && workerData && workerData.crashFlag instanceof Int32Array) {
  const view = workerData.addonCrashFlag
  if (process.env.NAPI_RS_TEST_DROP_ADDON_CRASH_FLAG === '1') {
    delete workerData.addonCrashFlag
  }
  if (threadId === Number(process.env.NAPI_RS_TEST_FAIL_WORKER)) {
    const delay = Number(process.env.NAPI_RS_TEST_FAIL_DELAY_MS ?? 500)
    const { Instance } = WebAssembly
    WebAssembly.Instance = function () {
      log(
        `worker ${threadId}: addon crash flag view ${
          view instanceof Int32Array ? `at ${view.byteOffset}` : 'missing'
        }${workerData.addonCrashFlag === undefined ? ', dropped' : ''}`,
      )
      // Late enough that the loader thread is already waiting in wasm.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delay)
      log(`worker ${threadId}: failing its wasm load`)
      throw new Error(`napi-rs test: worker ${threadId} failed to load`)
    }
    WebAssembly.Instance.prototype = Instance.prototype
  }
}
