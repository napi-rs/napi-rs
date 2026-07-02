import { parentPort } from 'node:worker_threads'

import native from '../index.cjs'

const isWasiTest = !!process.env.WASI_TEST

parentPort.on('message', ({ type }) => {
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
      // JS-derived Errors (napi_ref owners) dropped on spawned threads while
      // this thread churns GlobalHandles (napi-rs#3368). Unfixed: fatal
      // 'Check failed: object_ != kGlobalHandleZapValue' or SIGSEGV.
      const churnTarget = {}
      for (let i = 0; i < (isWasiTest ? 2 : 200); i++) {
        native.dropErrorFromValueOffThread(new Error(`offthread ${i}`))
        native.churnGlobalHandles(churnTarget, 200)
      }
      parentPort.postMessage('done')
      break
    }
    case 'error:reject:offthread':
      // Rejections awaited on the async runtime materialize as ref-carrying
      // Errors on a non-JS thread and are dropped there (napi-rs#3368).
      Promise.all(
        Array.from({ length: isWasiTest ? 2 : 100 }).map((_, i) => {
          const pending = native.awaitRejectionOffThread(
            Promise.reject(new Error(`rejection ${i}`)),
          )
          native.churnGlobalHandles({}, 200)
          return pending
        }),
      )
        .then((results) => {
          parentPort.postMessage(
            results.every(Boolean) ? 'done' : 'promise did not reject',
          )
        })
        .catch((e) => {
          throw e
        })
      break
    case 'error:clone:threads': {
      // try_clone siblings sharing one napi_ref, dropped on different threads
      // (napi-rs#3368): delete must only happen at refcount zero.
      const churnTarget = {}
      for (let i = 0; i < (isWasiTest ? 2 : 100); i++) {
        native.dropClonedErrorsOnTwoThreads(new Error(`clone ${i}`))
        native.churnGlobalHandles(churnTarget, 100)
      }
      parentPort.postMessage('done')
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
