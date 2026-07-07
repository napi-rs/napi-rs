import assert from 'node:assert/strict'
import { Module } from 'node:module'
import { types } from 'node:util'
import { parentPort, workerData } from 'node:worker_threads'

const failedModule = new Module(`${workerData.addonPath}:cleanup-hook-failure`)
failedModule.filename = workerData.addonPath
let registrationError
try {
  process.dlopen(failedModule, workerData.addonPath)
} catch (error) {
  registrationError = error
}

assert(
  types.isNativeError(registrationError),
  'cleanup-hook registration failure must surface as a native error',
)
assert.match(registrationError.message, /Failed to add env cleanup hook/)
assert.doesNotMatch(
  registrationError.message,
  /async runtime rollback failed/,
  'custom runtime rollback must retain access to its paired Tokio runtime',
)

const recoveredModule = new Module(`${workerData.addonPath}:recovered`)
recoveredModule.filename = workerData.addonPath
process.dlopen(recoveredModule, workerData.addonPath)

assert.equal(recoveredModule.exports.moduleInitRollbackProbe(), 'ready')
assert.deepEqual(
  recoveredModule.exports.moduleInitRollbackRuntimeLifecycle(),
  [2, 1, 1, 0],
  'the failed registration must stop the custom runtime through Tokio before the recovered load restarts it',
)
assert.equal(await recoveredModule.exports.moduleInitRollbackAsyncProbe(41), 42)

parentPort.postMessage({ type: 'ready' })
