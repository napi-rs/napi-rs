import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import test from 'ava'

const __dirname = dirname(fileURLToPath(import.meta.url))

// The failure this guards against aborts the whole process, so the reproducer
// runs in a child process (as in worker-task-teardown.spec.ts). The custom-GC
// env cleanup hook is native only; WASI lanes do not take this path.
test.skipIf(Boolean(process.env.WASI_TEST))(
  'FunctionRefs dropped off-thread during worker teardown do not abort the process',
  (t) => {
    const result = spawnSync(
      process.execPath,
      [join(__dirname, 'custom-gc-teardown.js')],
      { encoding: 'utf8', env: process.env, timeout: 120_000 },
    )
    const output = `${result.stdout}\n${result.stderr}`
    t.is(result.error, undefined, result.error?.stack)
    t.is(result.signal, null, output)
    t.is(result.status, 0, output)
    t.notRegex(result.stderr, /Call custom GC/, output)
    // 3 workers x 3 references: every drop ran, after the threadsafe function
    // was closed.
    t.regex(
      result.stdout,
      /dropped 9 function references during worker teardown/,
      output,
    )
  },
)
