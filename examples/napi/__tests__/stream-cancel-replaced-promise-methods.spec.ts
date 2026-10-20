import test from 'ava'

import { ClosableStreamRead } from '../index.cjs'

// These tests replace a `Promise.prototype` method, which every Promise in the process sees,
// so they live in their own file (ava runs each file in its own process) and run serially:
// while a method is replaced, no other test is reading a stream. Node.js runs microtasks
// right after each threadsafe-function call, but emnapi (WebAssembly) can run other queued
// calls first, and there the reads of tests running at the same time saw the replacement.

// A stream whose custom reader's `read()` never settles; `cancel` becomes `reader.cancel`.
function neverSettlingReader(cancel: (reason: unknown) => unknown) {
  let resolve!: () => void
  const pulled = new Promise<void>((r) => {
    resolve = r
  })
  const stream = new ReadableStream<Uint8Array>()
  ;(stream as unknown as { getReader: () => unknown }).getReader = () => ({
    read() {
      resolve()
      return new Promise(() => {})
    },
    cancel,
    releaseLock() {},
  })
  return { stream, pulled }
}

// Runs `method` of a `ClosableStreamRead` whose custom reader's `cancel` replaces
// `Promise.prototype[name]` with a function that throws, then returns `result()`. It is put
// back as soon as the native code that called `cancel` has followed what it returned:
// `close()` calls `cancel` inside itself, so the `finally` below puts it back; the queued
// cancel runs in a threadsafe-function call, and the microtask puts it back when that call
// returns.
async function cancelWhileReplaced(
  name: 'then' | 'catch',
  method: 'close' | 'closeQueued',
  result: () => unknown,
) {
  const prototype = Promise.prototype as unknown as Record<string, unknown>
  const original = prototype[name]
  const restore = () => {
    prototype[name] = original
  }
  const { stream, pulled } = neverSettlingReader(() => {
    prototype[name] = function () {
      throw new Error(`replaced ${name}`)
    }
    queueMicrotask(restore)
    return result()
  })
  const read = new ClosableStreamRead(stream)
  const done = read.readToEnd()
  await pulled
  let settled: Promise<string | null | undefined>
  try {
    settled = read[method]()
  } finally {
    restore()
  }
  return {
    outcome: await settled,
    chunks: await done,
    restored: prototype[name] === original,
  }
}

test.serial(
  'a replaced Promise.prototype.catch does not make a failed cancel unhandled',
  async (t) => {
    for (const method of ['close', 'closeQueued'] as const) {
      const { outcome, chunks, restored } = await cancelWhileReplaced(
        'catch',
        method,
        () => Promise.reject(new Error('source rejected')),
      )
      // Reporting 'replaced catch' would mean `catch` was used, and the rejection would be
      // unhandled (ava fails the run on those).
      t.is(outcome, 'source rejected', method)
      t.is(chunks, 0, method)
      t.true(restored, method)
    }
  },
)

test.serial(
  'a replaced Promise.prototype.then does not change how a cancel follows a native Promise',
  async (t) => {
    const cases: [string, () => unknown, string | null][] = [
      [
        'a rejected Promise',
        () => Promise.reject(new Error('source rejected')),
        'source rejected',
      ],
      [
        'a rejected Promise whose own then is undefined',
        () =>
          Object.assign(Promise.reject(new Error('source rejected')), {
            // oxlint-disable-next-line unicorn/no-thenable
            then: undefined,
          }),
        'source rejected',
      ],
      ['a fulfilled Promise', () => Promise.resolve(), null],
    ]
    for (const [label, result, error] of cases) {
      for (const method of ['close', 'closeQueued'] as const) {
        const { outcome, chunks, restored } = await cancelWhileReplaced(
          'then',
          method,
          result,
        )
        // Reporting 'replaced then' would mean `then` was looked up, and the Promise would
        // be left without handlers (ava fails the run on unhandled rejections).
        t.is(outcome, error, `${method}: ${label}`)
        t.is(chunks, 0, `${method}: ${label}`)
        t.true(restored, `${method}: ${label}`)
      }
    }
  },
)
