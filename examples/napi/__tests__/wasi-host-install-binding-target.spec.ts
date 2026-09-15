import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import test from 'ava'

const __dirname = dirname(fileURLToPath(import.meta.url))
const packageDirectory = join(__dirname, '..')

/** Both loaders under test are the threadless flavor's. */
const TARGET = 'wasm32-wasip1'
const wasmPath = join(packageDirectory, `example.${TARGET}.wasm`)
const browserLoaderPath = join(packageDirectory, 'example.wasip1-browser.js')
const deferredLoaderPath = join(packageDirectory, 'example.wasip1-deferred.js')

const isWasiLane = Boolean(
  process.env.WASI_TEST ?? process.env.NAPI_RS_TEST_THREADLESS_WASI_BUFFER,
)
const runnable =
  isWasiLane &&
  [wasmPath, browserLoaderPath, deferredLoaderPath].every((file) =>
    existsSync(file),
  )

/**
 * The statement the async runtime host installation is emitted directly in
 * front of, in both loaders. `installCurrentThreadHosts` (browser) and the
 * workerd task/timer hosts (deferred) hand the addon's own exports object to
 * registration functions the addon provides, so those can put anything on it —
 * including the reserved marker. Patching in front of this line is what a
 * registration hook doing exactly that looks like.
 *
 * examples/napi is not built with the async runtime, so the committed loaders
 * emit no host block to patch inside; the stamp's placement *relative* to that
 * block is pinned by the template tests in `cli/src/api/__tests__`, and what
 * these tests add is that the guard's throw is caught by the loader's own
 * initialization rollback rather than escaping a half-built environment.
 */
const STAMP_CALL =
  '__napiStampBindingTarget(__napiModule.exports, __napiBindingTarget)'

interface Outcome {
  code?: string | null
  moduleTarget?: string
  bindingTarget?: string
  sum?: number
}

/**
 * Copy a committed loader beside its `.wasm` — the browser loader resolves the
 * artifact against `import.meta.url` — optionally with a host hook that claims
 * the marker, then run `body` against it in a child.
 */
const withLoader = async (
  t: { true: (value: boolean, message?: string) => void },
  name: string,
  sourcePath: string,
  body: (loaderUrl: string) => string,
  claimsTarget: boolean,
): Promise<{ status: number | null; output: string; outcome: Outcome[] }> => {
  const source = await readFile(sourcePath, 'utf8')
  t.true(
    source.split(STAMP_CALL).length - 1 === 1,
    'the loader must stamp exactly once, at the line this test patches',
  )
  const probePath = join(
    packageDirectory,
    `.host-hook-${name}-${process.pid}.mjs`,
  )
  const indent = ' '.repeat(
    source.indexOf(STAMP_CALL) -
      source.lastIndexOf('\n', source.indexOf(STAMP_CALL)) -
      1,
  )
  await writeFile(
    probePath,
    claimsTarget
      ? source.replace(
          `${indent}${STAMP_CALL}`,
          `${indent}__napiModule.exports.__napiBindingTarget = 'native'\n${indent}${STAMP_CALL}`,
        )
      : source,
    'utf8',
  )
  try {
    const result = spawnSync(
      process.execPath,
      ['--input-type=module', '-e', body(pathToFileURL(probePath).href)],
      { encoding: 'utf8', env: process.env, timeout: 120_000 },
    )
    return {
      status: result.status,
      output: `${result.stdout}\n${result.stderr}`,
      outcome: result.stdout.trim() ? JSON.parse(result.stdout) : [],
    }
  } finally {
    await rm(probePath, { force: true })
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

test.skipIf(!runnable)(
  'the browser loader rejects a host installation that claims the binding target',
  async (t) => {
    const { status, output, outcome } = await withLoader(
      t,
      'browser-claims',
      browserLoaderPath,
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
    const { status, output, outcome } = await withLoader(
      t,
      'browser-benign',
      browserLoaderPath,
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
    const { status, output, outcome } = await withLoader(
      t,
      'deferred-claims',
      deferredLoaderPath,
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
    const { status, output, outcome } = await withLoader(
      t,
      'deferred-benign',
      deferredLoaderPath,
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
