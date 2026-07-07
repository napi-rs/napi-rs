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
}

const before = first.previousRuntimeEnterCount()
assert.equal(first.previousGeneratedRuntimeEntry(), 42)
assert.equal(second.previousGeneratedRuntimeEntry(), 42)
assert.equal(first.previousRuntimeEnterCount(), before + 2)

assert.equal(await first.previousGeneratedAsyncExport(31), 31)
assert.equal(await second.previousGeneratedAsyncExport(32), 32)
const firstAsyncClass = await first.previousGeneratedAsyncClass(41)
const secondAsyncClass = await second.previousGeneratedAsyncClass(42)
assert.ok(firstAsyncClass instanceof first.PreviousGeneratedClass)
assert.ok(secondAsyncClass instanceof second.PreviousGeneratedClass)
assert.equal(firstAsyncClass.value, 41)
assert.equal(secondAsyncClass.value, 42)
