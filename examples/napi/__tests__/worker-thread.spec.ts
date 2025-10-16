import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'
import { setTimeout } from 'node:timers/promises'

import { test, before, after, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert'

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

after(() => {
  if (process.platform !== 'win32') {
    shutdownRuntime()
  }
})

const condTest = process.platform !== 'win32' ? test : test.skip

condTest('should be able to require in worker thread', async (t) => {
  await Promise.all(
    Array.from({ length: concurrency }).map(() => {
      const w = new Worker(join(__dirname, 'worker.js'), {
        env: process.env,
      })
      return new Promise<void>((resolve, reject) => {
        w.postMessage({ type: 'require' })
        w.on('message', (msg) => {
          assert.strictEqual(msg, Animal.withKind(Kind.Cat).whoami() + DEFAULT_COST)
          resolve()
        })
        w.on('error', (err) => {
          reject(err)
        })
      })
        .then(() => setTimeout(100))
        .then(() => w.terminate())
        .then(() => {
          assert.ok(true)
        })
    }),
  )
})

condTest('custom GC works on worker_threads', async (t) => {
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
            assert.strictEqual(msg, 'done')
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
            assert.strictEqual(msg, 'done')
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

condTest(
  'should be able to new Class in worker thread concurrently',
  async (t) => {
    await Promise.all(
      Array.from({ length: concurrency }).map(() => {
        const w = new Worker(join(__dirname, 'worker.js'), {
          env: process.env,
        })
        return new Promise<void>((resolve, reject) => {
          w.postMessage({ type: 'constructor' })
          w.on('message', (msg) => {
            assert.strictEqual(msg, 'Ellie')
            resolve()
          })
          w.on('error', (err) => {
            reject(err)
          })
        })
          .then(() => setTimeout(100))
          .then(() => w.terminate())
          .then(() => {
            assert.ok(true)
          })
      }),
    )
  },
)
