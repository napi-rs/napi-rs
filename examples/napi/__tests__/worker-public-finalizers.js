import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { Worker } from 'node:worker_threads'

import { asyncMultiTwo } from '../index.cjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const resultDirectory = await mkdtemp(
  join(tmpdir(), 'napi-runtime-module-finalizers-'),
)
const paths = {
  cleanup: join(resultDirectory, 'cleanup'),
  asyncCleanup: join(resultDirectory, 'async-cleanup'),
  instanceData: join(resultDirectory, 'instance-data'),
  external: join(resultDirectory, 'external'),
  runtimeObject: join(resultDirectory, 'runtime-object'),
  object: join(resultDirectory, 'object'),
  propertyClosurePanic: join(resultDirectory, 'property-closure-panic'),
  propertyClosureAfterPanic: join(
    resultDirectory,
    'property-closure-after-panic',
  ),
  latin1: join(resultDirectory, 'latin1'),
  utf16: join(resultDirectory, 'utf16'),
}
const worker = new Worker(
  `
    const { parentPort, workerData } = require('node:worker_threads')

    const lifecycle = {
      __napiRsLifecycleFixtureToken:
        'napi-rs-internal-lifecycle-fixture-v1',
      moduleFinalizers: {
        object: workerData.paths.object,
        propertyClosurePanic: workerData.paths.propertyClosurePanic,
        propertyClosureAfterPanic: workerData.paths.propertyClosureAfterPanic,
      },
    }
    globalThis.__NAPI_RS_LIFECYCLE_FIXTURE__ = lifecycle
    const native = require(workerData.addonPath)
    delete globalThis.__NAPI_RS_LIFECYCLE_FIXTURE__
    for (const name of [
      'RuntimeLifecycleFinalize',
      'runtimeLifecycleFinalizeResult',
      'pendingAsyncBlockWithTerminalFinalizer',
      'asyncBlockTerminalFinalizerCount',
      'configureTokioThreadStopFileBarrier',
      'tokioThreadStopCount',
      'registerEnvCleanupRuntimeLifecycleProbes',
      'setInstanceDataRuntimeLifecycleProbe',
      'createRuntimeLifecycleExternalProbe',
      'createRuntimeLifecycleExternalLatin1Probe',
      'createRuntimeLifecycleExternalUtf16Probe',
      '__napiRsModuleFinalizerPanic',
      '__napiRsModuleFinalizerAfterPanic',
    ]) {
      if (Object.hasOwn(native, name)) {
        throw new Error(\`lifecycle fixture export leaked: \${name}\`)
      }
    }

    lifecycle.registerEnvCleanupRuntimeLifecycleProbes(
      workerData.paths.cleanup,
      workerData.paths.asyncCleanup,
    )
    lifecycle.setInstanceDataRuntimeLifecycleProbe(
      workerData.paths.instanceData,
    )
    const retained = [
      new native.CustomFinalize(4, 4),
      lifecycle.createRuntimeLifecycleFinalizer(
        workerData.paths.runtimeObject,
      ),
      lifecycle.createRuntimeLifecycleExternalProbe(workerData.paths.external),
      lifecycle.createRuntimeLifecycleExternalLatin1Probe(
        workerData.paths.latin1,
      ),
      lifecycle.createRuntimeLifecycleExternalUtf16Probe(
        workerData.paths.utf16,
      ),
    ]

    parentPort.once('message', () => {
      if (retained.length !== 5) {
        throw new Error('worker finalizer values were not retained')
      }
      parentPort.close()
    })
    parentPort.postMessage('ready')
  `,
  {
    eval: true,
    env: process.env,
    workerData: {
      addonPath: join(__dirname, '..', 'index.cjs'),
      paths,
    },
  },
)

try {
  let workerError
  let rejectWorkerFailure
  const workerFailure = new Promise((_, reject) => {
    rejectWorkerFailure = reject
  })
  const onWorkerError = (error) => {
    workerError ??= error
    rejectWorkerFailure(error)
  }
  worker.on('error', onWorkerError)
  let workerExited = false
  const workerExit = new Promise((resolve) => {
    worker.once('exit', (code) => {
      workerExited = true
      resolve(code)
    })
  })
  try {
    const ready = new Promise((resolve) => {
      worker.once('message', resolve)
    })
    assert.equal(
      await Promise.race([
        ready,
        workerFailure,
        workerExit.then((code) => {
          throw (
            workerError ??
            new Error(`worker exited with code ${code} before finalizer setup`)
          )
        }),
      ]),
      'ready',
    )
    worker.postMessage('exit')
    const exitCode = await Promise.race([workerExit, workerFailure])
    if (workerError) {
      throw workerError
    }
    assert.equal(
      exitCode,
      0,
      workerError?.stack ??
        new Error(`finalizer worker exited with code ${exitCode}`).stack,
    )
  } finally {
    worker.off('error', onWorkerError)
    if (!workerExited) {
      try {
        await worker.terminate()
      } catch {}
    }
    worker.unref()
  }

  const deadline = Date.now() + 5_000
  const results = new Map()
  while (results.size !== Object.keys(paths).length && Date.now() < deadline) {
    for (const [name, path] of Object.entries(paths)) {
      if (!results.has(name)) {
        try {
          results.set(name, await readFile(path, 'utf8'))
        } catch {}
      }
    }
    if (results.size !== Object.keys(paths).length) {
      await delay(10)
    }
  }

  assert.deepEqual(Object.fromEntries(results), {
    cleanup: '0',
    asyncCleanup: '0',
    instanceData: '0',
    external: '0',
    runtimeObject: '0',
    object: '0',
    propertyClosurePanic: '0',
    propertyClosureAfterPanic: '0',
    latin1: '0',
    utf16: '0',
  })
  assert.equal(await asyncMultiTwo(2), 4)
  process.stdout.write('worker public finalizers passed\n')
} finally {
  worker.unref()
  await rm(resultDirectory, { recursive: true, force: true })
}
