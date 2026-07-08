import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import test from 'ava'

import { unsupportedWasiFunctions } from '../unsupported-wasi-exports.mjs'

const require = createRequire(import.meta.url)
const __dirname = dirname(fileURLToPath(import.meta.url))
const isWasi = Boolean(process.env.WASI_TEST)
if (isWasi) {
  process.env.NAPI_RS_FORCE_WASI = 'true'
}
const binding = require('../index.cjs')

const optionalWasiNonFunctionExports = ['AnotherCSSStyleSheet', 'JsAsset']
const crossTargetLifecycleExports = [
  'asyncCleanupHookCounts',
  'createRuntimeLifecycleExternalLatin1Probe',
  'createRuntimeLifecycleExternalProbe',
  'createRuntimeLifecycleExternalUtf16Probe',
  'createRuntimeLifecycleFinalizer',
  'registerEnvCleanupRuntimeLifecycleProbes',
  'registerModuleFinalizerProbes',
  'registerRemovableAsyncCleanupHook',
  'registerRemovableSyncCleanupHook',
  'registerSelfDroppingAsyncCleanupHook',
  'registerSelfRemovingSyncCleanupHook',
  'removeRemovableAsyncCleanupHook',
  'removeRemovableSyncCleanupHook',
  'setInstanceDataRuntimeLifecycleProbe',
  'syncCleanupHookCounts',
  'pendingAsyncBlockWithTerminalFinalizer',
  'shutdownAsyncRuntimeForTest',
]
const wasiOnlyLifecycleExports = [
  'dropUnregisteredWeakTsfnForWasi',
  'startTokioWakerAfterCleanupProbe',
]
const threadedWasiBrowserTestExports = [
  'abortBoundedTsfnFromOwnerAgent',
  'boundedTsfnOwnerAbortState',
  'finishBoundedTsfnOwnerAbort',
  'prepareBoundedTsfnOwnerAbort',
  'releaseBoundedTsfnNativeWait',
]
const nativeFunctionExports = [
  ...new Set([...unsupportedWasiFunctions, ...crossTargetLifecycleExports]),
]
const lifecycleExports = isWasi
  ? [...nativeFunctionExports, ...wasiOnlyLifecycleExports]
  : nativeFunctionExports

test('lifecycle integration probes use ordinary addon exports', (t) => {
  for (const name of lifecycleExports) {
    t.is(typeof binding[name], 'function', name)
  }
  t.false(Object.hasOwn(globalThis, '__NAPI_RS_LIFECYCLE_FIXTURE__'))
  t.false(Object.hasOwn(globalThis, '__NAPI_RS_MODULE_FINALIZER_CONFIG__'))
})

test('generated JavaScript and declarations expose lifecycle integration probes', async (t) => {
  const generatedLifecycleExports = [
    ...new Set([...unsupportedWasiFunctions, ...crossTargetLifecycleExports]),
  ]
  for (const file of [
    'index.cjs',
    'index.d.cts',
    'example.wasi.cjs',
    'example.wasi-browser.js',
  ]) {
    const source = await readFile(join(__dirname, '..', file), 'utf8')
    for (const name of generatedLifecycleExports) {
      t.true(source.includes(name), `${file}: ${name}`)
    }
    for (const name of wasiOnlyLifecycleExports) {
      t.false(source.includes(name), `${file}: ${name}`)
    }
    if (file.startsWith('example.wasi')) {
      for (const name of threadedWasiBrowserTestExports) {
        t.true(source.includes(name), `${file}: ${name}`)
      }
    } else {
      for (const name of threadedWasiBrowserTestExports) {
        t.false(source.includes(name), `${file}: ${name}`)
      }
    }
    const helper =
      file === 'index.cjs'
        ? 'getBindingExport'
        : file.startsWith('example.wasi')
          ? 'getWasiBindingExport'
          : undefined
    if (helper) {
      for (const name of unsupportedWasiFunctions) {
        t.true(source.includes(`${helper}('${name}')`), `${file}: ${name}`)
      }
      const allowlistMatch = source.match(
        /const unsupportedWasiFunctions = new Set\(\[([\s\S]*?)\]\)/,
      )
      t.truthy(allowlistMatch, file)
      const allowlist = [
        ...(allowlistMatch?.[1].matchAll(/'([^']+)'/g) ?? []),
      ].map((match) => match[1])
      t.deepEqual(allowlist, unsupportedWasiFunctions, file)
    }
  }
})

test.skipIf(!isWasi)(
  'WASI exposes native-only stubs and preserves real lifecycle exports',
  (t) => {
    const directWasiBinding = require('../example.wasi.cjs')

    for (const name of unsupportedWasiFunctions) {
      t.is(typeof binding[name], 'function', name)
    }
    for (const name of [
      ...crossTargetLifecycleExports,
      ...wasiOnlyLifecycleExports,
    ]) {
      t.is(binding[name], directWasiBinding[name], name)
      t.is(typeof binding[name], 'function', name)
    }
    for (const name of optionalWasiNonFunctionExports) {
      t.is(binding[name], undefined, name)
      t.is(directWasiBinding[name], undefined, name)
    }

    const error = t.throws(() => binding.abandonDeferredClones()) as Error & {
      code: string
    }
    t.is(error.code, 'NAPI_RS_UNSUPPORTED_WASI_EXPORT')
    t.is(
      error.message,
      'The "abandonDeferredClones" export is not supported by this WASI binding',
    )
  },
)
