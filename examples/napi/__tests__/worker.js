import { createRequire } from 'node:module'
import { parentPort } from 'node:worker_threads'

const require = createRequire(import.meta.url)
const native = require('../index.cjs')
const lifecycle = native

const isWasiTest = !!process.env.WASI_TEST
// 32-bit (ia32, e.g. i686 Windows) has a ~2 GB address space; the off-thread
// Error scenarios spawn one OS thread per drop, so cap their counts there to
// avoid exhausting it (napi-rs#3368).
const is32bit = process.arch === 'ia32'
// Keep these reachable so their finalizers run during worker teardown, not an earlier GC.
const runtimeLifecycleTeardownObjects = []

async function waitForErrorReferencesToRelease(references, scenario) {
  if (typeof global.gc !== 'function') {
    throw new Error(`${scenario} requires --expose-gc`)
  }
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    global.gc()
    const pressure = new ArrayBuffer(1024 * 1024)
    if (pressure.byteLength !== 1024 * 1024) {
      throw new Error('failed to allocate GC pressure')
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
    if (references.every((reference) => reference.deref() === undefined)) {
      return
    }
    // End the current job after deref(), which keeps live targets alive until
    // the job boundary by specification.
    await new Promise((resolve) => setImmediate(resolve))
  }
  throw new Error(`${scenario} retained JS Error references after native drops`)
}

function waitForQueuedErrorReleaseTurn() {
  // The drop promises settle after the foreign-thread destructors enqueue
  // their custom-GC releases, not after the owner-thread TSFN callback runs.
  // This barrier keeps the worker alive for another owner event-loop turn
  // before publishing `done`. It guarantees that dispatch opportunity, not an
  // internal release count.
  return new Promise((resolve) => setImmediate(resolve))
}

