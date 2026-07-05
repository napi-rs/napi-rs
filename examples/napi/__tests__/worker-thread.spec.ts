import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'
import { setTimeout } from 'node:timers/promises'

import test from 'ava'

import {
  Animal,
  Kind,
  DEFAULT_COST,
  asyncBlockTerminalFinalizerCount,
  shutdownRuntime,
} from '../index.cjs'

const __dirname = join(fileURLToPath(import.meta.url), '..')

const concurrency =
  (process.platform === 'win32' ||
    process.platform === 'darwin' ||
    (process.platform === 'linux' &&
      (process.arch === 'x64' || process.arch === 'arm64') &&
      // @ts-expect-error
      process?.report?.getReport()?.header?.glibcVersionRuntime)) &&
  // 32-bit (ia32) targets such as i686 Windows cannot hold 20 concurrent worker
  // isolates plus the off-thread Error drops' spawned OS threads in a single
  // ~2 GB address space; keep them at 1 like the other constrained targets
  // (napi-rs#3368).
  process.arch !== 'ia32' &&
  !process.env.WASI_TEST &&
  !process.env.ASAN_OPTIONS
    ? 20
    : 1
test.after(() => {
  if (process.platform !== 'win32') {
    shutdownRuntime()
  }
})

test('should be able to require in worker thread', async (t) => {
  await Promise.all(
    Array.from({ length: concurrency }).map(() => {
      const w = new Worker(join(__dirname, 'worker.js'), {
        env: process.env,
      })
      return new Promise<void>((resolve, reject) => {
        w.postMessage({ type: 'require' })
        w.on('message', (msg) => {
          t.is(msg, Animal.withKind(Kind.Cat).whoami() + DEFAULT_COST)
          resolve()
        })
        w.on('error', (err) => {
          reject(err)
        })
      })
        .then(() => setTimeout(100))
        .then(() => w.terminate())
        .then(() => {
          t.pass()
        })
    }),
  )
})

test.serial.skipIf(Boolean(process.env.WASI_TEST))(
  'worker teardown runs pending async block terminal finalizers exactly once',
  async (t) => {
    const initialCount = asyncBlockTerminalFinalizerCount()

    for (let iteration = 1; iteration <= 3; iteration++) {
      const worker = new Worker(join(__dirname, 'worker.js'), {
        env: process.env,
      })
      await new Promise<void>((resolve, reject) => {
        worker.postMessage({ type: 'async:terminal-finalizer' })
        worker.once('message', (message) => {
          t.is(message, 'pending')
          resolve()
        })
        worker.once('error', reject)
      })
      await worker.terminate()

      const expectedCount = initialCount + iteration
      const deadline = Date.now() + 2_000
      while (
        asyncBlockTerminalFinalizerCount() < expectedCount &&
        Date.now() < deadline
      ) {
        await setTimeout(10)
      }
      t.is(asyncBlockTerminalFinalizerCount(), expectedCount)
    }
  },
)

test('custom GC works on worker_threads', async (t) => {
  await Promise.all(
    Array.from({ length: concurrency }).map(() =>
      Promise.all([
        new Promise<Worker>((resolve, reject) => {
          const w = new Worker(join(__dirname, 'worker.js'), {
            env: process.env,
          })
          w.postMessage({
            type: 'async:buffer',
          })
          w.on('message', (msg) => {
            t.is(msg, 'done')
            resolve(w)
          })
          w.on('error', (err) => {
            reject(err)
          })
        }).then((w) => {
          return w.terminate()
        }),
        new Promise<Worker>((resolve, reject) => {
          const w = new Worker(join(__dirname, 'worker.js'), {
            execArgv: [],
          })
          w.postMessage({
            type: 'async:arraybuffer',
          })
          w.on('message', (msg) => {
            t.is(msg, 'done')
            resolve(w)
          })
          w.on('error', (err) => {
            reject(err)
          })
        }).then(async (w) => {
          await setTimeout(100)
          return w.terminate()
        }),
      ]),
    ),
  )
})

