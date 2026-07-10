import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import test from 'ava'

const isWasi = Boolean(process.env.WASI_TEST)
const __dirname = dirname(fileURLToPath(import.meta.url))
const runnerPath = join(__dirname, 'tokio-wasi-waker-lifecycle.js')
const wasiTest = isWasi ? test : test.skip

wasiTest(
  'threaded WASI parent teardown terminates escaped waker threads',
  (t) => {
    const result = spawnSync(process.execPath, [runnerPath], {
      encoding: 'utf8',
      env: process.env,
      timeout: 30_000,
    })
    const output = `${result.stdout}\n${result.stderr}`
    t.is(result.error, undefined, result.error?.stack)
    t.is(result.signal, null, output)
    t.is(result.status, 0, output)
  },
)