parentPort.on('message', ({ type, resultPath }) => {
  switch (type) {
    case 'require':
      parentPort.postMessage(
        native.Animal.withKind(native.Kind.Cat).whoami() + native.DEFAULT_COST,
      )
      break
    case 'async:buffer':
      Promise.all(
        Array.from({ length: isWasiTest ? 2 : 100 }).map(() =>
          native.bufferPassThrough(Buffer.from([1, 2, 3])),
        ),
      )
        .then(() => {
          parentPort.postMessage('done')
        })
        .catch((e) => {
          throw e
        })
      break
    case 'async:arraybuffer':
      Promise.all(
        Array.from({ length: isWasiTest ? 2 : 100 }).map(() =>
          native.arrayBufferPassThrough(Uint8Array.from([1, 2, 3])),
        ),
      )
        .then(() => {
          parentPort.postMessage('done')
        })
        .catch((e) => {
          throw e
        })

      break
    case 'async:buffer:consume':
      Promise.all(
        Array.from({ length: isWasiTest ? 2 : 100 }).map(() =>
          native.bufferLenAsync(Buffer.from([1, 2, 3])),
        ),
      )
        .then(() => {
          parentPort.postMessage('done')
        })
        .catch((e) => {
          throw e
        })
      break
    case 'async:arraybuffer:consume':
      Promise.all(
        Array.from({ length: isWasiTest ? 2 : 100 }).map(() =>
          native.arrayBufferLenAsync(Uint8Array.from([1, 2, 3])),
        ),
      )
        .then(() => {
          parentPort.postMessage('done')
        })
        .catch((e) => {
          throw e
        })
      break
    case 'async:terminal-finalizer':
      lifecycle.pendingAsyncBlockWithTerminalFinalizer(resultPath)
      parentPort.postMessage('pending')
      break
    case 'async:iterator-teardown': {
      const probe = new native.AsyncIteratorAdmissionProbe(['value', 'value'])
      const iterator = probe[Symbol.asyncIterator]()
      iterator.next()
      iterator.next()
      const deadline = Date.now() + 5_000
      const publishWhenAdmitted = () => {
        if (probe.events.length !== 0) {
          parentPort.postMessage({
            type: 'iterator-pending',
            events: probe.events,
          })
        } else if (Date.now() < deadline) {
          setImmediate(publishWhenAdmitted)
        } else {
          throw new Error('async iterator request was not admitted')
        }
      }
      setImmediate(publishWhenAdmitted)
      break
    }
    case 'runtime-finalizer:teardown':
      runtimeLifecycleTeardownObjects.push(
        lifecycle.createRuntimeLifecycleFinalizer(resultPath),
      )
      parentPort.postMessage({ type: 'runtime-finalizer-ready' })
      break
    case 'stash:buffer:teardown':
      // Stash JS-origin Buffers in a Rust thread_local on THIS worker's JS thread. They drop at
      // worker thread-exit (AFTER env teardown sets the per-handle `aborted` flag) on the OWNER
      // thread -> same-thread post-teardown Drop path (must_fix #1). Must no-op, not UAF.
      for (let i = 0; i < (isWasiTest ? 2 : 50); i++) {
        native.stashBufferInThreadLocal(Buffer.from([1, 2, 3]))
      }
      parentPort.postMessage('done')
      break
    case 'stash:arraybuffer:teardown':
      for (let i = 0; i < (isWasiTest ? 2 : 50); i++) {
        native.stashTypedArrayInThreadLocal(Uint8Array.from([1, 2, 3]))
      }
      parentPort.postMessage('done')
      break
    case 'error:value:offthread': {
      // JS-derived Errors (napi_ref owners) dropped on libuv workers while
      // this thread churns GlobalHandles (napi-rs#3368). Unfixed: fatal
      // 'Check failed: object_ != kGlobalHandleZapValue' or SIGSEGV.
      const churnTarget = {}
      const drops = []
      const references = []
      for (let i = 0; i < (isWasiTest ? 2 : is32bit ? 50 : 200); i++) {
        const error = new Error(`offthread ${i}`)
        references.push(new WeakRef(error))
        drops.push(native.dropErrorFromValueOffThread(error))
        native.churnGlobalHandles(churnTarget, 200)
      }
      Promise.all(drops)
        .then(async () => {
          await waitForQueuedErrorReleaseTurn()
          await waitForErrorReferencesToRelease(
            references,
            'off-thread Error drop',
          )
          parentPort.postMessage('done')
        })
        .catch((e) => {
          throw e
        })
      break
    }
    case 'error:reject:offthread': {
      // Rejections awaited on the async runtime materialize as ref-carrying
      // Errors that drop on a tokio worker, off the JS thread (napi-rs#3368).
      // The rejections settle as microtasks, so churning synchronously up front
      // would finish before any drop; instead keep churning GlobalHandles on the
      // JS thread until every rejection has settled, so the churn actually races
      // the off-thread drops it is meant to amplify.
      const references = []
      const settled = Promise.all(
        Array.from({ length: isWasiTest ? 2 : 100 }).map((_, i) => {
          const error = new Error(`rejection ${i}`)
          references.push(new WeakRef(error))
          return native.awaitRejectionOffThread(Promise.reject(error))
        }),
      )
      let racing = true
      const churn = () => {
        if (!racing) return
        native.churnGlobalHandles({}, 200)
        setImmediate(churn)
      }
      setImmediate(churn)
      settled
        .then(async (results) => {
          await waitForQueuedErrorReleaseTurn()
          racing = false
          await waitForErrorReferencesToRelease(
            references,
            'off-thread Promise rejection drop',
          )
          parentPort.postMessage(
            results.every(Boolean) ? 'done' : 'promise did not reject',
          )
        })
        .catch((e) => {
          racing = false
          throw e
        })
      break
    }
    case 'error:clone:threads': {
      // try_clone siblings sharing one napi_ref, dropped on different threads
      // (napi-rs#3368): delete must only happen at refcount zero.
      const churnTarget = {}
      const drops = []
      const references = []
      for (let i = 0; i < (isWasiTest ? 2 : is32bit ? 50 : 100); i++) {
        const error = new Error(`clone ${i}`)
        references.push(new WeakRef(error))
        drops.push(native.dropClonedErrorsOnTwoThreads(error))
        native.churnGlobalHandles(churnTarget, 100)
      }
      Promise.all(drops)
        .then(async () => {
          await waitForQueuedErrorReleaseTurn()
          await waitForErrorReferencesToRelease(
            references,
            'off-thread cloned Error drop',
          )
          parentPort.postMessage('done')
        })
        .catch((e) => {
          throw e
        })
      break
    }
    case 'stash:error:teardown':
      // Same shape as stash:buffer:teardown: the stashed Errors drop on the
      // OWNER thread after env teardown -> must no-op, not UAF (napi-rs#3368).
      for (let i = 0; i < (isWasiTest ? 2 : 50); i++) {
        native.stashErrorInThreadLocal(new Error(`stash ${i}`))
      }
      parentPort.postMessage('done')
      break
    case 'constructor':
      let ellie
      for (let i = 0; i < (isWasiTest ? 10 : 1000); i++) {
        ellie = new native.Animal(native.Kind.Cat, 'Ellie')
      }
      parentPort.postMessage(ellie.name)
      break
    default:
      throw new TypeError(`Unknown message type: ${type}`)
  }
})
