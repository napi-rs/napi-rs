import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const require = createRequire(import.meta.url)
const entryPath = require.resolve('../index.cjs')
const loaderPath = require.resolve('../example.wasi.cjs')
const operationTimeout = 10_000
const wasiDisposeSymbol = Symbol.for('napi.rs.wasi.dispose')

process.env.NAPI_RS_FORCE_WASI = 'error'

async function waitForResult(path, description) {
  const deadline = Date.now() + operationTimeout
  let lastError
  while (Date.now() < deadline) {
    try {
      return await readFile(path, 'utf8')
    } catch (error) {
      lastError = error
      await delay(10)
    }
  }
  throw new Error(`timed out waiting for ${description}`, { cause: lastError })
}

function withTimeout(promise, description) {
  let timeout
  const expired = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`timed out waiting for ${description}`))
    }, operationTimeout)
  })
  return Promise.race([promise, expired]).finally(() => clearTimeout(timeout))
}

function clearLoaderCache() {
  delete require.cache[entryPath]
  delete require.cache[loaderPath]
}

function loadFresh() {
  clearLoaderCache()
  return require(entryPath)
}

function getDispose(binding) {
  const descriptor = Object.getOwnPropertyDescriptor(binding, wasiDisposeSymbol)
  assert.equal(typeof descriptor?.value, 'function')
  assert.equal(descriptor.enumerable, false)
  assert.equal(descriptor.configurable, false)
  assert.equal(descriptor.writable, false)
  return descriptor.value
}

const directory = await mkdtemp(join(tmpdir(), 'napi-wasi-context-reload-'))
const cleanupPath = join(directory, 'cleanup')
const asyncCleanupPath = join(directory, 'async-cleanup')
const asyncStartedPath = join(directory, 'async-started')
const asyncFinalizerPath = join(directory, 'async-finalized')
let first
let replacement

try {
  first = loadFresh()
  const disposeFirst = getDispose(first)

  assert.equal(first.add(1, 2), 3)
  process.emit('beforeExit', 0)
  assert.equal(first.add(2, 3), 5)

  first.registerEnvCleanupRuntimeLifecycleProbes(cleanupPath, asyncCleanupPath)
  let pendingSettled = false
  const pendingRejection = assert
    .rejects(
      first.pendingAsyncBlockWithTerminalFinalizer(
        asyncFinalizerPath,
        asyncStartedPath,
      ),
      /Async task was cancelled because its runtime stopped/,
    )
    .then(() => {
      pendingSettled = true
    })
  assert.equal(
    await waitForResult(asyncStartedPath, 'pending async task start'),
    'started',
  )

  const firstDisposal = disposeFirst()
  assert.strictEqual(disposeFirst(), firstDisposal)
  await withTimeout(firstDisposal, 'public WASI disposal')
  assert.equal(pendingSettled, true)
  await withTimeout(pendingRejection, 'pending async promise rejection')
  assert.strictEqual(disposeFirst(), firstDisposal)
  assert.equal(
    await waitForResult(asyncFinalizerPath, 'pending async finalizer'),
    'finalized',
  )
  assert.equal(await waitForResult(cleanupPath, 'sync cleanup result'), '0')
  assert.equal(
    await waitForResult(asyncCleanupPath, 'async cleanup result'),
    '0',
  )

  replacement = loadFresh()
  const disposeReplacement = getDispose(replacement)
  assert.notStrictEqual(replacement, first)
  assert.equal(replacement.add(3, 4), 7)
  const replacementDisposal = disposeReplacement()
  assert.strictEqual(disposeReplacement(), replacementDisposal)
  await withTimeout(replacementDisposal, 'replacement WASI disposal')
  assert.strictEqual(disposeReplacement(), replacementDisposal)
} finally {
  const disposals = [first, replacement]
    .map((binding) => binding?.[wasiDisposeSymbol])
    .filter((dispose) => typeof dispose === 'function')
    .map((dispose) => dispose().catch(() => {}))
  await Promise.all(disposals)
  clearLoaderCache()
  await rm(directory, { recursive: true, force: true })
}
