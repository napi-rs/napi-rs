import assert from 'node:assert/strict'
import { createRequire, Module } from 'node:module'

const require = createRequire(import.meta.url)
const retained = []

function loadDuplicate(binding) {
  const nativeModule = Object.values(require.cache).find(
    (loadedModule) =>
      loadedModule?.filename?.endsWith('.node') &&
      loadedModule.exports?.add === binding.add,
  )
  if (!nativeModule) {
    throw new Error('loaded native binding was not found in the require cache')
  }

  const duplicateModule = new Module(`${nativeModule.filename}:tsfn-env`)
  duplicateModule.filename = nativeModule.filename
  process.dlopen(duplicateModule, nativeModule.filename)
  retained.push(duplicateModule)
  return duplicateModule.exports
}

function assertForeignEnvInvalidArg(callback, operation) {
  assert.throws(callback, (error) => {
    assert.equal(error.code, 'InvalidArg', operation)
    assert.match(error.message, /different napi_env/, operation)
    return true
  })
}

const binding = require('../index.cjs')
binding.stashThreadsafeFunctionForEnvOwnership(() => {})
binding.verifyThreadsafeFunctionOwnerEnv()

const duplicate = loadDuplicate(binding)
assertForeignEnvInvalidArg(
  () => duplicate.referThreadsafeFunctionForEnvOwnership(),
  'ThreadsafeFunction::refer',
)
assertForeignEnvInvalidArg(
  () => duplicate.unrefThreadsafeFunctionForEnvOwnership(),
  'ThreadsafeFunction::unref',
)

binding.disposeThreadsafeFunctionForEnvOwnership()
console.log('threadsafe-function foreign-env checks passed')
