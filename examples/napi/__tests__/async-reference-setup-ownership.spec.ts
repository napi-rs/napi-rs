import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import test from 'ava'

const __dirname = dirname(fileURLToPath(import.meta.url))

function runOwnershipCase(
  t: import('ava').ExecutionContext,
  mode: 'conversion-failure' | 'partial-reference',
) {
  const result = spawnSync(
    process.execPath,
    [
      '--expose-gc',
      join(__dirname, 'async-reference-setup-ownership.js'),
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
    new RegExp(`async reference setup ownership passed: ${mode}`),
  )
}

test.skipIf(Boolean(process.env.WASI_TEST))(
  'async setup releases references after argument conversion fails',
  (t) => runOwnershipCase(t, 'conversion-failure'),
)

test.skipIf(Boolean(process.env.WASI_TEST))(
  'async setup releases references after partial reference creation fails',
  (t) => runOwnershipCase(t, 'partial-reference'),
)
