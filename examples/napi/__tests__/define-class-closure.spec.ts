import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import test from 'ava'

const __dirname = dirname(fileURLToPath(import.meta.url))

// A double drop or a use-after-free can crash the process, so each scenario of
// define-class-closure.js runs in a child process.
function run(scenario: string, execArgv: string[] = []) {
  const result = spawnSync(
    process.execPath,
    [...execArgv, join(__dirname, 'define-class-closure.js'), scenario],
    { encoding: 'utf8', env: process.env, timeout: 120_000 },
  )
  const output = `${result.stdout}\n${result.stderr}`
  return { result, output, drops: /drops (\d+)/.exec(result.stdout)?.[1] }
}

// The worker scenarios count drops at worker teardown, which WASI lanes do
// not run through the native env cleanup path.
test.skipIf(Boolean(process.env.WASI_TEST))(
  'closure accessors passed to Env::define_class are dropped at env teardown',
  (t) => {
    const { result, output, drops } = run('class')
    t.is(result.error, undefined, result.error?.stack)
    t.is(result.signal, null, output)
    t.is(result.status, 0, output)
    t.is(drops, '20', output)
  },
)

test.skipIf(Boolean(process.env.WASI_TEST))(
  'a reused property slice drops each closure once',
  (t) => {
    for (const scenario of ['class-twice', 'object-twice']) {
      const { result, output, drops } = run(scenario)
      t.is(result.error, undefined, result.error?.stack)
      t.is(result.signal, null, `${scenario}: ${output}`)
      t.is(result.status, 0, `${scenario}: ${output}`)
      t.is(drops, '2', `${scenario}: ${output}`)
    }
  },
)

test('define_class accessors keep their closures after the constructor is collected', (t) => {
  const { result, output, drops } = run('gc', ['--expose-gc'])
  t.is(result.error, undefined, result.error?.stack)
  t.is(result.signal, null, output)
  t.is(result.status, 0, output)
  t.regex(result.stdout, /kept 1500\/1500/, output)
  t.is(drops, '0', output)
})
