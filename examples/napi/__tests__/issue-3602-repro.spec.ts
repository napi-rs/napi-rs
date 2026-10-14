import test, { type ExecutionContext } from 'ava'

import {
  Issue3602Empty,
  Issue3602ThrowInCtor,
  Issue3602Tracked,
  issue3602EmptyCreated,
  issue3602EmptyDropped,
  issue3602ThrowInCtorDropped,
  issue3602TrackedCreated,
  issue3602TrackedDropped,
} from '../index.cjs'

// Regression coverage for napi-rs/napi-rs#3602: when `napi_wrap` fails in a
// `#[napi]` constructor or factory, the Rust value was never adopted by a
// finalizer and leaked. It must be dropped on the error path instead, which
// happens synchronously, so the drop counters show it without any GC.
// These tests cover the Rust value only. The 32-byte finalize-callbacks `Arc`
// that also leaked is not visible from JS, so they do not cover it.

type NapiError = Error & { code?: string }

interface Counters {
  created: () => number
  dropped: () => number
}

const tracked: Counters = {
  created: issue3602TrackedCreated,
  dropped: issue3602TrackedDropped,
}

const empty: Counters = {
  created: issue3602EmptyCreated,
  dropped: issue3602EmptyDropped,
}

const CALLS = 10

// Each call must create exactly one Rust value, fail in `napi_wrap`, and drop
// that value before it returns. If a later change rejects these receivers
// before the Rust code runs (for example a fix for #3608), this fails on
// purpose: the trigger no longer reaches `napi_wrap` and must be replaced.
function assertFailedWrapDrops(
  t: ExecutionContext,
  counters: Counters,
  trigger: () => unknown,
  wrapErrorMessage: string,
) {
  for (let i = 0; i < CALLS; i++) {
    const createdBefore = counters.created()
    const droppedBefore = counters.dropped()
    const error = t.throws<NapiError>(trigger)
    t.is(counters.created() - createdBefore, 1)
    t.is(counters.dropped() - droppedBefore, 1)
    t.is(error?.code, 'InvalidArg')
    t.is(error?.message, wrapErrorMessage)
  }
}

test.serial(
  'constructor returning with a pending exception drops the value',
  (t) => {
    const before = issue3602ThrowInCtorDropped()
    for (let i = 0; i < CALLS; i++) {
      t.throws(() => new Issue3602ThrowInCtor(), {
        message: 'issue3602 pending exception',
      })
    }
    t.is(issue3602ThrowInCtorDropped() - before, CALLS)
  },
)

const constructorCalls = [
  [
    'Function.prototype.call',
    (Klass: Function, receiver: object) => Klass.call(receiver),
  ],
  [
    'Reflect.apply',
    (Klass: Function, receiver: object) => Reflect.apply(Klass, receiver, []),
  ],
] as const

for (const [name, callWith] of constructorCalls) {
  test.serial(
    `constructor called on a wrapped object via ${name} drops the value`,
    (t) => {
      const existing = new Issue3602Tracked()
      const { id } = existing
      assertFailedWrapDrops(
        t,
        tracked,
        () => callWith(Issue3602Tracked, existing),
        'Failed to initialize class `constructor`',
      )
      // The existing wrap is untouched; the counters above also show that the
      // existing value was not dropped.
      t.is(existing.id, id)
      t.is(existing.size, 1024)
    },
  )

  test.serial(
    `empty class constructor called on a wrapped object via ${name} drops the value`,
    (t) => {
      const existing = new Issue3602Empty()
      assertFailedWrapDrops(
        t,
        empty,
        () => callWith(Issue3602Empty, existing),
        'Failed to initialize class `constructor`',
      )
      t.true(existing.ping())
    },
  )
}

test.serial(
  'factory whose `this` returns a wrapped object drops the value',
  (t) => {
    const existing = new Issue3602Tracked()
    const { id } = existing
    assertFailedWrapDrops(
      t,
      tracked,
      // Must be a constructible function: the factory runs `new this()`.
      () =>
        Issue3602Tracked.create.call(function () {
          return existing
        }),
      'Failed to initialize class `create`',
    )
    // Still the constructor's value (1024), not one of the factory's (2048).
    t.is(existing.id, id)
    t.is(existing.size, 1024)
  },
)

test.serial(
  'empty class factory whose `this` returns a wrapped object drops the value',
  (t) => {
    const existing = new Issue3602Empty()
    assertFailedWrapDrops(
      t,
      empty,
      () =>
        Issue3602Empty.create.call(function () {
          return existing
        }),
      'Failed to initialize class `create`',
    )
    t.true(existing.ping())
  },
)

test.serial('successful construction is not dropped eagerly', (t) => {
  const trackedDropped = issue3602TrackedDropped()
  const fromNew = new Issue3602Tracked()
  const fromFactory = Issue3602Tracked.create()
  t.true(fromNew instanceof Issue3602Tracked)
  t.true(fromFactory instanceof Issue3602Tracked)
  t.is(fromNew.size, 1024)
  t.is(fromFactory.size, 2048)
  t.is(issue3602TrackedDropped(), trackedDropped)

  const emptyDropped = issue3602EmptyDropped()
  const emptyFromNew = new Issue3602Empty()
  const emptyFromFactory = Issue3602Empty.create()
  t.true(emptyFromNew instanceof Issue3602Empty)
  t.true(emptyFromFactory instanceof Issue3602Empty)
  t.true(emptyFromNew.ping())
  t.true(emptyFromFactory.ping())
  t.is(issue3602EmptyDropped(), emptyDropped)
})
