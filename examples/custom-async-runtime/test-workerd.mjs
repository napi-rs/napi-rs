import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { build } from 'esbuild'
import { Miniflare } from 'miniflare'

const dir = fileURLToPath(new URL('.', import.meta.url))

// Bundle worker + deferred loader + @napi-rs/wasm-runtime + emnapi into a
// single ESM (workerd has no npm resolution). The `.wasm` import stays
// external so it resolves to a CompiledWasm module inside workerd.
await build({
  absWorkingDir: dir,
  entryPoints: ['workerd/worker.mjs'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  outfile: 'workerd/worker.bundle.mjs',
  external: ['*.wasm'],
  // Intentionally do not shim `setImmediate`: emnapi 1.11.2 includes
  // toyobayashi/emnapi#221, so this fixture exercises the released bound-host
  // function path directly and would regress to "Illegal invocation" without it.
})

const mf = new Miniflare({
  compatibilityDate: '2026-06-01',
  compatibilityFlags: ['nodejs_compat'],
  modulesRoot: dir,
  modules: [
    {
      type: 'ESModule',
      path: `${dir}workerd/worker.bundle.mjs`,
    },
    {
      type: 'CompiledWasm',
      path: `${dir}workerd/custom_async_runtime.wasm32-wasip1.wasm`,
      contents: await readFile(`${dir}custom_async_runtime.wasm32-wasip1.wasm`),
    },
  ],
})

try {
  const res = await mf.dispatchFetch('http://localhost/')
  if (res.status !== 200) {
    // Surface the workerd error page in CI logs before failing.
    assert.fail(`worker returned ${res.status}: ${await res.text()}`)
  }
  const body = await res.json()
  console.log('workerd result:', body)
  assert.equal(body.isWasm, true)
  // Mirror test.mjs semantics: asyncDouble doubles, spawnFuture/blockOnValue
  // return value + 1.
  assert.deepEqual(body.results, [42, 200, 8])
  assert.equal(body.blockOn, 6)
  assert.equal(body.rejected, true)
  // 4 async tasks were spawned: 2x asyncDouble, 1x spawnFuture, 1x asyncError.
  assert.ok(body.spawnCalls >= 4, `spawnCalls: ${body.spawnCalls}`)
  console.log('workerd single-thread async runtime OK')
} finally {
  await mf.dispose()
}
