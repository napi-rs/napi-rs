'use strict'

// Worker for `broken-hierarchy.spec.ts` (issue #1164): require the broken
// fixture addon and report whether it loaded or threw. A broken hierarchy makes
// `napi_register_module_v1` throw, so `require` throws synchronously; we report
// the message back so the test can assert BOTH concurrent workers failed fast.
const { workerData, parentPort } = require('node:worker_threads')

try {
  require(workerData.nodePath)
  parentPort.postMessage({ loaded: true })
} catch (err) {
  parentPort.postMessage({
    loaded: false,
    message: err && err.message ? String(err.message) : String(err),
  })
}
