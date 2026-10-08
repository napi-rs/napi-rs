import test, { type ExecutionContext } from 'ava'

import {
  BorrowedCache,
  blockBorrowGate,
  borrowGateWaiters,
  closeBorrowGate,
  nestedZeroArgTask,
  openBorrowGate,
  REENTRY_GATE,
  readBorrowedCache,
  readBorrowedCacheAlias,
  readBorrowedCacheAsyncBlock,
  readBorrowedCacheMaybe,
  readBorrowedCacheMaybeResult,
  readBorrowedCacheSpawnInside,
  readBorrowedCacheVec,
  readBorrowedCacheWithReentry,
  readBorrowedCacheWithSignal,
  shutdownRuntime,
} from '../index.cjs'

// Regression coverage for napi-rs/napi-rs#3583: a synchronous `#[napi]`
// callback returning `AsyncTask` lets the task capture a `&T`/`&self` borrow
// of a `#[napi]` class argument. The generated borrow scope must root the
// JavaScript wrapper until the queued work settles; without the fix the
// wrapper can be garbage-collected — and its boxed Rust value freed — while
// `compute` still holds the pointer.

const isWasi = Boolean(process.env.WASI_TEST)

// Every gate-based test below serializes on the shared libuv pool: the
// saturation test blocks ~32 slots and a gate that never gets a pool thread
// wedges its task forever. Concurrent tests in this file can starve each
// other's slots — that is what "task did not start waiting on gate" was on
// WASI, where the emnapi pool can never run a second batch while the first
// saturator holds every worker. On WASI the waiter/gate observations are
// skipped entirely: the settle-only coverage below still exercises the claim
// → release path end to end.
const poolTest = isWasi ? test.serial.skip : test.serial

test.after(() => {
  shutdownRuntime()
})

async function getGc(): Promise<(() => void) | undefined> {
  const { setFlagsFromString } = await import('node:v8')
  const { runInNewContext } = await import('node:vm')
  // setFlagsFromString does not update the current context's global; the
  // exposed gc must be pulled out of a freshly created context.
  setFlagsFromString('--expose-gc')
  return runInNewContext('gc') as undefined | (() => void)
}

async function collect(gc: () => void, times = 10): Promise<void> {
  for (let i = 0; i < times; i++) {
    gc()
    // FinalizationRegistry callbacks and WeakRef clearing need a task turn.
    await new Promise((resolve) => setImmediate(resolve))
  }
}

// Poll until `count` tasks are blocked inside wait_borrow_gate — the only
// reliable signal that a pool thread has actually picked the work up.
async function waitForWaiters(gate: number, count: number): Promise<boolean> {
  for (let i = 0; i < 10000; i++) {
    if (borrowGateWaiters(gate) >= count) {
      return true
    }
    await new Promise((resolve) => setImmediate(resolve))
  }
  return false
}

// Wait until the waiter count stops growing — i.e. every thread the libuv
// pool is going to start has been started and is blocked. Requires three
// consecutive equal non-zero readings (one equal pair could coincide with a
// slow thread spawn) and exits early once the count reaches the known pool
// size.
async function waitForPoolSaturation(gate: number): Promise<number> {
  const poolSize = Number(process.env.UV_THREADPOOL_SIZE ?? 4)
  let last = -1
  let stable = 0
  for (let i = 0; i < 600; i++) {
    await new Promise((resolve) => setTimeout(resolve, 10))
    const waiters = borrowGateWaiters(gate)
    if (waiters > 0 && waiters === last) {
      if (++stable >= 3) {
        return waiters
      }
    } else {
      stable = 0
    }
    if (waiters >= poolSize) {
      return waiters
    }
    last = waiters
  }
  return last
}

