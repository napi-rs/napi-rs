import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { setTimeout as delay } from 'node:timers/promises'

import { platformArchTriples } from '@napi-rs/triples'

const require = createRequire(import.meta.url)

if (typeof global.gc !== 'function') {
  throw new Error('WeakReference GC test requires --expose-gc')
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
    if (process.arch === 'arm' && abi === 'gnu') {
      return 'example.linux-arm-gnueabihf.node'
    }
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
    await delay(10)
    if (predicate()) {
      return
    }
    await delay(0)
  }
  throw new Error(message)
}

binding.resetWeakReferenceGcTargetFinalizeCount()

function createFixture() {
  let target = new binding.WeakReferenceGcTarget(42)
  const holder = new binding.WeakReferenceGcHolder(target)
  return {
    holder,
    releaseTarget() {
      target = undefined
    },
  }
}

const fixture = createFixture()
let callbackCalled = false
const value = fixture.holder.withTarget(() => {
  fixture.releaseTarget()
  for (let index = 0; index < 8; index += 1) {
    global.gc()
  }
  callbackCalled = true
  assert.equal(binding.weakReferenceGcTargetFinalizeCount(), 0)
})

assert.equal(callbackCalled, true)
assert.equal(value, 42)
assert.equal(binding.weakReferenceGcTargetFinalizeCount(), 0)

await forceGcUntil(
  () => binding.weakReferenceGcTargetFinalizeCount() === 1,
  'WeakReference target was not finalized after withTarget returned',
)

console.log('WeakReference GC pinning passed')
