import { Worker } from 'node:worker_threads'

import test from 'ava'

import {
  classRefsDeletedAtTeardown,
  customGcRefCounts,
  customGcTsfnsReleasedAtTeardown,
  reflectRefsDeletedAtTeardown,
} from '../index.cjs'
import {
  LOAD_IN_WORKER,
  loadedAddon,
  runInWorker,
} from './multi-env-helpers.js'

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

// The late sentinel's strong reference must be deleted at every env teardown, also when no value
// keeps the env's custom-GC handle alive by then (here: nothing is used at all). Node never frees
// a reference the addon created, so a missed one leaks 48 B per env.
for (const loads of [1, 3]) {
  test.serial(
    `env teardown deletes the late sentinel of each of ${loads} load(s)`,
    async (t) => {
      if (process.env.WASI_TEST) {
        t.pass()
        return
      }
      t.is(
        await teardownDelta(
          () => customGcRefCounts().sentinelRefsDeleted,
          loads,
        ),
        loads,
      )
    },
  )
}

test.serial(
  'env teardown deletes the class constructors of each load',
  async (t) => {
    if (process.env.WASI_TEST) {
      t.pass()
      return
    }
    const one = await teardownDelta(classRefsDeletedAtTeardown, 1)
    t.true(one > 0)
    t.is(await teardownDelta(classRefsDeletedAtTeardown, 3), 3 * one)
  },
)

type CustomGcRefCounts = ReturnType<typeof customGcRefCounts>

// How much each custom-GC counter moved since `before`. `largestDrain` is a maximum, so it is
// returned as it is now.
function customGcDelta(before: CustomGcRefCounts) {
  const after = customGcRefCounts()
  return {
    deletedWhileRunning: after.deletedWhileRunning - before.deletedWhileRunning,
    deletedAtTeardown: after.deletedAtTeardown - before.deletedAtTeardown,
    leakedAtTeardown: after.leakedAtTeardown - before.leakedAtTeardown,
    leftPending: after.leftPending - before.leftPending,
    drainCallbacks: after.drainCallbacks - before.drainCallbacks,
    largestDrain: after.largestDrain,
    sentinelRefsDeleted: after.sentinelRefsDeleted - before.sentinelRefsDeleted,
  }
}

// Worker source: drops `count` Buffers on another thread, then blocks the JS thread until all
// of them are dropped, so their references wait for the JS thread.
const DROP_OFF_THREAD_AND_BLOCK = (count: number) => `
  const dropStart = native.buffersDroppedOffThread()
  native.dropBuffersOffThread(Array.from({ length: ${count} }, () => Buffer.alloc(8)))
  const dropDeadline = Date.now() + 30_000
  while (native.buffersDroppedOffThread() - dropStart < ${count}) {
    if (Date.now() > dropDeadline) throw new Error('the Buffers were not dropped in time')
  }
`

// Starts a worker running `source` and terminates it once it posts a message.
async function terminateAfterMessage(source: string) {
  const worker = new Worker(source, {
    eval: true,
    execArgv: [],
    workerData: loadedAddon(),
  })
  await new Promise((resolve, reject) => {
    worker.once('message', resolve)
    worker.once('error', reject)
  })
  await worker.terminate()
}

test.serial(
  'references released off-thread before a worker is terminated are all deleted',
  async (t) => {
    if (process.env.WASI_TEST) {
      t.pass()
      return
    }
    const before = customGcRefCounts()
    await terminateAfterMessage(`
      ${LOAD_IN_WORKER}
      const native = load()
      ${DROP_OFF_THREAD_AND_BLOCK(200)}
      // Back to the event loop, which deletes them, then idle until terminated.
      setTimeout(() => parentPort.postMessage('dropped'), 100)
      setInterval(() => {}, 1000)
    `)
    const delta = customGcDelta(before)
    t.is(delta.deletedWhileRunning + delta.deletedAtTeardown, 200)
    t.is(delta.leakedAtTeardown, 0)
    t.is(delta.leftPending, 0)
  },
)

// More than one TSFN dispatch (1000 items) could deliver at terminate: when each reference was
// its own TSFN item, Node handed the overflow to the callback with a null env, and it leaked.
test.serial(
  'more than 1000 references waiting in a blocked worker are all deleted at terminate',
  async (t) => {
    if (process.env.WASI_TEST) {
      t.pass()
      return
    }
    const before = customGcRefCounts()
    await terminateAfterMessage(`
      ${LOAD_IN_WORKER}
      const native = load()
      ${DROP_OFF_THREAD_AND_BLOCK(2000)}
      parentPort.postMessage('blocked')
      for (;;) {}
    `)
    const delta = customGcDelta(before)
    t.is(delta.deletedWhileRunning + delta.deletedAtTeardown, 2000)
    t.is(delta.leakedAtTeardown, 0)
    t.is(delta.leftPending, 0)
  },
)

// A class instance alive at teardown is finalized after the env's cleanup hook ran, and drops
// the Uint8Array it holds (one reference each) there. The late sentinel deletes them.
test.serial(
  'env teardown deletes the references that class finalizers release',
  async (t) => {
    if (process.env.WASI_TEST) {
      t.pass()
      return
    }
    const before = customGcRefCounts()
    await runInWorker(`
      ${LOAD_IN_WORKER}
      const { Context } = load()
      globalThis.keep = Array.from({ length: 100 }, () =>
        Context.withBuffer(new Uint8Array(4)),
      )
    `)
    const delta = customGcDelta(before)
    t.is(delta.deletedAtTeardown, 100)
    t.is(delta.leakedAtTeardown, 0)
    t.is(delta.leftPending, 0)
    // Here the handle is still alive when the sentinel runs.
    t.is(delta.sentinelRefsDeleted, 1)
  },
)

test.serial(
  'a large backlog of off-thread releases is deleted over several callbacks',
  async (t) => {
    if (process.env.WASI_TEST) {
      t.pass()
      return
    }
    const before = customGcRefCounts()
    const deleted = await runInWorker(`
      ${LOAD_IN_WORKER}
      const native = load()
      const before = native.customGcRefCounts().deletedWhileRunning
      ${DROP_OFF_THREAD_AND_BLOCK(5000)}
      // Back to the event loop: the one wake in flight starts the drain.
      const deadline = Date.now() + 30_000
      const poll = () => {
        const deleted = native.customGcRefCounts().deletedWhileRunning - before
        if (deleted >= 5000 || Date.now() > deadline) parentPort.postMessage(deleted)
        else setTimeout(poll, 10)
      }
      poll()
    `)
    const delta = customGcDelta(before)
    t.is(deleted, 5000)
    t.is(delta.deletedWhileRunning, 5000)
    t.true(delta.drainCallbacks >= 5, `${delta.drainCallbacks} drain callbacks`)
    t.is(delta.largestDrain, 1000)
    t.is(delta.leakedAtTeardown, 0)
    t.is(delta.leftPending, 0)
  },
)
