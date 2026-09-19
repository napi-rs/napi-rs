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

// `asyncTaskIsExecuting` flips inside `compute`, which is strictly past the
// point where termination can still cancel the queued work — so `started`
// goes out only once teardown is guaranteed to interrupt a running task.
while (!native.asyncTaskIsExecuting()) {
  await new Promise((resolve) => setTimeout(resolve, 1))
}
parentPort.postMessage('started')
