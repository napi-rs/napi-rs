import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'
import { setTimeout } from 'node:timers/promises'

import test from 'ava'

import { Animal, Kind, DEFAULT_COST, shutdownRuntime } from '../index.cjs'

const __dirname = join(fileURLToPath(import.meta.url), '..')

const concurrency =
  (process.platform === 'win32' ||
    process.platform === 'darwin' ||
    (process.platform === 'linux' &&
      (process.arch === 'x64' || process.arch === 'arm64') &&
      // @ts-expect-error
      process?.report?.getReport()?.header?.glibcVersionRuntime)) &&
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
      new Promise<Worker>((resolve, reject) => {
        const w = new Worker(join(__dirname, 'worker.js'), { env: process.env })
        w.postMessage({ type: 'stash:buffer:teardown' })
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
