import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import test from 'ava'

const __dirname = dirname(fileURLToPath(import.meta.url))

test.skipIf(Boolean(process.env.WASI_TEST))(
  'ThreadsafeFunction refer and unref reject a foreign napi_env',
  (t) => {
    const result = spawnSync(
      process.execPath,
      [join(__dirname, 'tsfn-foreign-env.js')],
      {
        encoding: 'utf8',
        env: process.env,
        timeout: 30_000,
      },
    )
    const output = `${result.stdout}\n${result.stderr}`
    t.is(result.error, undefined, result.error?.stack)
    t.is(result.signal, null, output)
    t.is(result.status, 0, output)
    t.regex(
      result.stdout,
      /threadsafe-function foreign-env checks passed/,
    )
  },
)
