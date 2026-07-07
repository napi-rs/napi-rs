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

  const duplicateModule = new Module(`${nativeModule.filename}:typed-arrays`)
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

function run(operation, callback) {
  try {
    return callback()
  } catch (error) {
    throw new Error(`${operation}: ${error.message}`, { cause: error })
  }
}

const binding = require('../index.cjs')
const originalFixture = binding
const typedArray = Uint8Array.from([11, 22, 33])
const clampedArray = Uint8ClampedArray.from([44, 55, 66])
run('verify same-env TypedArray slices', () =>
  originalFixture.verifyTypedArraySlicesSameEnv(typedArray, clampedArray),
)
assert.equal(originalFixture.typedArraySlice, typedArray)
assert.equal(originalFixture.clampedTypedArraySlice, clampedArray)
run('stash TypedArray slices', () =>
  originalFixture.stashTypedArraySlicesAcrossDuplicateLoad(
    typedArray,
    clampedArray,
  ),
)

const duplicateFixture = loadDuplicate(binding)
for (const [operation, callback] of [
  [
    'ToNapiValue for &TypedArraySlice',
    () => duplicateFixture.returnTypedArraySliceRefAcrossDuplicateLoad(),
  ],
  [
    'ToNapiValue for &mut TypedArraySlice',
    () => duplicateFixture.returnTypedArraySliceMutAcrossDuplicateLoad(),
  ],
  [
    'TypedArraySlice::assign_to_this',
    () => duplicateFixture.assignTypedArraySliceAcrossDuplicateLoad(),
  ],
  [
    'TypedArraySlice::into_typed_array',
    () => duplicateFixture.convertTypedArraySliceAcrossDuplicateLoad(),
  ],
  [
    'Uint8ClampedSlice::assign_to_this',
    () => duplicateFixture.assignClampedSliceAcrossDuplicateLoad(),
  ],
  [
    'Uint8ClampedSlice::into_typed_array',
    () => duplicateFixture.convertClampedSliceAcrossDuplicateLoad(),
  ],
]) {
  assertForeignEnvInvalidArg(callback, operation)
}

assert.equal(duplicateFixture.typedArraySlice, undefined)
assert.equal(duplicateFixture.clampedTypedArraySlice, undefined)
retained.push(typedArray, clampedArray)

console.log('typed-array foreign-env checks passed')
