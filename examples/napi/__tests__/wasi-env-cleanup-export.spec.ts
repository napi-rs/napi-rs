import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import test from 'ava'

const __dirname = dirname(fileURLToPath(import.meta.url))
const packageDirectory = join(__dirname, '..')

/**
 * `napi_prepare_wasm_env_cleanup` is the pre-teardown barrier every generated
 * WASI loader calls — while the environment can still call into JavaScript —
 * immediately before it destroys that environment.
 *
 * Its absence is silent by construction. `napi-build` links it with
 * `--export-if-defined`, so a binary without the symbol still links, and the
 * loaders guard the call with `typeof … === 'function'`, so a binary without the
 * symbol still loads and runs. It simply never gets the drain: in-flight async
 * work is left to settle a promise through an environment that has already
 * stopped accepting JavaScript calls. Nothing reports that, so assert the export
 * really is in the built artifact.
 */
const WASM_ARTIFACTS = [
  // wasm32-wasip1 (threadless)
  'example.wasm32-wasip1.wasm',
  // wasm32-wasip1-threads
  'example.wasm32-wasi.wasm',
]

/**
 * Lanes that build a WASI artifact before running this suite. When one of them
 * is set, a missing artifact is a failure rather than a reason to skip —
 * silently skipping is the exact failure mode this file exists to catch.
 */
const requiresWasmArtifact = Boolean(
  process.env.WASI_TEST ?? process.env.NAPI_RS_TEST_THREADLESS_WASI_BUFFER,
)

interface WasmExportDescriptor {
  name: string
  kind: string
}

/**
 * `WebAssembly`'s value declarations live in `lib.dom.d.ts`, which this package
 * does not pull in. Reach it through `globalThis` with just the surface used
 * here.
 */
const { WebAssembly: wasm } = globalThis as unknown as {
  WebAssembly: {
    compile(bytes: Uint8Array): Promise<object>
    Module: { exports(compiled: object): WasmExportDescriptor[] }
  }
}

const builtArtifacts = WASM_ARTIFACTS.filter((name) =>
  existsSync(join(packageDirectory, name)),
)

test('a WASI lane must have built at least one wasm artifact', (t) => {
  if (!requiresWasmArtifact) {
    t.pass('native lane: no WASI artifact is expected')
    return
  }
  t.true(
    builtArtifacts.length > 0,
    `expected one of ${WASM_ARTIFACTS.join(', ')} in ${packageDirectory}`,
  )
})

for (const name of WASM_ARTIFACTS) {
  test.skipIf(!builtArtifacts.includes(name))(
    `${name} exports napi_prepare_wasm_env_cleanup`,
    async (t) => {
      const bytes = await readFile(join(packageDirectory, name))
      const compiled = await wasm.compile(bytes)
      const wasmExports = wasm.Module.exports(compiled)
      const exportNames = wasmExports.map((entry) => entry.name)

      // Control: without this the artifact is not a napi-rs addon at all and the
      // assertion below would prove nothing.
      t.true(
        exportNames.includes('napi_register_wasm_v1'),
        'the artifact is not a napi-rs wasm addon',
      )

      const barrier = wasmExports.find(
        (entry) => entry.name === 'napi_prepare_wasm_env_cleanup',
      )
      t.truthy(
        barrier,
        'napi_prepare_wasm_env_cleanup is missing: the loaders guard the call with `typeof`, so the environment teardown barrier would be skipped without a single error',
      )
      t.is(barrier?.kind, 'function')
    },
  )
}
