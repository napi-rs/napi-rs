import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import test from 'ava'

const __dirname = dirname(fileURLToPath(import.meta.url))

function runLifetimeCase(
  t: import('ava').ExecutionContext,
  mode: 'detached' | 'rebound',
) {
  const result = spawnSync(
    process.execPath,
    [
      '--expose-gc',
      '--stress-compaction',
      '--compact-on-every-full-gc',
      join(__dirname, 'async-iterator-callback-lifetime.js'),
      mode,
    ],
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
    new RegExp(`Async iterator callback lifetime passed: ${mode}`),
  )
}

test.skipIf(Boolean(process.env.WASI_TEST))(
  'detached async iterator callbacks retain their original owner',
  (t) => runLifetimeCase(t, 'detached'),
)

test.skipIf(Boolean(process.env.WASI_TEST))(
  'rebound async iterator callbacks retain their original owner',
  (t) => runLifetimeCase(t, 'rebound'),
)
