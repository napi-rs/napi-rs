import { join } from 'path'
import { Worker } from 'worker_threads'

import test from 'ava'

import { DEFAULT_COST } from '../index'

test('should be able to require in worker thread', (t) => {
  const w = new Worker(join(__dirname, 'worker.js'))
  return new Promise<void>((resolve) => {
    w.on('message', (msg) => {
      t.is(msg, DEFAULT_COST)
      resolve()
    })
  })
    .then(() => w.terminate())
    .then(() => {
      t.pass()
    })
})
