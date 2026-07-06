import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import test from 'ava'

const __dirname = dirname(fileURLToPath(import.meta.url))
const nativeTest = process.env.WASI_TEST ? test.skip : test

nativeTest(
  'unlimited Blocking TSFN calls bypass bounded-call contention',
  (t) => {
    const result = spawnSync(
      process.execPath,
      [join(__dirname, 'tsfn-unlimited-contention.js')],
      {
        encoding: 'utf8',
        env: process.env,
        timeout: 20_000,
      },
    )
    const output = `${result.stdout}\n${result.stderr}`
    t.is(result.error, undefined, result.error?.stack)
    t.is(result.signal, null, output)
    t.is(result.status, 0, output)
    t.regex(result.stdout, /unlimited TSFN contention passed/)
  },
)
