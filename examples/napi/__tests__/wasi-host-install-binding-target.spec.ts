import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import test from 'ava'

import {
  createWasiBrowserBinding,
  createWasiDeferredBrowserBinding,
} from '../../../cli/src/api/templates/load-wasi-template.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const packageDirectory = join(__dirname, '..')

/** Both loaders under test are the threadless flavor's. */
const WASM = 'example.wasm32-wasip1.wasm'
const TARGET = 'wasm32-wasip1'
const wasmPath = join(packageDirectory, WASM)

const isWasiLane = Boolean(
  process.env.WASI_TEST ?? process.env.NAPI_RS_TEST_THREADLESS_WASI_BUFFER,
)
const runnable = isWasiLane && existsSync(wasmPath)

/**
 * `installCurrentThreadHosts` (browser) and the workerd task/timer hosts
 * (deferred) hand the addon's own exports object to registration functions the
 * addon provides, so those can put anything on it — including the reserved
 * marker. The loaders must therefore stamp *after* the host install: a stamp
 * before it reads a state that is not final, and the mismatch is silent.
 *
 * `@napi-rs/async-runtime` is stubbed because examples/napi is not built with
 * the async runtime; only the ordering of the template's own statements is
 * under test, not what the real hosts do.
 */
const HOST_STUB = `export const installCurrentThreadHosts = (exportsObject) => {
  if (process.env.NAPI_TEST_HOST_CLAIMS_TARGET) {
    exportsObject.__napiBindingTarget = 'native'
  }
  return () => {}
}
export const registerWorkerdCurrentThreadTaskHost = (exportsObject) => {
  if (process.env.NAPI_TEST_HOST_CLAIMS_TARGET) {
    exportsObject.__napiBindingTarget = 'native'
  }
  return () => {}
}
export const registerWorkerdTimerHost = () => () => {}
`

interface Outcome {
  code?: string | null
  moduleTarget?: string
  bindingTarget?: string
  sum?: number
}

/**
 * Write the generated loader beside the `.wasm` (the browser loader resolves it
 * against `import.meta.url`) with its `@napi-rs/async-runtime` import pointed at
 * the stub, run `body` against it in a child, and clean both files up.
 */
const withGeneratedLoader = async (
  name: string,
  source: string,
  body: (loaderUrl: string) => string,
  claimsTarget: boolean,
): Promise<{ status: number | null; output: string; outcome: Outcome[] }> => {
  const stubPath = join(
    packageDirectory,
    `.host-stub-${name}-${process.pid}.mjs`,
  )
  const loaderPath = join(
    packageDirectory,
    `.loader-${name}-${process.pid}.mjs`,
  )
  await Promise.all([
    writeFile(stubPath, HOST_STUB, 'utf8'),
    writeFile(
      loaderPath,
      source.replace(
        `from '@napi-rs/async-runtime'`,
        `from './${stubPath.slice(packageDirectory.length + 1)}'`,
      ),
      'utf8',
    ),
  ])
  try {
    const result = spawnSync(
      process.execPath,
      ['--input-type=module', '-e', body(pathToFileURL(loaderPath).href)],
      {
        encoding: 'utf8',
        timeout: 120_000,
        env: claimsTarget
          ? { ...process.env, NAPI_TEST_HOST_CLAIMS_TARGET: '1' }
          : process.env,
      },
    )
    return {
      status: result.status,
      output: `${result.stdout}\n${result.stderr}`,
      outcome: result.stdout.trim() ? JSON.parse(result.stdout) : [],
    }
  } finally {
    await Promise.all([
      rm(stubPath, { force: true }),
      rm(loaderPath, { force: true }),
    ])
  }
}

