import { parentPort } from 'node:worker_threads'

import native from '../index.cjs'

// A mixed batch, none of it awaited: one task resolving and one rejecting,
// each still inside `compute` when teardown begins. Both settle paths reach
// `napi_*_deferred` while the env is draining (napi-rs#3535).
native.asyncTaskSignalWhenExecuting(300).catch(() => {})
native.asyncTaskSignalWhenExecutingReject(300).catch(() => {})
native.withoutAbortController(1, 2).catch(() => {})

// The `isExecuting` flags flip inside `compute`, which is strictly past the
// point where termination can still cancel the queued work — so `started`
// goes out only once teardown is guaranteed to interrupt a running resolve
// and a running reject, not an already-settled one.
while (!native.asyncTaskIsExecuting() || !native.asyncTaskRejectIsExecuting()) {
  await new Promise((resolve) => setTimeout(resolve, 1))
}
parentPort.postMessage('started')