// WASI-safe coverage: a borrowed argument keeps the wrapper rooted for a task
// that settles without any gate blocking, and the synchronous `None` arm never
// claims the scope at all.
test.serial(
  'borrowed &T AsyncTask settles and releases its scope (issue #3583)',
  async (t) => {
    const gate = 20
    openBorrowGate(gate)
    closeBorrowGate(gate)
    t.is(await readBorrowedCache(new BorrowedCache(256), gate), (255 * 256) / 2)
    t.is(await new BorrowedCache(4).readAsync(gate), 6)
    const vecPromise = readBorrowedCacheVec(new BorrowedCache(256), gate, gate)
    t.deepEqual(await Promise.all(vecPromise), [
      (255 * 256) / 2,
      (255 * 256) / 2,
    ])
    // The `None` arm releases the unclaimed scope in place: no roots, no lease.
    t.is(readBorrowedCacheMaybe(new BorrowedCache(8), 99, true), null)
  },
)

poolTest(
  'borrowed &T argument stays rooted while its AsyncTask is running (issue #3583)',
  async (t) => {
    const gc = await getGc()
    if (!gc) {
      t.pass('GC not exposed (run with --expose-gc), skipping test')
      return
    }

    const gate = 1
    openBorrowGate(gate)
    const registry = new FinalizationRegistry<number>((held) => {
      finalized.add(held)
    })
    const finalized = new Set<number>()

    const checksum = (() => {
      const cache = new BorrowedCache(256)
      registry.register(cache, 1)
      // expected checksum of bytes 0..255
      const promise = readBorrowedCache(cache, gate)
      return { promise, expected: (255 * 256) / 2 }
    })()

    // The task must be in-flight (blocked on the gate) before GC; without
    // rooting the wrapper would be collected here and the Box freed under it.
    try {
      t.true(
        await waitForWaiters(gate, 1),
        'task did not start waiting on gate',
      )
      await collect(gc)
      t.false(
        finalized.has(1),
        'wrapper was collected while async work held its borrow',
      )
    } finally {
      closeBorrowGate(gate)
    }
    t.is(await checksum.promise, checksum.expected)

    // Once the work settles the roots are released exactly once; nothing else
    // may keep the wrapper alive.
    await collect(gc)
    t.true(
      finalized.has(1),
      'wrapper was never collected after async work settled',
    )
  },
)

poolTest(
  '&self receiver stays rooted while its AsyncTask is running (issue #3583)',
  async (t) => {
    const gc = await getGc()
    if (!gc) {
      t.pass('GC not exposed (run with --expose-gc), skipping test')
      return
    }

    const gate = 2
    openBorrowGate(gate)
    const finalized = new Set<number>()
    const registry = new FinalizationRegistry<number>((held) => {
      finalized.add(held)
    })

    const promise = (() => {
      const cache = new BorrowedCache(4)
      registry.register(cache, 2)
      return cache.readAsync(gate)
    })()

    try {
      t.true(
        await waitForWaiters(gate, 1),
        'task did not start waiting on gate',
      )
      await collect(gc)
      t.false(
        finalized.has(2),
        'this wrapper was collected while async work held its borrow',
      )
    } finally {
      closeBorrowGate(gate)
    }
    t.is(await promise, 6)
    await collect(gc)
    t.true(
      finalized.has(2),
      'this wrapper was never collected after async work settled',
    )
  },
)

