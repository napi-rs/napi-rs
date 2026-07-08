import { createRequire } from 'node:module'

import test from 'ava'

const require = createRequire(import.meta.url)
const isThreadlessWasiBufferTest = Boolean(
  process.env.NAPI_RS_TEST_THREADLESS_WASI_BUFFER,
)

test.skipIf(!isThreadlessWasiBufferTest)(
  'threadless WASI rejects built-in Tokio async exports without trapping',
  async (t) => {
    const binding = require('../example.wasip1.cjs')

    t.is(binding.add(1, 2), 3)
    await t.throwsAsync(() => binding.asyncPlus100(Promise.resolve(1)), {
      message:
        'Built-in Tokio async tasks require a threaded WASI target. Use wasm32-wasip1-threads, or enable async-runtime and register a custom AsyncRuntime backend for wasm32-wasip1.',
    })
    t.is(binding.add(2, 3), 5)
  },
)
