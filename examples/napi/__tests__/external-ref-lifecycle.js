import assert from 'node:assert/strict'
import { createRequire, Module } from 'node:module'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { Worker } from 'node:worker_threads'

const require = createRequire(import.meta.url)
const __dirname = dirname(fileURLToPath(import.meta.url))
const addonPath = join(__dirname, '..', 'index.cjs')
const retained = []

if (typeof global.gc !== 'function') {
  throw new Error('External lifecycle test requires --expose-gc')
}

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

function loadDuplicate(binding) {
  const nativeModule = Object.values(require.cache).find(
    (loadedModule) =>
      loadedModule?.filename?.endsWith('.node') &&
      loadedModule.exports?.add === binding.add,
  )
  if (!nativeModule) {
    throw new Error('loaded native binding was not found in the require cache')
  }

  const duplicateModule = new Module(`${nativeModule.filename}:external-ref`)
  duplicateModule.filename = nativeModule.filename
  process.dlopen(duplicateModule, nativeModule.filename)
  retained.push(duplicateModule)
  return duplicateModule.exports
}

function assertForeignEnvInvalidArg(callback) {
  assert.throws(callback, (error) => {
    assert.equal(error.code, 'InvalidArg')
    assert.match(error.message, /different napi_env/)
    return true
  })
}

function assertInvalidExternalProvenance(callback) {
  assert.throws(callback, (error) => {
    assert.equal(error.code, 'InvalidArg')
    assert.match(
      error.message,
      /not backed by a shareable napi-rs allocation|is not the type of wrapped object|does not belong to this JavaScript External value/,
    )
    return true
  })
}

const binding = require('../index.cjs')
const fixture = binding
for (const forged of [false, true]) {
  const foreignExternal = binding.createExternalRefProvenanceProbe(forged)
  assertInvalidExternalProvenance(() => fixture.getExternal(foreignExternal))
  assertInvalidExternalProvenance(() =>
    fixture.inspectExternalRefAcrossDuplicateLoad(foreignExternal),
  )
}
const external = binding.createExternal(42)
assert.equal(fixture.inspectExternalRefAcrossDuplicateLoad(external), 42)
assert.equal(fixture.getJsExternal(external), 42)
const publicBorrowProbe = binding.createExternalPublicBorrowProbe()
assert.throws(
  () => publicBorrowProbe(external),
  (error) => {
    assert.equal(error.code, 'InvalidArg')
    assert.match(
      error.message,
      /can only be created by generated callback argument conversion/,
    )
    return true
  },
)

const duplicateFixture = loadDuplicate(binding)
assertForeignEnvInvalidArg(() => duplicateFixture.getExternal(external))
assertForeignEnvInvalidArg(() => duplicateFixture.getJsExternal(external))
assertForeignEnvInvalidArg(() =>
  duplicateFixture.inspectExternalRefAcrossDuplicateLoad(external),
)
fixture.stashExternalRefAcrossDuplicateLoad(external)
assertForeignEnvInvalidArg(() =>
  duplicateFixture.takeExternalRefAcrossDuplicateLoad(),
)

const finalizeBaseline = binding.externalTokenGcProbeFinalizeCount()
let tokenOwner = binding.createExternalTokenGcProbe(91)
const copiedTokenAlias = binding.copyExternalTokenAlias(tokenOwner)
assert.equal(binding.inspectExternalTokenGcProbe(tokenOwner), 91)
assertInvalidExternalProvenance(() =>
  binding.inspectExternalTokenGcProbe(copiedTokenAlias),
)
assertInvalidExternalProvenance(() => binding.getJsExternal(copiedTokenAlias))
tokenOwner = undefined
await forceGcUntil(
  () => binding.externalTokenGcProbeFinalizeCount() > finalizeBaseline,
  'External token owner was not finalized',
)
for (let index = 0; index < 2_048; index += 1) {
  binding.createExternalTokenGcProbe(index)
}
for (let index = 0; index < 4; index += 1) {
  global.gc()
  await delay(0)
}
assertInvalidExternalProvenance(() =>
  binding.inspectExternalTokenGcProbe(copiedTokenAlias),
)
assertInvalidExternalProvenance(() => binding.getJsExternal(copiedTokenAlias))

const directory = await mkdtemp(join(tmpdir(), 'napi-external-ref-lifecycle-'))
const resultPath = join(directory, 'result')
const worker = new Worker(
  `
    const { parentPort, workerData } = require('node:worker_threads')
    const native = require(workerData.addonPath)
    native.stashExternalRefForTeardown(workerData.resultPath, 73)
    parentPort.postMessage('ready')
    parentPort.close()
  `,
  {
    eval: true,
    env: process.env,
    workerData: {
      addonPath,
      resultPath,
    },
  },
)

try {
  const exitCode = await new Promise((resolve, reject) => {
    let ready = false
    worker.once('message', (message) => {
      if (message !== 'ready') {
        reject(new Error(`unexpected ExternalRef worker message: ${message}`))
        return
      }
      ready = true
    })
    worker.once('error', reject)
    worker.once('exit', (code) => {
      if (!ready) {
        reject(
          new Error(
            `ExternalRef worker exited with code ${code} before readiness`,
          ),
        )
        return
      }
      resolve(code)
    })
  })
  assert.equal(exitCode, 0)

  const deadline = Date.now() + 5_000
  let result
  while (result === undefined && Date.now() < deadline) {
    try {
      result = await readFile(resultPath, 'utf8')
    } catch {
      await delay(10)
    }
  }
  assert.equal(
    result,
    'value=73;conversion=closed',
    'ExternalRef teardown probe did not observe its closed owner environment',
  )
} finally {
  worker.unref()
  await rm(directory, { recursive: true, force: true })
}
