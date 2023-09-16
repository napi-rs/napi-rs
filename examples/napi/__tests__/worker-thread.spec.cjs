const { join } = require('node:path')
const { Worker } = require('node:worker_threads')

const test = require('ava').default

const { Animal, Kind, DEFAULT_COST } = require('../index.node')

// aarch64-unknown-linux-gnu is extremely slow in CI, skip it or it will timeout
const t =
  process.arch === 'arm64' && process.platform === 'linux' ? test.skip : test

t('should be able to require in worker thread', async (t) => {
  await Promise.all(
    Array.from({ length: 100 }).map(() => {
      const w = new Worker(join(__dirname, 'worker.cjs'), {
        execArgv: []
      })
      return new Promise((resolve, reject) => {
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
    Array.from({ length: 50 }).map(() =>
      Promise.all([
        new Promise((resolve, reject) => {
          const w = new Worker(join(__dirname, 'worker.cjs'), {
            execArgv: []
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
        new Promise((resolve, reject) => {
          const w = new Worker(join(__dirname, 'worker.cjs'), {
            execArgv: []
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
    Array.from({ length: 100 }).map(() => {
      const w = new Worker(join(__dirname, 'worker.cjs'), {
        execArgv: []
      })
      return new Promise((resolve, reject) => {
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
