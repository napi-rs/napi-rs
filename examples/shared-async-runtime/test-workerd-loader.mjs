// The generated deferred ("workerd") loader, driven under Node. It owns one
// CurrentThread task host and one timer host per instance it creates, which is
// what the workerd lane depends on: there are no worker threads and no
// `beforeExit` there. Node is the cheapest place to run that code path — the
// loader is plain ESM with no host-specific API — and this example is the only
// one whose binding exports the CurrentThread host protocol.
//
// Run `yarn workspace @examples/shared-async-runtime build:wasi` first (the CI
// job does); this file only loads the generated artifacts.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const loaderUrl = new URL(
  './shared_async_runtime.wasip1-deferred.js',
  import.meta.url,
)
const loaderSource = await readFile(loaderUrl, 'utf8')
const loader = await import(loaderUrl.href)
const wasmModule = await WebAssembly.compile(
  await readFile(
    new URL('./shared_async_runtime.wasm32-wasip1.wasm', import.meta.url),
  ),
)

test('the loader pulls its hosts from the isolate-safe subpath', () => {
  // The barrel would drag `current-thread-hosts.cjs` — the realm-global
  // registry and the Node timer-handle bookkeeping — into a worker bundle.
  assert.match(loaderSource, /from '@napi-rs\/async-runtime\/workerd'/)
  assert.doesNotMatch(loaderSource, /from '@napi-rs\/async-runtime'/)
  assert.match(loaderSource, /__registerWorkerdCurrentThreadTaskHost\(/)
  assert.match(loaderSource, /__registerWorkerdTimerHost\(/)
  // Nothing is allocated in global scope; workerd forbids it. Every
  // `new WebAssembly.Memory` lives inside `__resolveInstanceMemory`, which
  // only `__createInstance` calls.
  assert.doesNotMatch(
    loaderSource.slice(
      0,
      loaderSource.indexOf('function __resolveInstanceMemory('),
    ),
    /new WebAssembly\.Memory\(/,
  )
  assert.equal(
    loaderSource.split('new WebAssembly.Memory(').length - 1,
    1,
    'the loader must allocate memory in exactly one place',
  )
})

test('exposes the configured memory floor and zeroed stats', () => {
  assert.equal(loader.WASM_MEMORY.pageBytes, 65536)
  assert.equal(
    loader.WASM_MEMORY.initialBytes,
    loader.WASM_MEMORY.initialPages * 65536,
  )
  assert.equal(
    loader.WASM_MEMORY.maximumBytes,
    loader.WASM_MEMORY.maximumPages * 65536,
  )
  assert.equal(Object.isFrozen(loader.WASM_MEMORY), true)
  const stats = loader.getDeferredRuntimeStats()
  assert.equal(stats.liveInstances, 0)
  assert.equal(
    stats.declaredInitialMemoryBytes,
    loader.WASM_MEMORY.initialBytes,
  )
})

test('registers hosts, runs async work, and disposes exactly once', async () => {
  const before = loader.getDeferredRuntimeStats()
  const instance = await loader.createInstance(wasmModule)
  try {
    const during = loader.getDeferredRuntimeStats()
    assert.equal(during.liveInstances, before.liveInstances + 1)
    assert.equal(during.createdInstances, before.createdInstances + 1)
    assert.ok(instance.memory instanceof WebAssembly.Memory)
    assert.equal(instance.memoryBytes, instance.memory.buffer.byteLength)
    assert.ok(instance.memoryBytes >= loader.WASM_MEMORY.initialBytes)
    assert.equal(instance.disposed, false)
    // Proves the task host is live: without a CurrentThread driver this never
    // settles. `sleepThenAdd` additionally proves the timer host is wired.
    assert.equal(await instance.exports.plus100(1), 101)
    const started = performance.now()
    assert.equal(await instance.exports.sleepThenAdd(20, 22, 60), 42)
    assert.ok(
      performance.now() - started >= 55,
      'the sleep must actually elapse through the JS timer relay',
    )
    assert.equal(
      await instance.exports.blockingSum([1, 2, 3, 4, 5]),
      15,
      'the blocking lane must run on the loader-owned task host too',
    )
  } finally {
    await instance.dispose()
  }
  assert.equal(instance.disposed, true)
  assert.equal(instance.memoryBytes, 0)
  // The Memory object itself outlives the environment.
  assert.ok(instance.memory instanceof WebAssembly.Memory)
  assert.equal(
    loader.getDeferredRuntimeStats().liveInstances,
    before.liveInstances,
  )
  await instance.dispose()
  assert.equal(
    loader.getDeferredRuntimeStats().liveInstances,
    before.liveInstances,
    'a repeated dispose() must not decrement twice',
  )
})

test('the loader-owned hosts are per instance, not realm-global', async () => {
  const [first, second] = await Promise.all([
    loader.createInstance(wasmModule),
    loader.createInstance(wasmModule),
  ])
  try {
    assert.notEqual(first.memory, second.memory)
    assert.notEqual(first.exports, second.exports)
    assert.deepEqual(
      await Promise.all([first.exports.plus100(1), second.exports.plus100(2)]),
      [101, 102],
    )
    // Disposing one instance must not stop the other's driver.
    await first.dispose()
    assert.equal(await second.exports.plus100(3), 103)
  } finally {
    await second.dispose()
  }
})

test('accepts caller-selected memory pages', async () => {
  const pages = loader.WASM_MEMORY.initialPages + 32
  const instance = await loader.createInstance(wasmModule, {
    initialMemoryPages: pages,
    maximumMemoryPages: loader.WASM_MEMORY.maximumPages,
  })
  try {
    assert.equal(instance.memoryBytes, pages * 65536)
    assert.equal(await instance.exports.plus100(7), 107)
  } finally {
    await instance.dispose()
  }
})

test('claims a caller-provided memory exactly once', async () => {
  const memory = new WebAssembly.Memory({
    initial: loader.WASM_MEMORY.initialPages,
    maximum: loader.WASM_MEMORY.maximumPages,
  })
  const instance = await loader.createInstance(wasmModule, { memory })
  assert.equal(instance.memory, memory)
  await assert.rejects(
    loader.createInstance(wasmModule, { memory }),
    /already been used/,
  )
  await assert.rejects(
    loader.createInstance(wasmModule, { memory, initialMemoryPages: 10 }),
    /not both/,
  )
  await instance.dispose()
  // A disposed instance does not release the claim: the bytes it wrote are
  // still there.
  await assert.rejects(
    loader.createInstance(wasmModule, { memory }),
    /already been used/,
  )
})

test('rejects memory that is not an unshared WebAssembly.Memory', async () => {
  await assert.rejects(
    loader.createInstance(wasmModule, {
      memory: new WebAssembly.Memory({ initial: 1, maximum: 2, shared: true }),
    }),
    /unshared WebAssembly\.Memory/,
  )
  await assert.rejects(
    loader.createInstance(wasmModule, {
      memory: Object.create(WebAssembly.Memory.prototype),
    }),
    /unshared WebAssembly\.Memory/,
  )
})

test('the singleton entry still works alongside independent instances', async () => {
  const binding = await loader.instantiate(wasmModule)
  assert.equal(await binding.plus100(5), 105)
  assert.equal(binding.getCurrentThreadTaskHostContractVersion(), 4)
  await loader.dispose()
  assert.equal(loader.getDeferredRuntimeStats().liveInstances, 0)
})
