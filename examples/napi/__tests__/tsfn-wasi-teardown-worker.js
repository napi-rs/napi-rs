import { createRequire } from 'node:module'
import { parentPort } from 'node:worker_threads'

import { requireLifecycleFixture } from './lifecycle-fixture.js'

const require = createRequire(import.meta.url)
const { fixture: lifecycle } = requireLifecycleFixture(
  require,
  '../example.wasi.cjs',
)

lifecycle.dropUnregisteredWeakTsfnForWasi(() => {})
parentPort.postMessage('ready')
