import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const require = createRequire(import.meta.url)
const loaderPath = require.resolve('../example.wasi.cjs')
const operationTimeout = 10_000
const wasmRuntime = require('@napi-rs/wasm-runtime')
const createContext = wasmRuntime.createContext

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

function loadFresh() {
  delete require.cache[loaderPath]
  const contexts = []
  wasmRuntime.createContext = function captureWasiContext(...args) {
    const context = createContext.apply(this, args)
    contexts.push(context)
    return context
  }
  let binding
  try {
    binding = require(loaderPath)
  } finally {
    wasmRuntime.createContext = createContext
  }
  assert.equal(contexts.length, 1)
  return { binding, context: contexts[0] }
}

const directory = await mkdtemp(join(tmpdir(), 'napi-wasi-context-reload-'))
const cleanupPath = join(directory, 'cleanup')
const asyncCleanupPath = join(directory, 'async-cleanup')
const asyncStartedPath = join(directory, 'async-started')
const asyncFinalizerPath = join(directory, 'async-finalized')
let firstContext
let replacementContext

try {
  const { binding: first, context: loadedFirstContext } = loadFresh()
  firstContext = loadedFirstContext

  assert.equal(typeof firstContext?.destroy, 'function')
  assert.equal(
    Object.getOwnPropertySymbols(first).some(
      (symbol) => symbol.description === 'napi.rs.wasi.context',
    ),
    false,
  )
  assert.equal(first.add(1, 2), 3)

  first.registerEnvCleanupRuntimeLifecycleProbes(cleanupPath, asyncCleanupPath)
  const pendingRejection = assert.rejects(
    first.pendingAsyncBlockWithTerminalFinalizer(
      asyncFinalizerPath,
      asyncStartedPath,
    ),
    /Async task was cancelled because its runtime stopped/,
  )
  assert.equal(
    await waitForResult(asyncStartedPath, 'pending async task start'),
    'started',
  )
  firstContext.destroy()
  assert.equal(
    await waitForResult(asyncFinalizerPath, 'pending async finalizer'),
    'finalized',
  )
  await withTimeout(pendingRejection, 'pending async promise rejection')
  firstContext.destroy()
  firstContext = undefined

  assert.equal(await waitForResult(cleanupPath, 'sync cleanup result'), '0')
  assert.equal(
    await waitForResult(asyncCleanupPath, 'async cleanup result'),
    '0',
  )

  const { binding: replacement, context: loadedReplacementContext } =
    loadFresh()
  replacementContext = loadedReplacementContext

  assert.equal(typeof replacementContext?.destroy, 'function')
  assert.notEqual(replacementContext, firstContext)
  assert.equal(replacement.add(2, 3), 5)
} finally {
  firstContext?.destroy()
  replacementContext?.destroy()
  delete require.cache[loaderPath]
  await rm(directory, { recursive: true, force: true })
}
