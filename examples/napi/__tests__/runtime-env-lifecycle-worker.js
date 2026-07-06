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

parentPort.on('message', async ({ type }) => {
  try {
    switch (type) {
      case 'hold-pending-work': {
        const addon = loadNative()
        retained.push(new addon.RuntimeLifecycleFinalize())
        retained.push(addon.pendingAsyncBlockWithTerminalFinalizer())
        parentPort.postMessage({ type: 'ready' })
        break
      }
      case 'verify-restart': {
        const addon = loadNative()
        const finalizerCount = await waitForFinalizerCount(1)
        const result = await addon.asyncMultiTwo(2)
        parentPort.postMessage({
          type: 'verified',
          finalizerCount,
          lifecycleResult: addon.runtimeLifecycleFinalizeResult(),
          result,
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
})
