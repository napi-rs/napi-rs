import test from 'ava'

import {
  customGcTsfnsReleasedAtTeardown,
  reflectRefsDeletedAtTeardown,
} from '../index.cjs'
import { LOAD_IN_WORKER, runInWorker } from './multi-env-helpers'

// The counters are process-wide, so these tests run one at a time.

// Loads the addon `loads` times in a worker, lets the worker exit (which tears
// every one of those envs down), and returns how much `counter` moved.
async function teardownDelta(counter: () => number, loads: number) {
  const before = counter()
  await runInWorker(`
    ${LOAD_IN_WORKER}
    for (let i = 0; i < ${loads}; i++) load()
  `)
  return counter() - before
}

for (const loads of [1, 3]) {
  test.serial(
    `env teardown deletes the Reflect cache of each of ${loads} load(s)`,
    async (t) => {
      if (process.env.WASI_TEST) {
        t.pass()
        return
      }
      t.is(await teardownDelta(reflectRefsDeletedAtTeardown, loads), loads)
    },
  )
}

for (const loads of [1, 3]) {
  test.serial(
    `env teardown releases the custom-GC threadsafe function of each of ${loads} load(s)`,
    async (t) => {
      if (process.env.WASI_TEST) {
        t.pass()
        return
      }
      t.is(await teardownDelta(customGcTsfnsReleasedAtTeardown, loads), loads)
    },
  )
}
