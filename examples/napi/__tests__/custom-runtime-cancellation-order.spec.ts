import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import test from 'ava'

const pureRuntimeDirectory = fileURLToPath(
  new URL('../../custom-async-runtime/.pure-runtime/', import.meta.url),
)
const regressionScript = fileURLToPath(
  new URL('./custom-runtime-cancellation-order.js', import.meta.url),
)
const nativeTest = process.env.WASI_TEST ? test.skip : test

if (!process.env.WASI_TEST) {
  test.before((t) => {
    t.true(
      existsSync(pureRuntimeDirectory),
      `pure custom async runtime fixture is missing: ${pureRuntimeDirectory}`,
    )
  })
}

nativeTest(
  'custom runtime cancellation destroys public task futures before settlement and finalization',
  (t) => {
    const result = spawnSync(process.execPath, [regressionScript], {
      encoding: 'utf8',
      timeout: 30_000,
    })
    const output = `${result.stdout}\n${result.stderr}`

    t.is(result.error, undefined, result.error?.stack)
    t.is(result.signal, null, output)
    t.is(result.status, 0, output)
    t.regex(result.stdout, /custom runtime cancellation ordering passed/)
  },
)
