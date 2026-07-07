import assert from 'node:assert/strict'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  setImmediate as nextTurn,
  setTimeout as delay,
} from 'node:timers/promises'

const require = createRequire(import.meta.url)
const lifecycle = require('../index.cjs')
const directory = await mkdtemp(join(tmpdir(), 'napi-runtime-live-finalizer-'))
const finalizerTimeoutMilliseconds = 10_000

async function waitForFinalizer(resultPath, description) {
  const deadline = Date.now() + finalizerTimeoutMilliseconds
  let lastResult = '<not created>'
  while (Date.now() < deadline) {
    global.gc()
    await nextTurn()
    try {
      lastResult = await readFile(resultPath, 'utf8')
      return lastResult
    } catch (error) {
      lastResult = error?.code ? `<${error.code}>` : String(error)
    }
  }
  throw new Error(
    `${description} did not run within ${finalizerTimeoutMilliseconds}ms; last result: ${lastResult}`,
  )
}

async function restartAfterRetirement(iteration) {
  const deadline = Date.now() + finalizerTimeoutMilliseconds
  let lastError
  while (Date.now() < deadline) {
    try {
      lifecycle.restartTokioRuntimeAfterRetirement()
      return
    } catch (error) {
      if (
        error?.code !== 'WouldDeadlock' ||
        !error.message.includes('still shutting down')
      ) {
        throw error
      }
      lastError = error
      await delay(1)
    }
  }
  throw new Error(
    `runtime finalizer cycle ${iteration} did not become restartable within ${finalizerTimeoutMilliseconds}ms`,
    { cause: lastError },
  )
}

async function verifyFinalizerRestartCycle(iteration) {
  const resultPath = join(directory, `result-${iteration}`)
  let finalizer = lifecycle.createRuntimeLifecycleFinalizer(resultPath)
  assert.equal(typeof finalizer, 'object')
  await assert.rejects(access(resultPath))
  finalizer = undefined

  const result = await waitForFinalizer(
    resultPath,
    `runtime lifecycle finalizer cycle ${iteration}`,
  )
  assert.equal(
    result,
    '3',
    `runtime lifecycle finalizer cycle ${iteration} must start and stop Tokio`,
  )

  await assert.rejects(
    lifecycle.tokioRuntimeLifecycleValue(iteration),
    /stopped|not running/i,
    `runtime use after finalizer cycle ${iteration} must report the stopped state`,
  )
  await restartAfterRetirement(iteration)
  assert.equal(
    await lifecycle.tokioRuntimeLifecycleValue(iteration),
    iteration,
    `runtime finalizer cycle ${iteration} must remain restartable`,
  )
}

try {
  await verifyFinalizerRestartCycle(1)
  await verifyFinalizerRestartCycle(2)
} finally {
  await rm(directory, { recursive: true, force: true })
}
