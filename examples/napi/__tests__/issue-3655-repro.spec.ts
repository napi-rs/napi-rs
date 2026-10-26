import test from 'ava'

import {
  issue3655RejectedCalls,
  issue3655RejectedCallsCalleeHandled,
} from '../index.cjs'

// Regression coverage for napi-rs/napi-rs#3655: when
// `napi_call_threadsafe_function` rejects a call (here `napi_queue_full` on a
// queue that holds one item), Node-API does not take the data, so the boxed
// call data and its payload must be dropped instead of leaked.

const apis = ['call', 'callWithReturnValue', 'callAsync', 'callAsyncCatch']

const variants = [
  ['CalleeHandled = false', issue3655RejectedCalls],
  ['CalleeHandled = true', issue3655RejectedCallsCalleeHandled],
] as const

for (const [variant, rejectedCalls] of variants) {
  for (const api of apis) {
    test(`${variant}: ${api} drops the payload when the queue is full`, (t) => {
      const outcome = rejectedCalls(() => {}, api)
      t.true(outcome.firstCallQueued)
      t.is(outcome.queueFull, 4)
      t.is(outcome.dropped, outcome.queueFull)
    })
  }
}
