import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import test from 'ava'

const require = createRequire(import.meta.url)
const binding = require('../index.cjs')
const __dirname = dirname(fileURLToPath(import.meta.url))

const fixtureExports = [
  'RuntimeLifecycleFinalize',
  'runtimeLifecycleFinalizeResult',
  'pendingAsyncBlockWithTerminalFinalizer',
  'asyncBlockTerminalFinalizerCount',
  'shutdownAsyncRuntimeForTest',
  'configureTokioThreadStopFileBarrier',
  'tokioThreadStopCount',
  'registerEnvCleanupRuntimeLifecycleProbes',
  'setInstanceDataRuntimeLifecycleProbe',
  'createRuntimeLifecycleExternalProbe',
  'createRuntimeLifecycleExternalLatin1Probe',
  'createRuntimeLifecycleExternalUtf16Probe',
  'startReferencedTsfnFinalizerLivenessWorker',
  'startWeakTsfnFinalizerLivenessWorker',
  'prepareTsfnBlockingCallRegression',
  'prepareTsfnTeardownRegression',
  'verifyTsfnUnlimitedBlockingContention',
  'dropUnregisteredWeakTsfnForWasi',
  'armTokioWorkerTlsRetirementProbe',
  'armTokioBlockingTlsRetirementProbe',
  'waitForTokioRuntimeRetirement',
  'restartTokioRuntimeAfterRetirement',
  'tokioRuntimeLifecycleValue',
  'startTokioWakerAfterCleanupProbe',
]

test('lifecycle fixtures do not leak into the addon API', (t) => {
  for (const name of fixtureExports) {
    t.false(Object.hasOwn(binding, name), name)
  }
  t.false(Object.hasOwn(globalThis, '__NAPI_RS_LIFECYCLE_FIXTURE__'))
})

test('generated JavaScript and declarations omit lifecycle fixtures', async (t) => {
  for (const file of [
    'index.cjs',
    'index.d.cts',
    'example.wasi.cjs',
    'example.wasi-browser.js',
  ]) {
    const source = await readFile(join(__dirname, '..', file), 'utf8')
    for (const name of fixtureExports) {
      t.false(source.includes(name), `${file}: ${name}`)
    }
  }
})
