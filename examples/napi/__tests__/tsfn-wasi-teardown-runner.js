import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { Worker } from 'node:worker_threads'

import { requireLifecycleFixture } from './lifecycle-fixture.js'

const require = createRequire(import.meta.url)
const { fixture: lifecycle } = requireLifecycleFixture(
  require,
  '../example.wasi.cjs',
)

lifecycle.dropUnregisteredWeakTsfnForWasi(() => {})

const worker = new Worker(
  new URL('./tsfn-wasi-teardown-worker.js', import.meta.url),
  {
    env: process.env,
  },
)

const message = await new Promise((resolve, reject) => {
  worker.once('message', resolve)
  worker.once('error', reject)
})
assert.equal(message, 'ready')

const exitCode = await new Promise((resolve, reject) => {
  worker.once('exit', resolve)
  worker.once('error', reject)
})
assert.equal(exitCode, 0)
