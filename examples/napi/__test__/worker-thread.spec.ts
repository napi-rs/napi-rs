import { join } from 'path'
import { Worker } from 'worker_threads'

import test from 'ava'

import { Animal, Kind, DEFAULT_COST } from '../index'

test('should be able to require in worker thread', async (t) => {
  await Promise.all(
    Array.from({ length: 100 }).map(() => {
      const w = new Worker(join(__dirname, 'worker.js'))
      return new Promise<void>((resolve, reject) => {
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
