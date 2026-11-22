import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import test from 'ava'

// Imported for its side effect: it loads the addon that `loadedAddon` finds.
import '../index.cjs'
import { loadedAddon } from './multi-env-helpers.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

// The references a `#[napi] async fn` holds to its `&T` arguments (`&T`, `&[u8]`, `&self`) must be
// deleted when its task is dropped unsettled, so the values can be collected while the env lives.
// Before the fix only the settle deleted them. Each case runs in a child process, because
// `shutdown` stops the async runtime of the whole process.
function run(kase: string, where: string, n: number) {
  const result = spawnSync(
    process.execPath,
    [
      '--expose-gc',
      join(__dirname, 'async-arg-refs.js'),
      loadedAddon(),
      kase,
      where,
      String(n),
    ],
    { encoding: 'utf8', env: process.env, timeout: 60_000 },
  )
  const output = `${result.stdout}\n${result.stderr}`
  const line = result.stdout
    .split('\n')
    .find((text) => text.startsWith('async-arg-refs '))
  return {
    result,
    output,
    report: line ? JSON.parse(line.slice('async-arg-refs '.length)) : undefined,
  }
}

const N = 20
const EXPECTED = {
  // `&ArgRefHolder` + `&[u8]`, and `&self`, dropped by a runtime shutdown: rejected.
  shutdown: {
    rejected: 2 * N,
    reasons: ['task was cancelled before completion'],
    holdersFreedWhileAlive: 2 * N,
    buffersFreedWhileAlive: N,
    results: [],
    caught: [],
  },
  // The same shapes, plus a slice-only `async fn`, settled.
  settle: {
    rejected: 0,
    reasons: [],
    holdersFreedWhileAlive: 2 * N,
    buffersFreedWhileAlive: 2 * N,
    results: [1024, 64 * 1024, 1024 + 64 * 1024],
    caught: [],
  },
  // The second argument fails to convert after the first one was rooted.
  'conversion-error': {
    rejected: 0,
    reasons: [],
    holdersFreedWhileAlive: N,
    buffersFreedWhileAlive: 0,
    results: [],
    caught: 1,
  },
} as const

for (const [kase, expected] of Object.entries(EXPECTED)) {
  for (const where of ['main', 'worker'] as const) {
    test.skipIf(Boolean(process.env.WASI_TEST))(
      `async fn argument references are freed: ${kase} (${where})`,
      (t) => {
        const { result, output, report } = run(kase, where, N)
        t.is(result.error, undefined, result.error?.stack)
        t.is(result.signal, null, output)
        t.is(result.status, 0, output)
        t.deepEqual(
          report,
          where === 'main' ? expected : { ...expected, exitedByItself: true },
          output,
        )
      },
    )
  }
}