/** The browser loader fetches its own wasm; Node's fetch has no `file:`. */
const BROWSER_BODY = (loaderUrl: string) => `
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
globalThis.fetch = async (url) => {
  const bytes = await readFile(fileURLToPath(url))
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  }
}
const outcome = []
try {
  const loader = await import(${JSON.stringify(loaderUrl)})
  const binding = loader.default
  outcome.push({
    code: null,
    moduleTarget: loader.__napiBindingTarget,
    bindingTarget: binding.__napiBindingTarget,
    sum: binding.add(1, 2),
  })
} catch (error) {
  outcome.push({ code: (error && error.code) || (error && error.message) })
}
console.log(JSON.stringify(outcome))
process.exit(0)`

/** Two attempts: a rolled-back failure must not leave a usable instance behind. */
const DEFERRED_BODY = (loaderUrl: string) => `
import { readFile } from 'node:fs/promises'
const loader = await import(${JSON.stringify(loaderUrl)})
const bytes = await readFile(${JSON.stringify(wasmPath)})
const wasmModule = await WebAssembly.compile(bytes)
const outcome = []
for (let index = 0; index < 2; index += 1) {
  try {
    const binding = await loader.instantiate(wasmModule)
    outcome.push({
      code: null,
      moduleTarget: loader.__napiBindingTarget,
      bindingTarget: binding.__napiBindingTarget,
      sum: binding.add(1, 2),
    })
  } catch (error) {
    outcome.push({ code: (error && error.code) || (error && error.message) })
  }
}
console.log(JSON.stringify(outcome))
process.exit(0)`

// `writeWasiBindingForTarget` appends the exports; the template alone has none.
const browserLoader = () =>
  createWasiBrowserBinding(
    'example.wasm32-wasip1',
    16384,
    65536,
    true,
    undefined,
    true,
    undefined,
    false,
    TARGET,
    true,
  ) + 'export default __napiModule.exports\n'

const deferredLoader = () =>
  createWasiDeferredBrowserBinding(
    'example.wasm32-wasip1',
    16384,
    65536,
    true,
    TARGET,
    true,
  )

test.skipIf(!runnable)(
  'the browser loader rejects a host installation that claims the binding target',
  async (t) => {
    const { status, output, outcome } = await withGeneratedLoader(
      'browser-claims',
      browserLoader(),
      BROWSER_BODY,
      true,
    )
    t.is(status, 0, output)
    t.deepEqual(outcome, [{ code: 'ERR_NAPI_BINDING_TARGET_CONFLICT' }])
  },
)

test.skipIf(!runnable)(
  'the browser loader reports one target on the module and the binding',
  async (t) => {
    const { status, output, outcome } = await withGeneratedLoader(
      'browser-benign',
      browserLoader(),
      BROWSER_BODY,
      false,
    )
    t.is(status, 0, output)
    t.deepEqual(outcome, [
      { code: null, moduleTarget: TARGET, bindingTarget: TARGET, sum: 3 },
    ])
  },
)

test.skipIf(!runnable)(
  'the deferred loader rejects a host installation that claims the binding target',
  async (t) => {
    const { status, output, outcome } = await withGeneratedLoader(
      'deferred-claims',
      deferredLoader(),
      DEFERRED_BODY,
      true,
    )
    t.is(status, 0, output)
    t.deepEqual(outcome, [
      { code: 'ERR_NAPI_BINDING_TARGET_CONFLICT' },
      // the failed instantiation is rolled back, not cached and handed out
      { code: 'ERR_NAPI_BINDING_TARGET_CONFLICT' },
    ])
  },
)

test.skipIf(!runnable)(
  'the deferred loader reports one target on the module and the instance',
  async (t) => {
    const { status, output, outcome } = await withGeneratedLoader(
      'deferred-benign',
      deferredLoader(),
      DEFERRED_BODY,
      false,
    )
    t.is(status, 0, output)
    t.deepEqual(outcome, [
      { code: null, moduleTarget: TARGET, bindingTarget: TARGET, sum: 3 },
      { code: null, moduleTarget: TARGET, bindingTarget: TARGET, sum: 3 },
    ])
  },
)
