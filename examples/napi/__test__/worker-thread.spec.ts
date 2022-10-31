import { join } from 'path'
import { Worker } from 'worker_threads'

import test from 'ava'

import { Animal, Kind, DEFAULT_COST } from '../index'

const t =
  process.arch === 'arm64' && process.platform === 'linux' ? test.skip : test

t('should be able to require in worker thread', async (t) => {
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
