import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import test from 'ava'

const __dirname = dirname(fileURLToPath(import.meta.url))

// A teardown abort is fatal to the whole process, so the reproducer is spawned
// instead of run in-process: pre-fix it dies on a signal (134/SIGABRT) in debug
// builds; post-fix every worker exits cleanly. WASI lanes settle deferreds
// through the emnapi loader instead, so the native teardown path does not apply.
test.skipIf(Boolean(process.env.WASI_TEST))(
  'terminating a Worker with a pending AsyncTask does not abort the process',
  (t) => {
    const result = spawnSync(
      process.execPath,
      [join(__dirname, 'worker-task-teardown.js')],
      { encoding: 'utf8', env: process.env, timeout: 120_000 },
    )
    const output = `${result.stdout}\n${result.stderr}`
    t.is(result.error, undefined, result.error?.stack)
    t.is(result.signal, null, output)
    t.is(result.status, 0, output)
    t.regex(
      result.stdout,
      /survived AsyncTask settlement during worker teardown/,
    )
  },
)
