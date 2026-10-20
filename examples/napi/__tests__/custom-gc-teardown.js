import { createRequire } from 'node:module'
import { Worker } from 'node:worker_threads'

const require = createRequire(import.meta.url)
const native = require('../index.cjs')

// Each worker leaves three `FunctionRef`s on a plain thread, which drops them
// during the worker's env teardown, after Node has closed the custom-GC
// threadsafe function they are released through. Before the fix, the first
// drop got `napi_closing` and used up the function's only thread count, the
// others got `napi_invalid_arg`, `FunctionRef::drop` panicked on it, and the
// second panic (same `Vec` drop) aborted the process.
for (let i = 0; i < 3; i++) {
  const worker = new Worker(
    new URL('./custom-gc-teardown-worker.js', import.meta.url),
    { env: process.env },
  )
  await new Promise((resolve, reject) => {
    worker.once('exit', resolve)
    worker.once('error', reject)
  })
}
console.log(
  `dropped ${native.functionRefsDroppedAtTeardown()} function references during worker teardown`,
)
