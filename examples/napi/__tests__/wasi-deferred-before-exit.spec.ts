import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import test from 'ava'

const isThreadlessWasiBufferTest = Boolean(
  process.env.NAPI_RS_TEST_THREADLESS_WASI_BUFFER,
)
const __dirname = dirname(fileURLToPath(import.meta.url))

test.skipIf(!isThreadlessWasiBufferTest)(
  'deferred WASI automatic cleanup replaces the singleton when work resumes',
  (t) => {
    const result = spawnSync(
      process.execPath,
      [join(__dirname, 'wasi-deferred-before-exit.js')],
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
    t.regex(result.stdout, /deferred beforeExit lifecycle passed/)
  },
)
