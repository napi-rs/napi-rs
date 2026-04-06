import ava from 'ava'

import { DelayedCounter, shutdownRuntime } from '../index.cjs'

const test =
  process.platform === 'darwin' && process.arch === 'arm64' ? ava : ava.skip

ava.after(() => {
  shutdownRuntime()
})

// This test reproduces the use-after-free bug reported in issue #3119
// The bug occurs when GC runs while an async generator is still being iterated
test('async generator should survive garbage collection', async (t) => {
  if (typeof DelayedCounter === 'undefined') {
    t.pass(
      'DelayedCounter is not available (tokio_rt feature not enabled), skipping test',
    )
    return
  }

  // Use a large iteration count to trigger GC
  // The bug typically manifests around iteration 559
  const totalIterations = 2000
  const counter = new DelayedCounter(totalIterations, 0) // 0ms delay for speed

  const results: number[] = []
  let count = 0

  try {
    for await (const value of counter) {
      results.push(value as number)
      count++

      // Force GC every 500 iterations if available
      if (count % 500 === 0 && typeof global.gc === 'function') {
        global.gc()
      }
    }

    // If we get here without crashing, the bug is fixed
    t.is(
      count,
      totalIterations,
      `Expected ${totalIterations} iterations, got ${count}`,
    )
    t.is(results.length, totalIterations)

    // Verify we got the correct sequence
    t.is(results[0], 0)
    t.is(results[results.length - 1], totalIterations - 1)
  } catch (error) {
    // If the bug exists, we might get a crash or early termination
    t.fail(`Failed after ${count} iterations: ${error}`)
  }
})

// Test with forced GC at specific points
test('async generator should handle GC during iteration', async (t) => {
  if (typeof DelayedCounter === 'undefined') {
    t.pass(
      'DelayedCounter is not available (tokio_rt feature not enabled), skipping test',
    )
    return
  }

  if (typeof global.gc !== 'function') {
    t.pass('GC not exposed (run with --expose-gc), skipping test')
    return
  }

  const counter = new DelayedCounter(1000, 0)
  const results: number[] = []

  for await (const value of counter) {
    results.push(value as number)

    // Force GC on every iteration (aggressive test)
    global.gc()
  }

  t.is(results.length, 1000)
  t.is(results[0], 0)
  t.is(results[999], 999)
})

// Test that the instance doesn't get collected while iterator is in use
test('async generator instance should stay alive during iteration', async (t) => {
  if (typeof DelayedCounter === 'undefined') {
    t.pass(
      'DelayedCounter is not available (tokio_rt feature not enabled), skipping test',
    )
    return
  }

  if (typeof global.gc !== 'function') {
    t.pass('GC not exposed (run with --expose-gc), skipping test')
    return
  }

  // Create counter and immediately get iterator (original instance may become unreferenced)
  const iterator = new DelayedCounter(1000, 0)[Symbol.asyncIterator]()

  // Force GC - this should NOT collect the Counter instance
  global.gc()

  // Should still be able to iterate
  const first = await iterator.next()
  t.deepEqual(first, { value: 0, done: false })

  global.gc() // GC again

  const second = await iterator.next()
  t.deepEqual(second, { value: 1, done: false })
})
