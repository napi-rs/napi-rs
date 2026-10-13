import test from 'ava'

import {
  Issue3600Empty,
  Issue3600Tracked,
  issue3600EmptyDropped,
  issue3600EmptyInstances,
  issue3600PendingEmptyIntoInstance,
  issue3600PendingEmptyIntoReference,
  issue3600PendingEmptyReturn,
  issue3600PendingIntoInstance,
  issue3600PendingIntoReference,
  issue3600PendingReturn,
  issue3600TrackedDropped,
} from '../index.cjs'

// Regression coverage for napi-rs/napi-rs#3600: a class conversion that fails
// because a JavaScript exception is already pending must drop the moved Rust
// value (it was never adopted by a finalizer) and must reset the factory flag,
// otherwise every later JS `new` of a `#[napi]` class skips its constructor.

const conversions = [
  ['into_instance', issue3600PendingIntoInstance],
  ['into_reference', issue3600PendingIntoReference],
  ['ToNapiValue', issue3600PendingReturn],
] as const

const emptyConversions = [
  ['into_instance', issue3600PendingEmptyIntoInstance],
  ['into_reference', issue3600PendingEmptyIntoReference],
  ['ToNapiValue', issue3600PendingEmptyReturn],
] as const

for (const [name, convert] of conversions) {
  test.serial(
    `failed ${name} drops the value and resets the factory flag`,
    (t) => {
      const before = issue3600TrackedDropped()
      for (let i = 0; i < 10; i++) {
        t.throws(() => convert(), { message: 'issue3600 pending exception' })
      }
      // Dropped synchronously on the error path, no GC involved.
      t.is(issue3600TrackedDropped() - before, 10)

      const instance = new Issue3600Tracked()
      t.is(instance.size, 1024)
    },
  )
}

for (const [name, convert] of emptyConversions) {
  test.serial(`failed ${name} of an empty class drops the value`, (t) => {
    const before = issue3600EmptyDropped()
    for (let i = 0; i < 10; i++) {
      t.throws(() => convert(), { message: 'issue3600 pending exception' })
    }
    t.is(issue3600EmptyDropped() - before, 10)

    const instance = new Issue3600Tracked()
    t.is(instance.size, 1024)
  })
}

test.serial('successful conversions are not dropped eagerly', (t) => {
  const trackedBefore = issue3600TrackedDropped()
  const instance = new Issue3600Tracked()
  t.is(instance.size, 1024)
  t.is(issue3600TrackedDropped(), trackedBefore)

  const emptyBefore = issue3600EmptyDropped()
  const [a, b] = issue3600EmptyInstances()
  t.true(a instanceof Issue3600Empty)
  t.true(b instanceof Issue3600Empty)
  t.not(a, b)
  t.is(issue3600EmptyDropped(), emptyBefore)
})
