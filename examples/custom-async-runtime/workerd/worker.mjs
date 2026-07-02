// Worker entry proving the single-thread custom-async-runtime fixture works
// inside real workerd. The `.wasm` import is kept external by esbuild and is
// declared as a CompiledWasm module in the miniflare harness, so `wasmModule`
// is a genuine precompiled `WebAssembly.Module` — exactly what the deferred
// loader's `instantiate()` requires (compile-from-bytes is banned on workerd).
import wasmModule from './custom_async_runtime.wasm32-wasip1.wasm'

import { instantiate } from '../custom_async_runtime.wasip1-deferred.js'

// Instantiate lazily inside the handler, memoized across requests. Kicking it
// off at top level fails on workerd with "Disallowed operation called within
// global scope": the WASI/emnapi init path needs capabilities (e.g. random
// values) that workerd only grants inside a handler.
let apiPromise

export default {
  async fetch() {
    try {
      apiPromise ??= instantiate(wasmModule)
      const api = await apiPromise
      // Mirror test.mjs semantics: asyncDouble(v) === v * 2,
      // spawnFuture(v) === v + 1, blockOnValue(v) === v + 1,
      // asyncError() takes no arguments and rejects with
      // "custom runtime async error".
      const [a, b, c] = await Promise.all([
        api.asyncDouble(21),
        api.asyncDouble(100),
        api.spawnFuture(7),
      ])
      let rejected = false
      try {
        await api.asyncError()
      } catch (e) {
        rejected = /custom runtime async error/.test(String(e && e.message))
      }
      const metrics = api.getRuntimeMetrics()
      return Response.json({
        isWasm: api.isWasm(),
        results: [a, b, c],
        blockOn: api.blockOnValue(5),
        rejected,
        spawnCalls: metrics.spawnCalls,
      })
    } catch (e) {
      // Return the stack instead of letting workerd emit an opaque 500 so the
      // harness (and CI logs) show the real failure.
      return new Response(String((e && e.stack) || e), { status: 599 })
    }
  },
}
