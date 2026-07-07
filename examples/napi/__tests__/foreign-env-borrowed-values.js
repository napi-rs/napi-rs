import assert from 'node:assert/strict'
import { createRequire, Module } from 'node:module'
import { setTimeout as delay } from 'node:timers/promises'

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

  const duplicateModule = new Module(`${nativeModule.filename}:borrowed-values`)
  duplicateModule.filename = nativeModule.filename
  process.dlopen(duplicateModule, nativeModule.filename)
  retained.push(duplicateModule)
  return duplicateModule.exports
}

function withBorrowedValues(fixture, callback) {
  const value = { owner: 'original' }
  const bufferSliceRef = Buffer.from([11, 22, 33])
  const bufferSliceIntoBuffer = Buffer.from([44, 55, 66])
  fixture.withBorrowedValuesAcrossDuplicateLoad(
    value,
    bufferSliceRef,
    bufferSliceIntoBuffer,
    () => callback({ value, bufferSliceRef, bufferSliceIntoBuffer }),
  )
}

const additionalBorrowedKinds = [
  'js-string-ref',
  'object-ref',
  'utf8-string',
  'utf16-string',
  'latin1-string',
  'deprecated-object',
  'deprecated-boolean',
]

function withAdditionalBorrowedValues(fixture, callback) {
  const values = {
    'js-string-ref': 'borrowed JsString',
    'object-ref': { wrapper: 'Object' },
    'utf8-string': 'borrowed UTF-8',
    'utf16-string': 'borrowed UTF-16',
    'latin1-string': 'borrowed Latin-1',
    'deprecated-object': { wrapper: 'JsObject' },
    'deprecated-boolean': true,
  }
  fixture.withAdditionalBorrowedValuesAcrossDuplicateLoad(
    values['js-string-ref'],
    values['object-ref'],
    values['utf8-string'],
    values['utf16-string'],
    values['latin1-string'],
    values['deprecated-object'],
    values['deprecated-boolean'],
    () => callback(values),
  )
}

const referenceKinds = [
  'legacy-ref',
  'legacy-ref-env-get',
  'legacy-ref-env-get-unchecked',
  'unknown-ref',
  'unknown-ref-borrowed',
  'symbol-ref',
  'symbol-ref-borrowed',
  'object-ref',
  'object-ref-borrowed',
  'function-ref',
  'class-instance-as-object',
  'class-reference',
  'class-weak-reference',
  'class-shared-reference',
]

function withReferenceValues(binding, fixture, callback) {
  const legacyRefValue = { wrapper: 'Ref' }
  const unknownRefValue = { wrapper: 'UnknownRef' }
  const symbolRefValue = Symbol('SymbolRef')
  const objectRefValue = { wrapper: 'ObjectRef' }
  const values = {
    'legacy-ref': legacyRefValue,
    'legacy-ref-env-get': legacyRefValue,
    'legacy-ref-env-get-unchecked': legacyRefValue,
    'unknown-ref': unknownRefValue,
    'unknown-ref-borrowed': unknownRefValue,
    'symbol-ref': symbolRefValue,
    'symbol-ref-borrowed': symbolRefValue,
    'object-ref': objectRefValue,
    'object-ref-borrowed': objectRefValue,
  }
  const animal = binding.Animal.withKind(binding.Kind.Dog)
  const lifecycleCallback = () => callback(values, animal)
  values['function-ref'] = lifecycleCallback
  fixture.withReferenceValuesAcrossDuplicateLoad(
    values['legacy-ref'],
    values['unknown-ref'],
    values['symbol-ref'],
    values['object-ref'],
    animal,
    lifecycleCallback,
  )
}

function assertForeignEnvInvalidArg(callback) {
  assert.throws(callback, (error) => {
    assert.equal(error.code, 'InvalidArg')
    assert.match(error.message, /different napi_env/)
    return true
  })
}

const binding = require('../index.cjs')
const originalFixture = binding
const duplicateFixture = loadDuplicate(binding)

withBorrowedValues(
  originalFixture,
  ({ value, bufferSliceRef, bufferSliceIntoBuffer }) => {
    assert.equal(originalFixture.takeBorrowedValueAcrossDuplicateLoad(), value)
    assert.equal(
      originalFixture.takeBufferSliceRefAcrossDuplicateLoad(),
      bufferSliceRef,
    )
    assert.equal(
      originalFixture.takeBufferSliceIntoBufferAcrossDuplicateLoad(),
      bufferSliceIntoBuffer,
    )
  },
)

