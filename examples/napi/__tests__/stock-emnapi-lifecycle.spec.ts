import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import test from 'ava'

const isWasi = Boolean(process.env.WASI_TEST)
const __dirname = dirname(fileURLToPath(import.meta.url))
const wasiLoaderSuffix =
  process.env.NAPI_RS_WASI_FLAVOR === 'wasm32-wasip1' ? 'wasip1' : 'wasi'

test.skipIf(!isWasi)(
  'generated WASI loader supports lifecycle restart with stock emnapi',
  (t) => {
    const result = spawnSync(
      process.execPath,
      [join(__dirname, 'stock-emnapi-lifecycle.js'), wasiLoaderSuffix],
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
    t.regex(result.stdout, /stock emnapi lifecycle passed/)
  },
)
