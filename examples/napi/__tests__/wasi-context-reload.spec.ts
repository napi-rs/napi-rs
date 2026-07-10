import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import test, { type ExecutionContext } from 'ava'

const isWasi = Boolean(process.env.WASI_TEST)
const __dirname = dirname(fileURLToPath(import.meta.url))

function runWasiLifecycleScript(t: ExecutionContext, filename: string) {
  const result = spawnSync(process.execPath, [join(__dirname, filename)], {
    encoding: 'utf8',
    env: process.env,
    timeout: 30_000,
  })
  const output = `${result.stdout}\n${result.stderr}`
  t.is(result.error, undefined, result.error?.stack)
  t.is(result.signal, null, output)
  t.is(result.status, 0, output)
  return result
}

test.skipIf(!isWasi)(
  'WASI public disposal remains restartable after same-realm cache reload',
  (t) => {
    runWasiLifecycleScript(t, 'wasi-context-reload.js')
  },
)

test.skipIf(!isWasi)(
  'WASI binding remains usable when beforeExit schedules more work',
  (t) => {
    const result = runWasiLifecycleScript(t, 'wasi-before-exit.js')
    t.regex(result.stdout, /WASI beforeExit lifecycle passed/)
  },
)
