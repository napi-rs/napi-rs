import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import test from 'ava'

import {
  issue3655RejectedCalls,
  issue3655RejectedCallsCalleeHandled,
} from '../index.cjs'

const __dirname = dirname(fileURLToPath(import.meta.url))

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
      // 5 would mean the queued payload was freed while Node-API still owned it.
      t.is(outcome.dropped, 4)
    })
  }
}

// A rejected payload is dropped by the call that rejected it. Its `Drop` is user
// code that can lock the same threadsafe function again, so it must run after
// the call has released its own lock. Before that, the call never returned, so
// the reproducer runs in a child process with a timeout.
test('a rejected payload can lock its threadsafe function when dropped', (t) => {
  const result = spawnSync(
    process.execPath,
    [join(__dirname, 'issue-3655-locking-drop.js')],
    { encoding: 'utf8', env: process.env, timeout: 60_000 },
  )
  const output = `${result.stdout}\n${result.stderr}`
  t.is(result.error, undefined, result.error?.stack)
  t.is(result.signal, null, output)
  t.is(result.status, 0, output)
  t.regex(result.stdout, /dropped 1 rejected payload/, output)
})
