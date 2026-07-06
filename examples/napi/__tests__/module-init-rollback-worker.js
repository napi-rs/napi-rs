import assert from 'node:assert/strict'
import { Module } from 'node:module'
import { parentPort, workerData } from 'node:worker_threads'

const failModuleInitGlobal = '__NAPI_RS_FAIL_MODULE_INIT__'

const failedModule = new Module(`${workerData.failedAddonPath}:failed`)
failedModule.filename = workerData.failedAddonPath
globalThis[failModuleInitGlobal] = true
try {
  assert.throws(
    () => process.dlopen(failedModule, workerData.failedAddonPath),
    /intentional module initialization failure/,
  )
} finally {
  delete globalThis[failModuleInitGlobal]
}

const successfulModule = new Module(`${workerData.successfulAddonPath}:success`)
successfulModule.filename = workerData.successfulAddonPath
process.dlopen(successfulModule, workerData.successfulAddonPath)
assert.equal(successfulModule.exports.moduleInitRollbackProbe(), 'ready')

parentPort.postMessage({ type: 'ready' })