// (A) off-thread cross-isolate drop. buffer sub-worker: env:process.env + IMMEDIATE terminate
// (F2/F3 owner-teardown stress). arraybuffer sub-worker: execArgv:[] + setTimeout(100) then terminate.
test('custom GC cross-isolate off-thread drop (napi-rs#3357)', async (t) => {
  await Promise.all(
    Array.from({ length: concurrency }).map(() =>
      Promise.all([
        new Promise<Worker>((resolve, reject) => {
          const w = new Worker(join(__dirname, 'worker.js'), {
            env: process.env,
          })
          w.postMessage({ type: 'async:buffer:consume' })
          w.on('message', (msg) => {
            t.is(msg, 'done')
            resolve(w)
          })
          w.on('error', reject)
        }).then((w) => w.terminate()),
        new Promise<Worker>((resolve, reject) => {
          const w = new Worker(join(__dirname, 'worker.js'), { execArgv: [] })
          w.postMessage({ type: 'async:arraybuffer:consume' })
          w.on('message', (msg) => {
            t.is(msg, 'done')
            resolve(w)
          })
          w.on('error', reject)
        }).then(async (w) => {
          await setTimeout(100)
          return w.terminate()
        }),
      ]),
    ),
  )
})

// (B) same-thread post-teardown drop (guards must_fix #1). Worker stashes JS-origin Buffers in a
// Rust thread_local on its OWN JS thread; on terminate the env tears down (aborted=true), then the
// thread exits and the stashed Buffers drop on the OWNER thread AFTER teardown -> must no-op.
test('custom GC same-thread post-teardown drop (napi-rs#3357 must_fix #1)', async (t) => {
  await Promise.all(
    Array.from({ length: concurrency }).map(() =>
      Promise.all(
        ['stash:buffer:teardown', 'stash:arraybuffer:teardown'].map((type) =>
          new Promise<Worker>((resolve, reject) => {
            const w = new Worker(join(__dirname, 'worker.js'), {
              env: process.env,
            })
            w.postMessage({ type })
            w.on('message', (msg) => {
              t.is(msg, 'done')
              resolve(w)
            })
            w.on('error', reject)
          }).then((w) => w.terminate()),
        ),
      ),
    ),
  )
})

// (C) JS-derived `Error`s own a napi_ref; releasing them off the JS thread must be
// routed through the custom GC like buffers (napi-rs#3368). Each worker interleaves
// off-thread Error drops (spawned thread / async-runtime rejection / try_clone
// siblings) with JS-thread GlobalHandles churn.
test('JS-derived Error released off-thread (napi-rs#3368)', async (t) => {
  await Promise.all(
    Array.from({ length: concurrency }).map(() =>
      Promise.all(
        [
          'error:value:offthread',
          'error:reject:offthread',
          'error:clone:threads',
        ].map((type) =>
          new Promise<Worker>((resolve, reject) => {
            const w = new Worker(join(__dirname, 'worker.js'), {
              env: process.env,
            })
            w.postMessage({ type })
            w.on('message', (msg) => {
              t.is(msg, 'done')
              resolve(w)
            })
            w.on('error', reject)
          }).then((w) => w.terminate()),
        ),
      ),
    ),
  )
})

// (D) same-thread post-teardown Error drop: stashed on the worker's own JS thread,
// dropped at thread-exit after env teardown -> aborted (leak) path (napi-rs#3368).
test('JS-derived Error same-thread post-teardown drop (napi-rs#3368)', async (t) => {
  await Promise.all(
    Array.from({ length: concurrency }).map(() =>
      new Promise<Worker>((resolve, reject) => {
        const w = new Worker(join(__dirname, 'worker.js'), {
          env: process.env,
        })
        w.postMessage({ type: 'stash:error:teardown' })
        w.on('message', (msg) => {
          t.is(msg, 'done')
          resolve(w)
        })
        w.on('error', reject)
      }).then((w) => w.terminate()),
    ),
  )
})

test('should be able to new Class in worker thread concurrently', async (t) => {
  await Promise.all(
    Array.from({ length: concurrency }).map(() => {
      const w = new Worker(join(__dirname, 'worker.js'), {
        env: process.env,
      })
      return new Promise<void>((resolve, reject) => {
        w.postMessage({ type: 'constructor' })
        w.on('message', (msg) => {
          t.is(msg, 'Ellie')
          resolve()
        })
        w.on('error', (err) => {
          reject(err)
        })
      })
        .then(() => setTimeout(100))
        .then(() => w.terminate())
        .then(() => {
          t.pass()
        })
    }),
  )
})
