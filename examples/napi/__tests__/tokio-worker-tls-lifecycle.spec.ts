import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import test from 'ava'

const __dirname = dirname(fileURLToPath(import.meta.url))
const scriptPath = join(__dirname, 'tokio-worker-tls-lifecycle.js')

test('supplied Tokio runtime threads cannot block on their own retirement', (t) => {
  if (process.env.WASI_TEST) {
    t.pass()
    return
  }

  const result = spawnSync(process.execPath, [scriptPath], {
    encoding: 'utf8',
    timeout: 20_000,
  })
  const output = `${result.stdout}\n${result.stderr}`
  t.is(result.error, undefined, result.error?.stack)
  t.is(result.signal, null, output)
  t.is(result.status, 0, output)
})
