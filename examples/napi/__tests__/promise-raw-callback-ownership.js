import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { setTimeout as delay } from 'node:timers/promises'

import { platformArchTriples } from '@napi-rs/triples'

const require = createRequire(import.meta.url)

if (typeof global.gc !== 'function') {
  throw new Error('PromiseRaw callback ownership test requires --expose-gc')
}

function nativeBinaryName() {
  const platforms = platformArchTriples[process.platform][process.arch]
  if (platforms.length === 1) {
    return `example.${platforms[0].platformArchABI}.node`
  }
  if (process.platform === 'linux') {
    const abi = process.report?.getReport?.()?.header.glibcVersionRuntime
      ? 'gnu'
      : 'musl'
    const platform = platforms.find((candidate) => candidate.abi === abi)
    return `example.${platform.platformArchABI}.node`
  }
  if (process.platform === 'win32') {
    const platform = platforms.find((candidate) => candidate.abi === 'msvc')
    return `example.${platform.platformArchABI}.node`
  }
  throw new Error(`unsupported platform: ${process.platform}`)
}

const binding = require(`../${nativeBinaryName()}`)

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

async function forceGcRounds(rounds = 4) {
  for (let index = 0; index < rounds; index += 1) {
    global.gc()
    await delay(10)
  }
}

binding.resetPromiseRawCallbackDropCount()

await binding.promiseRawThenCallbackDropProbe(Promise.resolve())
await binding.promiseRawCatchCallbackDropProbe(Promise.reject('expected'))
await binding.promiseRawFinallyCallbackDropProbe(Promise.resolve())
assert.equal(binding.promiseRawCallbackDropCount(), 3)
await forceGcRounds()
assert.equal(binding.promiseRawCallbackDropCount(), 3)

await assert.rejects(
  binding.promiseRawThenCallbackPanic(Promise.resolve()),
  /PromiseRaw then callback panic/,
)
await assert.rejects(
  binding.promiseRawCatchCallbackPanic(Promise.reject('expected')),
  /PromiseRaw catch callback panic/,
)
await assert.rejects(
  binding.promiseRawFinallyCallbackPanic(Promise.resolve()),
  /PromiseRaw finally callback panic/,
)
assert.equal(binding.promiseRawCallbackDropCount(), 6)
await forceGcRounds()
assert.equal(binding.promiseRawCallbackDropCount(), 6)

async function verifyReturnedPromiseDoesNotOwnCallback() {
  let resolveSource
  let source = new Promise((resolve) => {
    resolveSource = resolve
  })
  Object.defineProperty(source, 'catch', {
    configurable: true,
    value(callback) {
      Promise.prototype.catch.call(source, callback)
      return Promise.resolve('unrelated')
    },
  })

  let returned = binding.promiseRawCatchCallbackDropProbe(source)
  const returnedReference = new WeakRef(returned)
  returned = undefined
  await forceGcUntil(
    () => returnedReference.deref() === undefined,
    'unrelated Promise returned by catch remained reachable',
  )
  assert.equal(binding.promiseRawCallbackDropCount(), 6)

  resolveSource()
  await delay(0)
  source = undefined
  await forceGcUntil(
    () => binding.promiseRawCallbackDropCount() === 7,
    'callback remained retained after its source Promise settled',
  )
}

await verifyReturnedPromiseDoesNotOwnCallback()
await forceGcRounds()
assert.equal(binding.promiseRawCallbackDropCount(), 7)

const retainedCallbacks = []

function exerciseThrowingMethod(method, probe, message) {
  const source = new Promise(() => {})
  Object.defineProperty(source, method, {
    configurable: true,
    value(callback) {
      retainedCallbacks.push(callback)
      throw new Error(message)
    },
  })
  assert.throws(() => probe(source), { message })
}

exerciseThrowingMethod(
  'then',
  binding.promiseRawThenCallbackDropProbe,
  'then call failed',
)
exerciseThrowingMethod(
  'catch',
  binding.promiseRawCatchCallbackDropProbe,
  'catch call failed',
)
exerciseThrowingMethod(
  'finally',
  binding.promiseRawFinallyCallbackDropProbe,
  'finally call failed',
)

assert.equal(binding.promiseRawCallbackDropCount(), 7)
retainedCallbacks.length = 0
await forceGcUntil(
  () => binding.promiseRawCallbackDropCount() === 10,
  'callbacks retained by throwing Promise methods were not finalized',
)
await forceGcRounds()
assert.equal(binding.promiseRawCallbackDropCount(), 10)

function createNeverInvokedCallbacks() {
  const source = new Promise(() => {})
  binding.promiseRawThenCallbackDropProbe(source)
  binding.promiseRawCatchCallbackDropProbe(source)
  binding.promiseRawFinallyCallbackDropProbe(source)
}

createNeverInvokedCallbacks()
await forceGcUntil(
  () => binding.promiseRawCallbackDropCount() === 13,
  'callbacks on never-settled Promises were not finalized',
)
await forceGcRounds()
assert.equal(binding.promiseRawCallbackDropCount(), 13)

console.log('PromiseRaw callback ownership passed')