poolTest(
  'borrowed &T argument stays rooted while its AsyncTask is queued, including abort (issue #3583)',
  async (t) => {
    const gc = await getGc()
    if (!gc || typeof AbortController === 'undefined') {
      t.pass('GC or AbortController not exposed, skipping test')
      return
    }

    const saturatorGate = 3
    const queuedGate = 4
    const abortGate = 5
    openBorrowGate(saturatorGate)
    openBorrowGate(queuedGate)
    openBorrowGate(abortGate)
    const finalized = new Set<number>()
    const registry = new FinalizationRegistry<number>((held) => {
      finalized.add(held)
    })

    // Occupy the whole libuv pool so the tasks queued afterwards are known to
    // be *queued* — the only state in which napi_cancel_async_work can take.
    const saturators: Promise<unknown>[] = []
    for (let i = 0; i < 32; i++) {
      saturators.push(blockBorrowGate(saturatorGate))
    }
    const running = await waitForPoolSaturation(saturatorGate)
    if (running <= 0) {
      closeBorrowGate(saturatorGate)
      await Promise.all(saturators)
      t.pass(
        'saturating tasks never started; cannot deterministically queue the target',
      )
      return
    }

    const pending: Promise<unknown>[] = [...saturators]
    let queuedPromise: Promise<number> | undefined
    const ctrl = new AbortController()
    try {
      const queued = (() => {
        const cache = new BorrowedCache(256)
        registry.register(cache, 3)
        return { promise: readBorrowedCache(cache, queuedGate) }
      })()
      queuedPromise = queued.promise
      pending.push(queued.promise)
      const aborted = (() => {
        const cache = new BorrowedCache(256)
        registry.register(cache, 4)
        return {
          promise: readBorrowedCacheWithSignal(cache, abortGate, ctrl.signal),
        }
      })()
      pending.push(aborted.promise)

      // If the pool is larger than the saturator count the aborted task may have
      // started before ctrl.abort(); it then settles normally instead of
      // AbortError — still a valid settle path for the scope. Closing the abort
      // gate right after abort() lets a task that slipped past the cancellation
      // complete instead of blocking forever on wait_borrow_gate.
      const settled = aborted.promise.then(
        (v) => ({ kind: 'resolved' as const, value: v }),
        (err) => ({ kind: 'rejected' as const, err }),
      )
      ctrl.abort()
      closeBorrowGate(abortGate)
      const outcome = await settled
      if (outcome.kind === 'resolved') {
        t.is(outcome.value, (255 * 256) / 2)
      } else {
        t.is((outcome.err as Error).message, 'AbortError')
      }

      // Queued and aborted-but-settled tasks must both release their roots:
      // neither wrapper is collectible while the queued one is still behind the
      // pool, and the aborted one frees its roots once its completion ran.
      await collect(gc)
      t.false(
        finalized.has(3),
        'wrapper was collected while its task was still queued',
      )
      t.true(
        finalized.has(4),
        'wrapper stayed rooted after the aborted task settled',
      )

      closeBorrowGate(saturatorGate)
      await Promise.all(saturators)
      closeBorrowGate(queuedGate)
      t.is(await queuedPromise, (255 * 256) / 2)
      await collect(gc)
      t.true(
        finalized.has(3),
        'wrapper was never collected after the queued task settled',
      )
    } finally {
      // Gate closes are idempotent; make sure no assertion failure can leave a
      // libuv pool thread wedged inside wait_borrow_gate.
      closeBorrowGate(saturatorGate)
      closeBorrowGate(queuedGate)
      closeBorrowGate(abortGate)
      await Promise.allSettled(pending)
    }
  },
)

poolTest(
  'a future spawned inside the callback body cannot claim the deferred borrow scope (issue #3583)',
  async (t) => {
    const gc = await getGc()
    if (!gc) {
      t.pass('GC not exposed (run with --expose-gc), skipping test')
      return
    }

    const gate = 6
    openBorrowGate(gate)
    const finalized = new Set<number>()
    const registry = new FinalizationRegistry<number>((held) => {
      finalized.add(held)
    })

    const promise = (() => {
      const cache = new BorrowedCache(256)
      registry.register(cache, 5)
      // The env.spawn_future inside the callback drains after the native call
      // only; the deferred scope belongs to the returned task.
      return readBorrowedCacheSpawnInside(cache, gate)
    })()

    try {
      t.true(
        await waitForWaiters(gate, 1),
        'task did not start waiting on gate',
      )
      await collect(gc)
      t.false(
        finalized.has(5),
        'wrapper was collected while its task was still running',
      )
    } finally {
      closeBorrowGate(gate)
    }
    t.is(await promise, (255 * 256) / 2)
    await collect(gc)
    t.true(
      finalized.has(5),
      'wrapper was never collected after the task settled',
    )
  },
)

