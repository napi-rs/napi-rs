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
 * End of the `instantiateNapiModule` call — inside the loader's initialization
 * `try`, at the point a `#[napi(module_exports)]` hook has just run.
 */
const INSTANTIATE_ANCHOR = `  }))\n  __publishWasiDispose(__napiModule.exports)`

/**
 * The last statement of the initialization `try`. Patching in front of it puts
 * a mutation after the loader has stamped the binding — which is where
 * `__installCurrentThreadHosts` calls into addon-provided registration
 * functions on an asyncRuntime build.
 */
const EXIT_LISTENER_ANCHOR = `\n  __registerWasiExitListener()`

interface Attempt {
  code: string | null
  exitListeners: number
  target?: string
  sum?: number
}

/**
 * Copy the generated loader beside its `.wasm` — it resolves the artifact
 * against `__dirname` — with `patch` applied, then require it `attempts` times
 * in a child, clearing the module cache in between. A stamp that can throw
 * outside the initialization `try` shows up as an 'exit' listener that survives
 * the failed `require()`, one per attempt.
 */
const probeLoader = async (
  t: { true: (value: boolean, message?: string) => void },
  name: string,
  patch: (source: string) => string,
  attempts = 1,
): Promise<{ status: number | null; output: string; attempts: Attempt[] }> => {
  const source = await readFile(loaderPath!, 'utf8')
  const probePath = join(
    packageDirectory,
    `.binding-target-${name}-${process.pid}.cjs`,
  )
  const patched = patch(source)
  t.true(patched !== source, `the ${name} probe patched nothing`)
  await writeFile(probePath, patched, 'utf8')
  try {
    const result = runChild([
      '-e',
      `const probe = ${JSON.stringify(probePath)}
const attempts = []
for (let index = 0; index < ${attempts}; index += 1) {
  let code = null
  let target
  let sum
  try {
    const binding = require(probe)
    target = binding.__napiBindingTarget
    sum = binding.add(1, 2)
  } catch (error) {
    code = (error && error.code) || (error && error.message) || 'unknown'
  }
  attempts.push({ code, exitListeners: process.listeners('exit').length, target, sum })
  delete require.cache[require.resolve(probe)]
}
console.log(JSON.stringify(attempts))
process.exit(0)`,
    ])
    return {
      status: result.status,
      output: `${result.stdout}\n${result.stderr}`,
      attempts: result.stdout.trim() ? JSON.parse(result.stdout) : [],
    }
  } finally {
    await rm(probePath, { force: true })
  }
}

test.skipIf(!isWasiLane || !loaderPath)(
  'a claimed binding target rolls the WASI initialization back',
  async (t) => {
    // A `#[napi(module_exports)]` hook that claims the reserved name makes the
    // guard throw. Twice, with the module cache cleared in between: the leak
    // this guards against accumulates, so one surviving 'exit' listener per
    // attempt is what a stamp outside the rollback boundary looks like.
    const { status, output, attempts } = await probeLoader(
      t,
      'claimed',
      (source) => {
        t.true(source.includes(INSTANTIATE_ANCHOR))
        return source.replace(
          INSTANTIATE_ANCHOR,
          `  }))\n  __napiModule.exports.__napiBindingTarget = 'native'\n  __publishWasiDispose(__napiModule.exports)`,
        )
      },
      2,
    )
    t.is(status, 0, output)
    t.deepEqual(attempts, [
      // the conflict is reported, ...
      { code: 'ERR_NAPI_BINDING_TARGET_CONFLICT', exitListeners: 0 },
      // ... and nothing of the failed initialization is left behind
      { code: 'ERR_NAPI_BINDING_TARGET_CONFLICT', exitListeners: 0 },
    ])
  },
)

test.skipIf(!isWasiLane || !loaderPath)(
  'a marker changed after the stamp cannot fail the load',
  async (t) => {
    // The shape `__installCurrentThreadHosts` creates: addon code runs against
    // the exports object after the loader has already stamped it. With a second
    // stamp appended past the initialization `try`, that second guard saw a
    // different own value and threw where nothing rolls back. One stamp, inside
    // the boundary, is what makes this a successful load instead.
    const { status, output, attempts } = await probeLoader(
      t,
      'host-mutation',
      (source) => {
        t.true(source.includes(EXIT_LISTENER_ANCHOR))
        return source.replace(
          EXIT_LISTENER_ANCHOR,
          `\n  __napiModule.exports.__napiBindingTarget = 'mutated-by-host-install'${EXIT_LISTENER_ANCHOR}`,
        )
      },
    )
    t.is(status, 0, output)
    t.deepEqual(attempts, [
      {
        code: null,
        exitListeners: 1,
        target: 'mutated-by-host-install',
        sum: 3,
      },
    ])
  },
)

test.skipIf(!isWasiLane || !loaderPath)(
  'an addon accessor that refuses writes cannot fail the load',
  async (t) => {
    // `Object::define_property` in a `#[napi(module_exports)]` hook: the getter
    // reports the value the loader is about to stamp, so the guard returns
    // without writing — but an assignment onto that object still calls the
    // setter, even in sloppy mode. The stamp therefore assigns onto the
    // loader's own `module.exports`, never onto the addon's object.
    const { status, output, attempts } = await probeLoader(
      t,
      'accessor',
      (source) => {
        t.true(source.includes(INSTANTIATE_ANCHOR))
        return source.replace(
          INSTANTIATE_ANCHOR,
          `  }))
  Object.defineProperty(__napiModule.exports, '__napiBindingTarget', {
    configurable: true,
    get() {
      return __napiBindingTarget
    },
    set() {
      const error = new Error('the addon refuses writes to __napiBindingTarget')
      error.code = 'ERR_ADDON_SETTER'
      throw error
    },
  })
  __publishWasiDispose(__napiModule.exports)`,
        )
      },
    )
    t.is(status, 0, output)
    t.deepEqual(attempts, [
      { code: null, exitListeners: 1, target: expectedTarget, sum: 3 },
    ])
  },
)

test.skipIf(!isWasiLane || !loaderPath)(
  'the WASI CommonJS loader exposes __napiBindingTarget as an ESM named export',
  (t) => {
    // Node's CJS -> ESM named export detection is `cjs-module-lexer`, a static
    // scanner: a bare guard call is invisible to it and the import then fails
    // to link at all. It reads the `module.exports.<name> =` assignment the
    // loader makes inside its initialization `try`, which the later
    // `module.exports = __napiModule.exports` does not undo.
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