withBorrowedValues(originalFixture, () => {
  assertForeignEnvInvalidArg(() =>
    duplicateFixture.takeBorrowedValueAcrossDuplicateLoad(),
  )
  assertForeignEnvInvalidArg(() =>
    duplicateFixture.takeBufferSliceRefAcrossDuplicateLoad(),
  )
  assertForeignEnvInvalidArg(() =>
    duplicateFixture.takeBufferSliceIntoBufferAcrossDuplicateLoad(),
  )
})

withAdditionalBorrowedValues(originalFixture, (values) => {
  for (const kind of additionalBorrowedKinds) {
    assert.equal(
      originalFixture.takeAdditionalBorrowedValueAcrossDuplicateLoad(kind),
      values[kind],
    )
  }
})

withAdditionalBorrowedValues(originalFixture, () => {
  for (const kind of additionalBorrowedKinds) {
    assertForeignEnvInvalidArg(() =>
      duplicateFixture.takeAdditionalBorrowedValueAcrossDuplicateLoad(kind),
    )
  }
})

withReferenceValues(binding, originalFixture, (values, animal) => {
  for (const kind of referenceKinds) {
    assert.equal(
      originalFixture.takeReferenceValueAcrossDuplicateLoad(kind),
      kind.startsWith('class-') ? animal : values[kind],
    )
  }
})

withReferenceValues(binding, originalFixture, () => {
  for (const kind of referenceKinds) {
    assertForeignEnvInvalidArg(() =>
      duplicateFixture.takeReferenceValueAcrossDuplicateLoad(kind),
    )
  }
})

withReferenceValues(binding, originalFixture, (_values, animal) => {
  originalFixture.assignClassInstanceAcrossDuplicateLoad(false)
  assert.equal(originalFixture.assignedClassInstance, animal)
  originalFixture.assignClassInstanceAcrossDuplicateLoad(true)
  assert.equal(originalFixture.assignedClassInstanceWithAttributes, animal)
})

withReferenceValues(binding, originalFixture, () => {
  assertForeignEnvInvalidArg(() =>
    duplicateFixture.assignClassInstanceAcrossDuplicateLoad(false),
  )
  assertForeignEnvInvalidArg(() =>
    duplicateFixture.assignClassInstanceAcrossDuplicateLoad(true),
  )
})

originalFixture.verifyReferenceValuesRejectNativeThread(
  { wrapper: 'Ref native thread' },
  { wrapper: 'UnknownRef native thread' },
  Symbol('SymbolRef native thread'),
  { wrapper: 'ObjectRef native thread' },
  () => {},
  Buffer.from([81, 82, 83]),
)
await new Promise((resolve) => setImmediate(resolve))

if (typeof global.gc !== 'function') {
  throw new Error('foreign-environment reference test requires --expose-gc')
}

const finalized = new Set()
const registry = new FinalizationRegistry((token) => finalized.add(token))

function createForeignReferenceCollectionProbes() {
  const legacyRefValue = { wrapper: 'collectable Ref' }
  const unknownRefValue = { wrapper: 'collectable UnknownRef' }
  const objectRefValue = { wrapper: 'collectable ObjectRef' }
  const probes = [
    ['legacy', legacyRefValue],
    ['unknown', unknownRefValue],
    ['object', objectRefValue],
  ].map(([token, value]) => {
    registry.register(value, token)
    return [token, new WeakRef(value)]
  })
  const animal = binding.Animal.withKind(binding.Kind.Dog)
  originalFixture.withReferenceValuesAcrossDuplicateLoad(
    legacyRefValue,
    unknownRefValue,
    Symbol('collectable SymbolRef'),
    objectRefValue,
    animal,
    () => {
      for (const kind of [
        'legacy-ref-env-get',
        'legacy-ref-env-get-unchecked',
        'unknown-ref-borrowed',
        'object-ref-borrowed',
      ]) {
        assertForeignEnvInvalidArg(() =>
          duplicateFixture.takeReferenceValueAcrossDuplicateLoad(kind),
        )
      }
    },
  )
  return probes
}

const collectionProbes = createForeignReferenceCollectionProbes()
const collectionDeadline = Date.now() + 15_000
let allReferencesCollected = false
while (!allReferencesCollected && Date.now() < collectionDeadline) {
  global.gc()
  const pressure = new ArrayBuffer(1024 * 1024)
  assert.equal(pressure.byteLength, 1024 * 1024)
  await delay(10)
  allReferencesCollected = collectionProbes.every(
    ([, reference]) => reference.deref() === undefined,
  )
  if (!allReferencesCollected) {
    await delay(0)
  }
}
for (const [token, reference] of collectionProbes) {
  assert.equal(
    reference.deref(),
    undefined,
    `${token} reference remained live; finalized=${[...finalized].sort().join(',')}`,
  )
}

retained.push(binding, originalFixture, duplicateFixture)
