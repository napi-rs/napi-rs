import test from 'ava'

import {
  FinalizeBase,
  FinalizeSub,
  readFinalizeCounters,
  resetFinalizeCounters,
} from '../index.cjs'

// The deferred #1164 GC test, landed with deterministic NATIVE atomic counters
// rather than a bare `global.gc()` timing assumption. Each fixture increments a
// Rust `AtomicU32` in `ObjectFinalize::finalize` (parent only) and in `Drop`
// (parent and child); `readFinalizeCounters()` exposes them. See
// `examples/napi/src/inheritance_finalize.rs`.
//
// Finalizer callbacks run on GC, but napi may defer the callback to a later
// tick, so we drive several GC + macrotask cycles and poll the counters until
// the expected count is reached (or a bounded number of rounds elapse) rather
// than assuming one synchronous collection. Like every other GC test in this
// suite it is a no-op unless run with `--expose-gc`.
//
// `test.serial`: both tests share the same process-global native counters, so
// they must not run concurrently (ava runs a file's tests concurrently by
// default) or one test's collections would leak into the other's counts.
const gcTest = process.env.WASI_TEST ? test.skip : test.serial

async function drainGcUntil(
  predicate: () => boolean,
  rounds = 100,
): Promise<void> {
  for (let round = 0; round < rounds && !predicate(); round += 1) {
    global.gc!()
    // yield to the macrotask queue so any napi finalizer scheduled onto the
    // loop gets a chance to run before the next GC.
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

gcTest(
  'a finalized child runs its own Drop and the embedded parent Drop, but never the parent ObjectFinalize',
  async (t) => {
    if (typeof global.gc !== 'function') {
      t.pass(
        'GC not exposed (run with --expose-gc); skipping the finalize assertions',
      )
      return
    }

    resetFinalizeCounters()

    const total = 40
    // Create `total` children in an inner scope and drop every reference, so
    // they become collectible once the scope returns.
    ;(() => {
      const held: FinalizeSub[] = []
      for (let i = 0; i < total; i += 1) {
        held.push(FinalizeSub.create(i, i * 10))
      }
      // sanity: the child sees its own field AND the inherited parent getter.
      t.is(held[0].extra, 0)
      t.is(held[0].value, 0) // inherited from FinalizeBase
      held.length = 0
    })()

    await drainGcUntil(() => readFinalizeCounters().subDrop >= total)

    const counters = readFinalizeCounters()
    t.is(counters.subDrop, total, 'each child ran its own Drop exactly once')
    t.is(
      counters.baseDrop,
      total,
      'the embedded parent Drop ran exactly once per child, via the child Drop glue',
    )
    t.is(
      counters.baseFinalize,
      0,
      'the parent custom ObjectFinalize is NOT chained when a child is finalized',
    )
  },
)

gcTest(
  'a finalized parent runs BOTH its custom ObjectFinalize and its Drop, exactly once each',
  async (t) => {
    if (typeof global.gc !== 'function') {
      t.pass(
        'GC not exposed (run with --expose-gc); skipping the finalize assertions',
      )
      return
    }

    resetFinalizeCounters()

    const total = 30
    ;(() => {
      const held: FinalizeBase[] = []
      for (let i = 0; i < total; i += 1) {
        held.push(new FinalizeBase(i))
      }
      t.is(held[0].value, 0)
      held.length = 0
    })()

    await drainGcUntil(() => readFinalizeCounters().baseFinalize >= total)

    const counters = readFinalizeCounters()
    t.is(
      counters.baseFinalize,
      total,
      'each parent ran its custom ObjectFinalize once',
    )
    t.is(counters.baseDrop, total, 'each parent ran its Drop once')
    t.is(counters.subDrop, 0, 'no child was involved, so no child Drop ran')
  },
)
