import test from 'ava'

import { CounterRepro, shutdownRuntime } from '../index.cjs'

test.after(() => {
  shutdownRuntime()
})

// Exact reproduction of issue #3119
// This test should fail/crash with the current implementation
// Expected behavior: completes 5000 iterations
// Actual behavior with bug: crashes at ~559 iterations with "malloc(): unaligned tcache chunk detected"
test('CounterRepro should complete without crashing (issue #3119)', async (t) => {
  if (typeof CounterRepro === 'undefined') {
    t.pass('CounterRepro not available, skipping test')
    return
  }

  const n = 5000
  let count = 0

  try {
    for await (const _ of new CounterRepro(n)) {
      count++
    }

    t.is(count, n, `Expected ${n} iterations, got ${count}`)
  } catch (error) {
    t.fail(`Crashed after ${count} iterations: ${error}`)
  }
})

// This version forces GC to make the bug more deterministic
test('CounterRepro should survive forced GC (issue #3119)', async (t) => {
  if (typeof CounterRepro === 'undefined') {
    t.pass('CounterRepro not available, skipping test')
    return
  }

  if (typeof global.gc !== 'function') {
    t.pass('GC not exposed (run with --expose-gc), skipping test')
    return
  }

  const n = 5000
  let count = 0

  try {
    for await (const _ of new CounterRepro(n)) {
      count++
      // Force GC periodically to trigger the bug more reliably
      if (count % 100 === 0) {
        global.gc()
      }
    }

    t.is(count, n, `Expected ${n} iterations, got ${count}`)
  } catch (error) {
    t.fail(`Crashed after ${count} iterations with forced GC: ${error}`)
  }
})

// Test that demonstrates the reference loss issue
test('CounterRepro iterator should maintain reference to instance', async (t) => {
  if (typeof CounterRepro === 'undefined') {
    t.pass('CounterRepro not available, skipping test')
    return
  }

  if (typeof global.gc !== 'function') {
    t.pass('GC not exposed (run with --expose-gc), skipping test')
    return
  }

  // Create iterator immediately without keeping instance reference
  // This should trigger the bug - the Counter instance becomes unreachable
  const iter = new CounterRepro(100)[Symbol.asyncIterator]()

  // Force GC - this will collect the Counter instance
  global.gc()

  // Try to iterate - this will crash if the bug exists
  let count = 0
  try {
    while (true) {
      const result = await iter.next()
      if (result.done) break
      count++

      // GC on every iteration to be aggressive
      global.gc()
    }

    t.is(count, 100)
  } catch (error) {
    t.fail(`Crashed after ${count} iterations: ${error}`)
  }
})
