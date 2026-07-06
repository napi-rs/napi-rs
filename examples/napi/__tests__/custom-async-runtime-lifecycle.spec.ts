import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import test from 'ava'

const customRuntimeEntry = fileURLToPath(
  new URL('../../custom-async-runtime/index.cjs', import.meta.url),
)
const lifecycleHelper = fileURLToPath(
  new URL('./custom-async-runtime-lifecycle.js', import.meta.url),
)
const nativeTest = process.env.WASI_TEST ? test.skip : test

if (!process.env.WASI_TEST) {
  test.before((t) => {
    t.true(
      existsSync(customRuntimeEntry),
      `custom async runtime fixture is missing: ${customRuntimeEntry}`,
    )
  })
}

function runScenario(
  scenario: 'combined' | 'retained-waker' | 'submission-transitions',
) {
  return spawnSync(process.execPath, [lifecycleHelper, scenario], {
    encoding: 'utf8',
    env: {
      ...process.env,
      NAPI_CUSTOM_RUNTIME_LIFECYCLE_TEST: '1',
    },
    timeout: 40_000,
  })
}

nativeTest(
  'custom and Tokio runtimes survive blocked retirement and shutdown failure recovery',
  (t) => {
    const result = runScenario('combined')
    const output = `${result.stdout}\n${result.stderr}`

    t.is(result.error, undefined, result.error?.stack)
    t.is(result.signal, null, output)
    t.is(result.status, 0, output)
    t.regex(result.stdout, /combined runtime lifecycle passed/)
  },
)

nativeTest(
  'custom runtime submissions reject with runtime errors during lifecycle transitions',
  (t) => {
    const result = runScenario('submission-transitions')
    const output = `${result.stdout}\n${result.stderr}`

    t.is(result.error, undefined, result.error?.stack)
    t.is(result.signal, null, output)
    t.is(result.status, 0, output)
    t.regex(result.stdout, /submission transition lifecycle passed/)
  },
)

nativeTest(
  'custom runtime fails closed when a task waker survives shutdown',
  (t) => {
    const result = runScenario('retained-waker')
    const output = `${result.stdout}\n${result.stderr}`

    t.is(result.error, undefined, result.error?.stack)
    t.true(
      result.signal !== null || result.status !== 0,
      `retained task waker must terminate the child process\n${output}`,
    )
    t.regex(output, /retained custom-runtime task waker armed/)
    t.regex(output, /externally retained task waker/)
    t.notRegex(output, /shutdown unexpectedly returned/)
  },
)
