import { parentPort } from 'node:worker_threads'

import native from '../index.cjs'

// A mixed batch, none of it awaited: tasks that reject the moment `compute`
// runs on the pool thread, and tasks still computing when teardown begins.
// Both settle paths reach `napi_*_deferred` while the env is draining
// (napi-rs#3535).
native
  .asyncTaskRejectWithCapturedValue(new Error('reject during teardown'))
  // Settled before teardown, this rejection is real — just not the point here.
  .catch(() => {})
native.asyncTaskSignalWhenExecuting(300).catch(() => {})
native.withoutAbortController(1, 2).catch(() => {})
parentPort.postMessage('started')