poolTest(
  'borrowed &T argument stays rooted while its AsyncBlock is running (issue #3583)',
  async (t) => {
    const gc = await getGc()
    if (!gc) {
      t.pass('GC not exposed (run with --expose-gc), skipping test')
      return
    }

    const gate = 7
    openBorrowGate(gate)
    const finalized = new Set<number>()
    const registry = new FinalizationRegistry<number>((held) => {
      finalized.add(held)
    })

    const promise = (() => {
      const cache = new BorrowedCache(256)
      registry.register(cache, 6)
      return readBorrowedCacheAsyncBlock(cache, gate)
    })()

    try {
      t.true(
        await waitForWaiters(gate, 1),
        'async block did not start waiting on gate',
      )
      await collect(gc)
      t.false(
        finalized.has(6),
        'wrapper was collected while its async block was still running',
      )
    } finally {
      closeBorrowGate(gate)
    }
    t.is(await promise, (255 * 256) / 2)
    await collect(gc)
    t.true(
      finalized.has(6),
      'wrapper was never collected after the async block settled',
    )
  },
)

// The remaining tests cover return-type spellings that no syntactic check on
// the declared signature can recognize as async work: Option/Result wrappers
// and a type alias. Rooting is claimed lazily inside the AsyncTask conversion
// itself, so all of them must protect the borrow exactly like the plain
// `AsyncTask` return above.
async function expectRootedWhileTaskRuns(
  t: ExecutionContext,
  gc: () => void,
  gate: number,
  held: number,
  call: (cache: BorrowedCache, gate: number) => Promise<number>,
): Promise<void> {
  openBorrowGate(gate)
  const finalized = new Set<number>()
  const registry = new FinalizationRegistry<number>((key) => {
    finalized.add(key)
  })

  const promise = (() => {
    const cache = new BorrowedCache(256)
    registry.register(cache, held)
    return call(cache, gate)
  })()

  try {
    t.true(await waitForWaiters(gate, 1), 'task did not start waiting on gate')
    await collect(gc)
    t.false(
      finalized.has(held),
      'wrapper was collected while async work held its borrow',
    )
  } finally {
    closeBorrowGate(gate)
  }
  t.is(await promise, (255 * 256) / 2)
  await collect(gc)
  t.true(
    finalized.has(held),
    'wrapper was never collected after async work settled',
  )
}

poolTest(
  'Option<AsyncTask> return keeps the borrowed &T rooted (issue #3583)',
  async (t) => {
    const gc = await getGc()
    if (!gc) {
      t.pass('GC not exposed (run with --expose-gc), skipping test')
      return
    }
    // The `None` arm releases the scope in place: no roots, no claim.
    t.is(readBorrowedCacheMaybe(new BorrowedCache(8), 99, true), null)
    await expectRootedWhileTaskRuns(t, gc, 8, 7, (cache, gate) => {
      const promise = readBorrowedCacheMaybe(cache, gate, false)
      if (promise === null) {
        throw new Error('expected a task promise')
      }
      return promise
    })
  },
)

poolTest(
  'Result<Option<AsyncTask>> return keeps the borrowed &T rooted (issue #3583)',
  async (t) => {
    const gc = await getGc()
    if (!gc) {
      t.pass('GC not exposed (run with --expose-gc), skipping test')
      return
    }
    await expectRootedWhileTaskRuns(t, gc, 9, 8, (cache, gate) => {
      const promise = readBorrowedCacheMaybeResult(cache, gate)
      if (promise === null) {
        throw new Error('expected a task promise')
      }
      return promise
    })
  },
)

poolTest(
  'type-alias AsyncTask return keeps the borrowed &T rooted (issue #3583)',
  async (t) => {
    const gc = await getGc()
    if (!gc) {
      t.pass('GC not exposed (run with --expose-gc), skipping test')
      return
    }
    await expectRootedWhileTaskRuns(t, gc, 10, 9, (cache, gate) =>
      readBorrowedCacheAlias(cache, gate),
    )
  },
)

