import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const require = createRequire(import.meta.url)
const loaderPath = require.resolve('../example.wasi.cjs')
const operationTimeout = 10_000
const sleepState = new Int32Array(new SharedArrayBuffer(4))
const wasmRuntime = require('@napi-rs/wasm-runtime')
const instantiateNapiModuleSync = wasmRuntime.instantiateNapiModuleSync
const emnapiRuntime = require('@emnapi/runtime')
const createContext = emnapiRuntime.createContext
const initialBeforeExitListeners = new Set(process.rawListeners('beforeExit'))

function waitForResultSync(path, description) {
  const deadline = Date.now() + operationTimeout
  let lastError
  while (Date.now() < deadline) {
    try {
      return readFileSync(path, 'utf8')
    } catch (error) {
      lastError = error
      Atomics.wait(sleepState, 0, 0, 10)
    }
  }
  throw new Error(`timed out waiting for ${description}`, { cause: lastError })
}

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

function generatedBeforeExitCleanupListeners() {
  return process
    .rawListeners('beforeExit')
    .filter((listener) => !initialBeforeExitListeners.has(listener))
    .filter(
      (listener) =>
        listener.name === '__destroyEmnapiContextBeforeExit' ||
        listener.listener?.name === '__destroyEmnapiContextBeforeExit',
    )
}

function generatedExitCleanupListeners() {
  return process
    .rawListeners('exit')
    .filter(
      (listener) =>
        listener.name === '__destroyEmnapiContextAtExit' ||
        listener.listener?.name === '__destroyEmnapiContextAtExit',
    )
}

function invokeCleanup(listener) {
  Reflect.apply(listener, process, [0])
}

const directory = await mkdtemp(join(tmpdir(), 'napi-wasi-eager-rollback-'))
const startedPath = join(directory, 'started')
const finalizerPath = join(directory, 'finalized')
const initializationError = new Error('eager initialization failed')
const cleanupError = new Error('first context destroy failed')
let destroyAttempts = 0
let pendingOutcome

try {
  emnapiRuntime.createContext = function createRetryableContext(...args) {
    const context = createContext.apply(this, args)
    const destroy = context.destroy
    context.destroy = function destroyWithFirstAttemptFailure() {
      destroyAttempts += 1
      if (destroyAttempts === 1) {
        throw cleanupError
      }
      return Reflect.apply(destroy, context, [])
    }
    return context
  }
  wasmRuntime.instantiateNapiModuleSync =
    function failAfterStartingPendingRuntimeWork(...args) {
      const result = instantiateNapiModuleSync.apply(this, args)
      pendingOutcome = result.napiModule.exports
        .pendingAsyncBlockWithTerminalFinalizer(finalizerPath, startedPath)
        .then(
          () => ({ status: 'fulfilled' }),
          (error) => ({ error, status: 'rejected' }),
        )
      assert.equal(
        waitForResultSync(startedPath, 'pending async task start'),
        'started',
      )
      throw initializationError
    }

  let observed
  try {
    require(loaderPath)
  } catch (error) {
    observed = error
  } finally {
    wasmRuntime.instantiateNapiModuleSync = instantiateNapiModuleSync
    emnapiRuntime.createContext = createContext
  }

  assert.strictEqual(observed, initializationError)
  assert.strictEqual(initializationError.cause, cleanupError)
  assert.equal(destroyAttempts, 1)
  assert.ok(pendingOutcome, 'pending runtime Promise was not captured')
  const outcome = await withTimeout(
    pendingOutcome,
    'pending async promise rejection',
  )
  assert.equal(outcome.status, 'rejected')
  assert.match(
    String(outcome.error),
    /Async task was cancelled because its runtime stopped/,
  )
  assert.equal(
    await waitForResult(finalizerPath, 'pending async finalizer'),
    'finalized',
  )

  const retryListeners = generatedBeforeExitCleanupListeners()
  assert.equal(retryListeners.length, 1)
  invokeCleanup(retryListeners[0])
  assert.equal(destroyAttempts, 2)
  assert.equal(generatedBeforeExitCleanupListeners().length, 0)

  delete require.cache[loaderPath]
  const replacement = require(loaderPath)
  assert.equal(replacement.add(2, 3), 5)
  assert.equal(generatedExitCleanupListeners().length, 1)
  process.stdout.write('eager runtime rollback passed\n')
} finally {
  wasmRuntime.instantiateNapiModuleSync = instantiateNapiModuleSync
  emnapiRuntime.createContext = createContext
  for (const listener of generatedBeforeExitCleanupListeners()) {
    invokeCleanup(listener)
  }
  for (const listener of generatedExitCleanupListeners()) {
    invokeCleanup(listener)
  }
  delete require.cache[loaderPath]
  if (existsSync(directory)) {
    await rm(directory, { recursive: true, force: true })
  }
}
