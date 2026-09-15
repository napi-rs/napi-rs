import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const mode = process.argv[2]

// The threaded loader is the only flavor with an async-work worker pool.
const binding = require('../example.wasi.cjs')
const dispose = binding[Symbol.for('napi.rs.wasi.dispose')]

// One `napi_async_work` call is all it takes to spawn a pool worker. Sync-only
// calls never do, which is why disposal used to look fine.
await binding.asyncTaskVoidReturn()

if (mode === 'keep-alive') {
  // Something unrelated holds the loop open, so a dispose that never settles
  // shows up as a hang instead of a silent exit.
  const guard = setTimeout(() => {
    process.stdout.write('wasi dispose never settled\n')
    process.exit(90)
  }, 30_000)
  await dispose()
  process.stdout.write('wasi dispose settled\n')
  clearTimeout(guard)
} else {
  throw new Error(`unsupported mode: ${mode}`)
}
