import { join } from 'path'
import { Worker } from 'worker_threads'

import test from 'ava'

import { Animal, Kind, DEFAULT_COST } from '../index'

test('should be able to require in worker thread', async (t) => {
  await Promise.all(
    Array.from({ length: 100 }).map(() => {
      const w = new Worker(join(__dirname, 'worker.js'))
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

test('custom GC works on worker_threads', async (t) => {
  await Promise.all(
    Array.from({ length: 50 }).map(() =>
      Promise.all([
        new Promise<Worker>((resolve, reject) => {
          const w = new Worker(join(__dirname, 'worker.js'))
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
          const w = new Worker(join(__dirname, 'worker.js'))
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

test('should be able to new Class in worker thread concurrently', async (t) => {
  await Promise.all(
    Array.from({ length: 100 }).map(() => {
      const w = new Worker(join(__dirname, 'worker.js'))
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
