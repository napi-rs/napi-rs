import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import test from 'ava'

const __dirname = dirname(fileURLToPath(import.meta.url))

// A thread inside `block_on` holds the Tokio runtime lock until its future is
// done. Module registration in a new `worker_threads` env must not wait for that
// lock when the runtime already exists. Before the fix, the reproducer never
// returned, so it runs in a child process with a timeout. On WASI, each load is a
// new wasm instance with its own runtime, so the two envs never share the lock.
test.skipIf(Boolean(process.env.WASI_TEST))(
  'a worker can load the addon while another thread is in block_on',
  (t) => {
    const result = spawnSync(
      process.execPath,
      [join(__dirname, 'block-on-worker-register.js')],
      { encoding: 'utf8', env: process.env, timeout: 60_000 },
    )
    const output = `${result.stdout}\n${result.stderr}`
    t.is(result.error, undefined, result.error?.stack)
    t.is(result.signal, null, output)
    t.is(result.status, 0, output)
    t.regex(
      result.stdout,
      /worker loaded the addon during block_on \(exit \d+\), asyncMultiTwo = 42/,
      output,
    )
  },
)
