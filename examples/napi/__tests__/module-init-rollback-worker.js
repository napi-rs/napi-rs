import assert from 'node:assert/strict'
import { Module } from 'node:module'
import { setTimeout as delay } from 'node:timers/promises'
import { parentPort, workerData } from 'node:worker_threads'

const failedLoadClasses = []
const failedLoadAsyncProbes = []
const expectedExports = new Set([
  'moduleInitRollbackProbe',
  'moduleInitRollbackAsyncProbe',
  'moduleInitRollbackDropBuffersOnNativeThread',
  'ModuleInitRollbackClass',
])

if (typeof global.gc !== 'function') {
  throw new Error('module-init rollback test requires --expose-gc')
}

async function withTimeout(promise, label) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out`)), 2_000)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

async function forceGcUntil(predicate, message) {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    global.gc()
    const pressure = new ArrayBuffer(1024 * 1024)
    assert.equal(pressure.byteLength, 1024 * 1024)
    await delay(10)
    if (predicate()) {
      return
    }
    await delay(0)
  }
  throw new Error(message)
}

async function failModuleInitWithCustomGcProbes(failedModule) {
  let probes = Array.from({ length: 32 }, () => Buffer.alloc(64 * 1024))
  const references = probes.map((probe) => new WeakRef(probe))
  const retainedExports = {}
  let buffersDropped = false
  failedModule.exports = new Proxy(retainedExports, {
    set(target, property, value) {
      Reflect.set(target, property, value)
      if (property === 'moduleInitRollbackDropBuffersOnNativeThread') {
        value(probes)
        buffersDropped = true
      }
      if (
        buffersDropped &&
        [...expectedExports].every((name) =>
          Object.prototype.hasOwnProperty.call(target, name),
        )
      ) {
        throw initializationError
      }
      return true
    },
  })
  const initializationError = new Error(
    'intentional module initialization failure after queuing custom-GC probes',
  )
  let observedError
  try {
    process.dlopen(failedModule, workerData.addonPath)
  } catch (error) {
    observedError = error
  } finally {
    probes = undefined
  }
  assert.equal(
    observedError,
    initializationError,
    'module registration must restore the original pending exception',
  )
  await delay(0)
  await forceGcUntil(
    () => references.every((reference) => reference.deref() === undefined),
    'Buffers queued during failed module initialization remained retained',
  )
}

async function verifyFailedLoadCustomGc(failedModule, attempt) {
  let probes = Array.from({ length: 32 }, () => Buffer.alloc(64 * 1024))
  const references = probes.map((probe) => new WeakRef(probe))
  failedModule.exports.moduleInitRollbackDropBuffersOnNativeThread(probes)
  probes = undefined
  await delay(0)
  await forceGcUntil(
    () => references.every((reference) => reference.deref() === undefined),
    `Buffers dropped after failed module initialization ${attempt} remained retained`,
  )
}

for (let attempt = 0; attempt < 2; attempt += 1) {
  const failedModule = new Module(`${workerData.addonPath}:failed:${attempt}`)
  failedModule.filename = workerData.addonPath
  await failModuleInitWithCustomGcProbes(failedModule)
  await verifyFailedLoadCustomGc(failedModule, attempt)
  const failedLoadProbe = failedModule.exports.moduleInitRollbackProbe
  assert.equal(typeof failedLoadProbe, 'function')
  assert.equal(failedLoadProbe(), 'ready')
  const failedLoadAsyncProbe = failedModule.exports.moduleInitRollbackAsyncProbe
  assert.equal(typeof failedLoadAsyncProbe, 'function')
  assert.equal(
    await withTimeout(
      failedLoadAsyncProbe(attempt),
      `failed-load async function ${attempt}`,
    ),
    attempt + 1,
  )
  const FailedLoadClass = failedModule.exports.ModuleInitRollbackClass
  const failedLoadValue = new FailedLoadClass(attempt).incremented()
  assert(failedLoadValue instanceof FailedLoadClass)
  assert.equal(failedLoadValue.value, attempt + 1)
  assert.equal(
    await withTimeout(
      new FailedLoadClass(attempt).incrementedAsync(),
      `failed-load async method ${attempt}`,
    ),
    attempt + 1,
  )
  failedLoadClasses.push(FailedLoadClass)
  failedLoadAsyncProbes.push(failedLoadAsyncProbe)
}

const successfulModule = new Module(`${workerData.addonPath}:success`)
successfulModule.filename = workerData.addonPath
process.dlopen(successfulModule, workerData.addonPath)
assert.equal(successfulModule.exports.moduleInitRollbackProbe(), 'ready')
assert.equal(
  await withTimeout(
    successfulModule.exports.moduleInitRollbackAsyncProbe(10),
    'successful-load async function',
  ),
  11,
)
const SuccessfulClass = successfulModule.exports.ModuleInitRollbackClass
const successfulValue = new SuccessfulClass(10).incremented()
assert(successfulValue instanceof SuccessfulClass)
assert.equal(successfulValue.value, 11)
assert.equal(
  await withTimeout(
    new SuccessfulClass(10).incrementedAsync(),
    'successful-load async method',
  ),
  11,
)

for (const [attempt, FailedLoadClass] of failedLoadClasses.entries()) {
  assert.notEqual(FailedLoadClass, SuccessfulClass)
  const failedLoadValue = new FailedLoadClass(attempt + 20).incremented()
  assert(failedLoadValue instanceof FailedLoadClass)
  assert(!(failedLoadValue instanceof SuccessfulClass))
  assert.equal(failedLoadValue.value, attempt + 21)
  assert.equal(
    await withTimeout(
      new FailedLoadClass(attempt + 20).incrementedAsync(),
      `recovered failed-load async method ${attempt}`,
    ),
    attempt + 21,
  )
  assert.equal(
    await withTimeout(
      failedLoadAsyncProbes[attempt](attempt + 20),
      `recovered failed-load async function ${attempt}`,
    ),
    attempt + 21,
  )
}

parentPort.postMessage({ type: 'ready' })
