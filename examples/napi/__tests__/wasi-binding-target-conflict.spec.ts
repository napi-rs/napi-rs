import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import test from 'ava'

const __dirname = dirname(fileURLToPath(import.meta.url))
const packageDirectory = join(__dirname, '..')

/**
 * Lanes that build a WASI artifact before running this suite — the same gate
 * `wasi-env-cleanup-export.spec.ts` uses, so this runs both in the threadless
 * lane and in the full-suite threaded lanes.
 */
const isWasiLane = Boolean(
  process.env.WASI_TEST ?? process.env.NAPI_RS_TEST_THREADLESS_WASI_BUFFER,
)

/** The node CJS loader of whichever flavor this lane actually built. */
const FLAVORS = [
  { loader: 'example.wasip1.cjs', wasm: 'example.wasm32-wasip1.wasm' },
  { loader: 'example.wasi.cjs', wasm: 'example.wasm32-wasi.wasm' },
] as const

const flavor = FLAVORS.find(({ loader, wasm }) =>
  [loader, wasm].every((file) => existsSync(join(packageDirectory, file))),
)
const loaderPath = flavor ? join(packageDirectory, flavor.loader) : undefined
const expectedTarget = flavor?.wasm.slice(
  'example.'.length,
  -'.wasm'.length,
) as string

test.skipIf(!isWasiLane)(
  'a WASI lane must have built a node CJS loader',
  (t) => {
    t.truthy(
      flavor,
      `expected one of ${FLAVORS.map(({ loader }) => loader).join(', ')} beside its .wasm in ${packageDirectory}`,
    )
  },
)

const runChild = (args: string[]) =>
  spawnSync(process.execPath, args, {
    encoding: 'utf8',
    env: process.env,
    timeout: 120_000,
  })

/**
 * A stand-in for a `#[napi(module_exports)]` hook that claims the reserved
 * name: the marker is put on the instantiated exports object before the loader
 * stamps it, so the guard throws `ERR_NAPI_BINDING_TARGET_CONFLICT`.
 *
 * The anchor is the end of the `instantiateNapiModule` call, which is inside
 * the loader's initialization `try` — the point a real hook would have run.
 */
const INJECTION_ANCHOR = `  }))\n  __publishWasiDispose(__napiModule.exports)`

test.skipIf(!isWasiLane || !loaderPath)(
  'a claimed binding target rolls the WASI initialization back',
  async (t) => {
    const source = await readFile(loaderPath!, 'utf8')
    t.true(
      source.includes(INJECTION_ANCHOR),
      'the generated loader no longer has the instantiation anchor this test patches',
    )
    // Must sit beside the .wasm: the loader resolves it against `__dirname`.
    const probePath = join(
      packageDirectory,
      `.binding-target-conflict-${process.pid}.cjs`,
    )
    await writeFile(
      probePath,
      source.replace(
        INJECTION_ANCHOR,
        `  }))\n  __napiModule.exports.__napiBindingTarget = 'native'\n  __publishWasiDispose(__napiModule.exports)`,
      ),
      'utf8',
    )
    try {
      // Twice, with the module cache cleared in between: the leak this guards
      // against accumulates, so one surviving 'exit' listener per attempt is
      // what a stamp outside the rollback boundary looks like.
      const result = runChild([
        '-e',
        `const probe = ${JSON.stringify(probePath)}
const attempts = []
for (let index = 0; index < 2; index += 1) {
  let code = null
  try {
    require(probe)
  } catch (error) {
    code = error && error.code
  }
  attempts.push({ code, exitListeners: process.listeners('exit').length })
  delete require.cache[require.resolve(probe)]
}
console.log(JSON.stringify(attempts))
process.exit(0)`,
      ])
      const output = `${result.stdout}\n${result.stderr}`
      t.is(result.error, undefined, result.error?.stack)
      t.is(result.status, 0, output)
      t.deepEqual(JSON.parse(result.stdout), [
        // the conflict is reported, ...
        { code: 'ERR_NAPI_BINDING_TARGET_CONFLICT', exitListeners: 0 },
        // ... and nothing of the failed initialization is left behind
        { code: 'ERR_NAPI_BINDING_TARGET_CONFLICT', exitListeners: 0 },
      ])
    } finally {
      await rm(probePath, { force: true })
    }
  },
)

test.skipIf(!isWasiLane || !loaderPath)(
  'the WASI CommonJS loader exposes __napiBindingTarget as an ESM named export',
  (t) => {
    // Node's CJS -> ESM named export detection is `cjs-module-lexer`, a static
    // scanner: a bare guard call is invisible to it and the import then fails
    // to link at all.
    const result = runChild([
      '--input-type=module',
      '-e',
      `import { __napiBindingTarget } from ${JSON.stringify(
        pathToFileURL(loaderPath!).href,
      )}
console.log(JSON.stringify(__napiBindingTarget))
process.exit(0)`,
    ])
    const output = `${result.stdout}\n${result.stderr}`
    t.is(result.error, undefined, result.error?.stack)
    t.is(result.status, 0, output)
    t.is(result.stdout.trim(), JSON.stringify(expectedTarget))
  },
)
