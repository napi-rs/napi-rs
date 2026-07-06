import { createRequire } from 'node:module'
import { parentPort } from 'node:worker_threads'
import { setTimeout as delay } from 'node:timers/promises'

const require = createRequire(import.meta.url)
const retained = []
let native

function loadNative() {
  native ??= require('../index.cjs')
  return native
}

async function waitForFinalizerCount(expected) {
  const addon = loadNative()
  const deadline = Date.now() + 2_000
  while (
    addon.asyncBlockTerminalFinalizerCount() < expected &&
    Date.now() < deadline
  ) {
    await delay(10)
  }
  await delay(50)
  return addon.asyncBlockTerminalFinalizerCount()
}

function readTsfnTeardownCounters() {
  const addon = loadNative()
  return {
    payloadDrops: addon.tsfnTeardownPayloadDropCount(),
    waiterErrors: addon.tsfnTeardownWaiterErrorCount(),
    queueFullErrors: addon.tsfnTeardownQueueFullErrorCount(),
    unexpectedWaiters: addon.tsfnTeardownUnexpectedWaiterCount(),
    jsCallbacks: addon.tsfnTeardownJsCallbackCount(),
  }
}

async function waitForTsfnTeardownCounters() {
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline) {
    const counters = readTsfnTeardownCounters()
    if (
      (counters.payloadDrops >= 6 &&
        counters.waiterErrors >= 3 &&
        counters.queueFullErrors >= 1) ||
      counters.unexpectedWaiters !== 0 ||
      counters.jsCallbacks !== 0
    ) {
      return counters
    }
    await delay(1)
  }
  return readTsfnTeardownCounters()
}

parentPort.on(
  'message',
  async ({ type, enteredPath, releasePath, teardownBlocker }) => {
    try {
      switch (type) {
        case 'hold-pending-work': {
          const addon = loadNative()
          if (enteredPath && releasePath) {
            addon.configureTokioThreadStopFileBarrier(enteredPath, releasePath)
          }
          const threadStopCount = addon.tokioThreadStopCount()
          retained.push(new addon.RuntimeLifecycleFinalize())
          retained.push(addon.pendingAsyncBlockWithTerminalFinalizer())
          addon.prepareTsfnTeardownRegression(
            () => addon.recordTsfnTeardownJsCallback(),
            () => addon.recordTsfnTeardownJsCallback(),
          )
          parentPort.postMessage({ type: 'ready', threadStopCount })
          Atomics.wait(new Int32Array(teardownBlocker), 0, 0)
          break
        }
        case 'load-runtime': {
          parentPort.postMessage({ type: 'loading' })
          const addon = loadNative()
          parentPort.postMessage({
            type: 'loaded',
            threadStopCount: addon.tokioThreadStopCount(),
          })
          break
        }
        case 'verify-restart': {
          const addon = loadNative()
          const finalizerCount = await waitForFinalizerCount(1)
          const tsfnTeardownCounters = await waitForTsfnTeardownCounters()
          const result = await addon.asyncMultiTwo(2)
          parentPort.postMessage({
            type: 'verified',
            finalizerCount,
            lifecycleResult: addon.runtimeLifecycleFinalizeResult(),
            result,
            threadStopCount: addon.tokioThreadStopCount(),
            tsfnTeardownCounters,
          })
          break
        }
        default:
          throw new TypeError(`Unknown message type: ${type}`)
      }
    } catch (error) {
      parentPort.postMessage({
        type: 'error',
        message: error instanceof Error ? error.stack : String(error),
      })
    }
  },
)