// The single-consumer regression: a `Vec<AsyncTask>` return leases the same
// deferred scope once per element. The first task settling must NOT release
// the roots while the second task is still blocked — under pop-claiming the
// second element claimed nothing and the first settle dropped the only scope.
poolTest(
  'Vec<AsyncTask> return keeps the borrowed &T rooted until every task settles (issue #3583)',
  async (t) => {
    const gc = await getGc()
    if (!gc) {
      t.pass('GC not exposed (run with --expose-gc), skipping test')
      return
    }

    const gateFast = 11
    const gateSlow = 12
    openBorrowGate(gateFast)
    openBorrowGate(gateSlow)
    const finalized = new Set<number>()
    const registry = new FinalizationRegistry<number>((held) => {
      finalized.add(held)
    })

    const promises = (() => {
      const cache = new BorrowedCache(256)
      registry.register(cache, 10)
      return readBorrowedCacheVec(cache, gateFast, gateSlow)
    })()

    // Both tasks in-flight: GC must not collect the wrapper while either holds
    // the borrow.
    try {
      t.true(
        await waitForWaiters(gateFast, 1),
        'first task did not start waiting',
      )
      t.true(
        await waitForWaiters(gateSlow, 1),
        'second task did not start waiting',
      )
      await collect(gc)
      t.false(
        finalized.has(10),
        'wrapper was collected while both tasks held its borrow',
      )

      // The first task settles while the second is still running. The scope's
      // roots must survive past this settle — this is the use-after-free window
      // the single-consumer claim had.
      closeBorrowGate(gateFast)
      t.is(await promises[0], (255 * 256) / 2)
      await collect(gc)
      t.false(
        finalized.has(10),
        'wrapper was collected after the first task settled while the second still ran',
      )
    } finally {
      // Gate closes are idempotent; a failure above must not leave a pool
      // thread wedged in wait_borrow_gate.
      closeBorrowGate(gateFast)
      closeBorrowGate(gateSlow)
    }
    t.is(await promises[1], (255 * 256) / 2)
    await collect(gc)
    t.true(
      finalized.has(10),
      'wrapper was never collected after both tasks settled',
    )
  },
)

// The zero-argument fast path emits no scope and no defer of its own. A nested
// `#[napi]` callback invoked while the outer callback's return value is still
// converting — the `Function` call inside `ReentryDuringConversion`'s
// `ToNapiValue` — must see an empty deferred stack. Without the
// `NativeBorrowBarrier` hiding it, the nested callback's `AsyncTask` claimed
// the OUTER scope and kept the outer wrapper rooted until it settled.
poolTest(
  'a nested zero-arg callback cannot claim the outer deferred scope (issue #3583)',
  async (t) => {
    const gc = await getGc()
    if (!gc) {
      t.pass('GC not exposed (run with --expose-gc), skipping test')
      return
    }

    openBorrowGate(REENTRY_GATE)
    const finalized = new Set<number>()
    const registry = new FinalizationRegistry<number>((held) => {
      finalized.add(held)
    })

    let nested: Promise<unknown> | undefined
    ;(() => {
      const cache = new BorrowedCache(256)
      registry.register(cache, 11)
      // JS re-entry during return-value conversion: `cb()` calls back into a
      // zero-argument `#[napi]` fn returning a gate-blocked `AsyncTask`.
      readBorrowedCacheWithReentry(cache, () => (nested = nestedZeroArgTask()))
    })()

    try {
      // The nested zero-arg task started and is blocked on its gate.
      t.true(await waitForWaiters(REENTRY_GATE, 1), 'nested task did not start')

      // The outer scope's conversion ended with no claim: the wrapper must be
      // collectible even though the nested task is still blocked. Under the bug
      // the nested task had claimed the outer scope and kept this rooted.
      await collect(gc)
      t.true(
        finalized.has(11),
        'outer wrapper stayed rooted by the nested task claiming its scope',
      )
    } finally {
      closeBorrowGate(REENTRY_GATE)
      // Await the nested task's settlement — a discarded promise would leave
      // the task unobserved (and unhandled on rejection).
      if (nested) {
        await nested
      }
    }
  },
)
