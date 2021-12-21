import { join } from 'path'
import { Worker } from 'worker_threads'

import test from 'ava'

import { DEFAULT_COST, Animal, Kind } from '../index'

test('should be able to require in worker thread', (t) => {
  const w = new Worker(join(__dirname, 'worker.js'))
  return new Promise<void>((resolve) => {
    w.on('message', (msg) => {
      t.is(msg, Animal.withKind(Kind.Cat).whoami() + DEFAULT_COST)
      resolve()
    })
  })
    .then(() => w.terminate())
    .then(() => {
      t.pass()
    })
})
