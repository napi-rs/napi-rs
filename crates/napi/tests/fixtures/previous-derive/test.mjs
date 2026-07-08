import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const extension =
  process.platform === 'darwin'
    ? 'dylib'
    : process.platform === 'win32'
      ? 'dll'
      : 'so'
const prefix = process.platform === 'win32' ? '' : 'lib'
const addonPath = fileURLToPath(
  new URL(
    `target/debug/${prefix}napi_previous_derive_compat.${extension}`,
    import.meta.url,
  ),
)

assert.ok(existsSync(addonPath), `missing previous-derive addon: ${addonPath}`)

function loadAddon() {
  const module = { exports: {} }
  process.dlopen(module, addonPath)
  return module.exports
}

const first = loadAddon()
const second = loadAddon()

for (const [binding, value] of [
  [first, 11],
  [second, 22],
]) {
  const instance = binding.previousGeneratedClass(value)
  assert.ok(instance instanceof binding.PreviousGeneratedClass)
  assert.equal(instance.value, value)
  assert.equal(binding.previousGeneratedClassValue(instance), value)

  const factoryInstance = binding.PreviousGeneratedClass.create(value + 1)
  assert.ok(factoryInstance instanceof binding.PreviousGeneratedClass)
  assert.equal(factoryInstance.value, value + 1)

  const external = binding.previousGeneratedExternal(value + 2)
  assert.equal(binding.previousGeneratedExternalValue(external), value + 2)

  const iterator = new binding.PreviousGeneratedIterator(value, value + 2)
  assert.deepEqual(iterator.next(), { done: false, value })
  assert.deepEqual(iterator.next(), { done: false, value: value + 1 })
  assert.deepEqual(iterator.next(), { done: true, value: undefined })

  const asyncIteratorOwner = new binding.PreviousGeneratedAsyncIterator(
    value,
    value + 2,
  )
  const asyncIterator = asyncIteratorOwner[Symbol.asyncIterator]()
  assert.deepEqual(await asyncIterator.next(), { done: false, value })
  assert.deepEqual(await asyncIterator.next(), {
    done: false,
    value: value + 1,
  })
  assert.deepEqual(await asyncIterator.next(), {
    done: true,
    value: undefined,
  })

  const returnedIterator = binding.previousGeneratedIterator(value, value + 1)
  assert.deepEqual(returnedIterator.next(), { done: false, value })

  const factoryIterator = binding.PreviousGeneratedIterator.create(
    value,
    value + 1,
  )
  assert.deepEqual(factoryIterator.next(), { done: false, value })

  const returnedAsyncIteratorOwner =
    await binding.previousGeneratedAsyncIterator(value, value + 1)
  const returnedAsyncIterator =
    returnedAsyncIteratorOwner[Symbol.asyncIterator]()
  assert.deepEqual(await returnedAsyncIterator.next(), {
    done: false,
    value,
  })

  const factoryAsyncIteratorOwner =
    binding.PreviousGeneratedAsyncIterator.create(value, value + 1)
  const factoryAsyncIterator = factoryAsyncIteratorOwner[Symbol.asyncIterator]()
  assert.deepEqual(await factoryAsyncIterator.next(), {
    done: false,
    value,
  })
}

const before = first.previousRuntimeEnterCount()
assert.equal(first.previousGeneratedRuntimeEntry(), 42)
assert.equal(second.previousGeneratedRuntimeEntry(), 42)
assert.equal(first.previousGeneratedRuntimeHasTokioHandle(), true)
assert.equal(second.previousGeneratedRuntimeHasTokioHandle(), true)
assert.equal(
  first.previousRuntimeEnterCount(),
  before,
  'napi-derive 3.5.9 synchronous async_runtime guards use the established Tokio compatibility helper in a combined build',
)

const asyncSpawnsBefore = first.previousRuntimeSpawnCount()
assert.equal(await first.previousGeneratedAsyncExport(31), 31)
assert.equal(await second.previousGeneratedAsyncExport(32), 32)
const firstAsyncClass = await first.previousGeneratedAsyncClass(41)
const secondAsyncClass = await second.previousGeneratedAsyncClass(42)
assert.ok(firstAsyncClass instanceof first.PreviousGeneratedClass)
assert.ok(secondAsyncClass instanceof second.PreviousGeneratedClass)
assert.equal(firstAsyncClass.value, 41)
assert.equal(secondAsyncClass.value, 42)
assert.equal(
  first.previousRuntimeSpawnCount(),
  asyncSpawnsBefore + 4,
  'legacy generated async exports must still use the selected custom backend',
)

async function assertLegacyInstallerThrows(property, construct) {
  const originalSymbol = globalThis.Symbol
  globalThis.Symbol = {}

  let error
  try {
    await construct()
  } catch (caught) {
    error = caught
  } finally {
    globalThis.Symbol = originalSymbol
  }

  assert.ok(error, `legacy ${property} installer must throw`)
  assert.match(
    String(error),
    new RegExp(`Failed to define Symbol\\.${property}`),
  )
}

async function assertLegacyInstallerPreservesException(property, construct) {
  const originalSymbol = globalThis.Symbol
  const marker = { property }
  globalThis.Symbol = new Proxy(originalSymbol, {
    get(target, key, receiver) {
      if (key === property) {
        throw marker
      }
      return Reflect.get(target, key, receiver)
    },
  })

  let error
  try {
    await construct()
  } catch (caught) {
    error = caught
  } finally {
    globalThis.Symbol = originalSymbol
  }

  assert.equal(error, marker)
}

await assertLegacyInstallerThrows('iterator', () =>
  first.previousGeneratedIterator(0, 1),
)
await assertLegacyInstallerThrows('iterator', () =>
  first.PreviousGeneratedIterator.create(0, 1),
)
await assertLegacyInstallerThrows('asyncIterator', () =>
  first.previousGeneratedAsyncIterator(0, 1),
)
await assertLegacyInstallerThrows('asyncIterator', () =>
  first.PreviousGeneratedAsyncIterator.create(0, 1),
)
await assertLegacyInstallerPreservesException('iterator', () =>
  first.previousGeneratedIterator(0, 1),
)
await assertLegacyInstallerPreservesException('iterator', () =>
  first.PreviousGeneratedIterator.create(0, 1),
)
await assertLegacyInstallerPreservesException('asyncIterator', () =>
  first.previousGeneratedAsyncIterator(0, 1),
)
await assertLegacyInstallerPreservesException('asyncIterator', () =>
  first.PreviousGeneratedAsyncIterator.create(0, 1),
)
