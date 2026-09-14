import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import test from 'ava'

// Threaded WASI only: the threadless loader passes `asyncWorkPoolSize: 0` and
// never reads the environment, and a native build has no in-wasm pool at all.
const isThreadedWasi =
  Boolean(process.env.WASI_TEST) &&
  process.env.NAPI_RS_WASI_FLAVOR !== 'wasm32-wasip1'
const __dirname = dirname(fileURLToPath(import.meta.url))

// Both values are ones emnapi would silently rewrite if the loader passed them
// through: `2048` is above emnapi's own 1024 ceiling, and 2**32 coerces to `0`
// through ToInt32, which the in-wasm libuv pool reads as "unset". The loader
// maps each to the default instead, so the addon must start a usable pool and
// resolve an async export rather than `abort()` inside wasm.
for (const poolSize of ['4294967296', '2048']) {
  test.skipIf(!isThreadedWasi)(
    `threaded WASI loader defaults an out-of-range NAPI_RS_ASYNC_WORK_POOL_SIZE=${poolSize}`,
    (t) => {
      const result = spawnSync(
        process.execPath,
        [join(__dirname, 'wasi-async-work-pool-size.js')],
        {
          encoding: 'utf8',
          env: { ...process.env, NAPI_RS_ASYNC_WORK_POOL_SIZE: poolSize },
          timeout: 60_000,
        },
      )
      const output = `${result.stdout}\n${result.stderr}`
      t.is(result.error, undefined, result.error?.stack)
      t.is(result.signal, null, output)
      t.is(result.status, 0, output)
      t.regex(result.stdout, /async work pool size accepted/)
    },
  )
}
