import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'

import test from 'ava'

const { Animal, Kind, DEFAULT_COST } = (await import('../index.js')).default

const __dirname = join(fileURLToPath(import.meta.url), '..')

const t =
  // aarch64-unknown-linux-gnu is extremely slow in CI, skip it or it will timeout
  process.arch === 'arm64' && process.platform === 'linux' ? test.skip : test

const concurrency = process.env.WASI_TEST
  ? 1
  : process.platform === 'win32' ||
      process.platform === 'darwin' ||
      (process.platform === 'linux' &&
        process.arch === 'x64' &&
        // @ts-expect-error
        process?.report?.getReport()?.header?.glibcVersionRuntime)
    ? 50
    : 10

t('should be able to require in worker thread', async (t) => {
  await Promise.all(
    Array.from({ length: concurrency }).map(() => {
      const w = new Worker(join(__dirname, 'worker.cjs'), {
        execArgv: ['--experimental-wasi-unstable-preview1'],
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
        .then(() => w.terminate())
        .then(() => {
          t.pass()
        })
    }),
  )
})

t('custom GC works on worker_threads', async (t) => {
  await Promise.all(
    Array.from({ length: concurrency }).map(() =>
      Promise.all([
        new Promise<Worker>((resolve, reject) => {
          const w = new Worker(join(__dirname, 'worker.cjs'), {
            execArgv: ['--experimental-wasi-unstable-preview1'],
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
          const w = new Worker(join(__dirname, 'worker.cjs'), {
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
        }).then((w) => {
          return w.terminate()
        }),
      ]),
    ),
  )
})

t('should be able to new Class in worker thread concurrently', async (t) => {
  await Promise.all(
    Array.from({ length: concurrency }).map(() => {
      const w = new Worker(join(__dirname, 'worker.cjs'), {
        execArgv: ['--experimental-wasi-unstable-preview1'],
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
        .then(() => w.terminate())
        .then(() => {
          t.pass()
        })
    }),
  )
})
