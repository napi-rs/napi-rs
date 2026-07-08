import {
  instantiateNapiModule as __emnapiInstantiateNapiModule,
  WASI as __WASI,
} from '@napi-rs/wasm-runtime'
import { createContext as __emnapiCreateContext } from '@emnapi/runtime'
import { Buffer } from 'buffer'

/**
 * Deferred, workerd-safe instantiation: no top-level I/O, no compile-from-bytes.
 * Accepts ONLY a precompiled WebAssembly.Module, or a Promise resolving to one
 * (e.g. `import mod from './example.wasm32-wasip1.wasm'` under a CompiledWasm
 * module rule / wrangler module import). Byte buffers, URLs and Response
 * objects are rejected: they require dynamic Wasm compilation, which
 * Cloudflare Workers disallows.
 */
async function __resolveModule(__wasmInput) {
  const __module = await __wasmInput
  // Brand check, not `instanceof`: `WebAssembly.Module.imports` throws unless
  // its argument is a genuine WebAssembly.Module, so prototype-spoofed byte
  // buffers are rejected while cross-realm Module instances are accepted.
  try {
    WebAssembly.Module.imports(__module)
  } catch {
    throw new TypeError(
      'instantiate() and createInstance() expect a precompiled WebAssembly.Module (or a Promise resolving to one), ' +
        "e.g. import mod from './example.wasm32-wasip1.wasm' under a CompiledWasm module rule / wrangler module import. " +
        'Byte buffers, URLs and Response objects require dynamic Wasm compilation, which Cloudflare Workers disallows.',
    )
  }
  return __module
}

let __normalizedModules

function __rememberNormalizedModule(__module, __normalizedModule) {
  if (!__normalizedModules) {
    __normalizedModules = new WeakMap()
  }
  __normalizedModules.set(__module, __normalizedModule)
  return __normalizedModule
}

async function __normalizeModuleForEmnapi(__module) {
  if (__module instanceof WebAssembly.Module) {
    return __module
  }
  if (__normalizedModules) {
    const __normalizedModule = __normalizedModules.get(__module)
    if (__normalizedModule) {
      return __normalizedModule
    }
  }
  // @emnapi/core currently performs realm-local `instanceof` checks after
  // accepting the module. Structured cloning preserves compiled code without
  // compiling bytes and produces a Module owned by the current realm.
  if (typeof structuredClone === 'function') {
    try {
      const __normalizedModule = structuredClone(__module)
      if (__normalizedModule instanceof WebAssembly.Module) {
        return __rememberNormalizedModule(__module, __normalizedModule)
      }
    } catch {}
  }
  // MessageChannel uses the same structured-clone semantics and covers older
  // browser/Node hosts that expose it but not the structuredClone function.
  if (typeof MessageChannel === 'function') {
    let __channel
    try {
      __channel = new MessageChannel()
      const __normalizedModule = await new Promise((resolve, reject) => {
        __channel.port1.onmessage = (event) => resolve(event.data)
        __channel.port1.onmessageerror = () =>
          reject(new TypeError('Failed to clone WebAssembly.Module'))
        try {
          __channel.port2.postMessage(__module)
        } catch (error) {
          reject(error)
        }
      })
      if (__normalizedModule instanceof WebAssembly.Module) {
        return __rememberNormalizedModule(__module, __normalizedModule)
      }
    } catch {
    } finally {
      try {
        __channel?.port1.close()
      } catch {}
      try {
        __channel?.port2.close()
      } catch {}
    }
  }
  // Last-resort compatibility for genuine, extensible foreign Modules.
  try {
    Object.setPrototypeOf(__module, WebAssembly.Module.prototype)
  } catch {}
  if (__module instanceof WebAssembly.Module) {
    return __module
  }
  throw new TypeError(
    'This host cannot normalize a cross-realm WebAssembly.Module; ' +
      'provide structuredClone or MessageChannel support.',
  )
}

function __captureEmnapiAutoDestroyListener(__process) {
  if (
    !__process ||
    typeof __process.prependListener !== 'function' ||
    typeof __process.removeListener !== 'function'
  ) {
    return
  }
  let __autoDestroyListener
  const __captureListener = (__event, __listener) => {
    if (__event === 'beforeExit' && __autoDestroyListener === undefined) {
      __autoDestroyListener = __listener
    }
  }
  try {
    // Run before existing newListener hooks so a hook that registers its own
    // beforeExit listener cannot be mistaken for emnapi's registration.
    __process.prependListener('newListener', __captureListener)
  } catch {
    return
  }
  return () => {
    try {
      __process.removeListener('newListener', __captureListener)
    } catch {}
    if (__autoDestroyListener !== undefined) {
      try {
        __process.removeListener('beforeExit', __autoDestroyListener)
      } catch {}
    }
  }
}

const __managedEmnapiContextDestroyers = new Set()
let __managedCleanupProcess
let __managedBeforeExitListener
let __managedDestroyPromise

function __removeManagedEmnapiCleanupListeners() {
  const __process = __managedCleanupProcess
  const __beforeExitListener = __managedBeforeExitListener
  __managedCleanupProcess = undefined
  __managedBeforeExitListener = undefined
  if (__process && __beforeExitListener) {
    try {
      __process.removeListener('beforeExit', __beforeExitListener)
    } catch {}
  }
}

function __registerManagedBeforeExitListener() {
  if (!__managedCleanupProcess || __managedBeforeExitListener) {
    return
  }
  __managedCleanupProcess.once(
    'beforeExit',
    __destroyManagedEmnapiContextsBeforeExit,
  )
  __managedBeforeExitListener = __destroyManagedEmnapiContextsBeforeExit
}

function __destroyManagedEmnapiContextsBeforeExit() {
  if (__managedDestroyPromise) {
    return
  }
  __managedBeforeExitListener = undefined
  const __destroyers = Array.from(__managedEmnapiContextDestroyers)
  const __promise = Promise.all(
    __destroyers.map((__destroy) => Promise.resolve().then(__destroy)),
  )
  __managedDestroyPromise = __promise
  void __promise.then(
    () => {
      if (__managedDestroyPromise === __promise) {
        __managedDestroyPromise = undefined
      }
      if (__managedEmnapiContextDestroyers.size === 0) {
        __removeManagedEmnapiCleanupListeners()
      }
    },
    (error) => {
      if (__managedDestroyPromise === __promise) {
        __managedDestroyPromise = undefined
      }
      try {
        __registerManagedBeforeExitListener()
      } catch {}
      queueMicrotask(() => {
        throw error
      })
    },
  )
}

function __registerManagedEmnapiContext(__process, __destroy) {
  if (
    !__process ||
    typeof __process.once !== 'function' ||
    typeof __process.removeListener !== 'function'
  ) {
    return
  }
  __managedEmnapiContextDestroyers.add(__destroy)
  try {
    if (!__managedCleanupProcess) {
      __managedCleanupProcess = __process
    }
    __registerManagedBeforeExitListener()
  } catch (error) {
    __removeManagedEmnapiCleanupListeners()
    __managedEmnapiContextDestroyers.delete(__destroy)
    throw error
  }
  let __registered = true
  return () => {
    if (!__registered) {
      return
    }
    __registered = false
    __managedEmnapiContextDestroyers.delete(__destroy)
    if (
      __managedEmnapiContextDestroyers.size === 0 &&
      __managedBeforeExitListener &&
      __managedCleanupProcess
    ) {
      __removeManagedEmnapiCleanupListeners()
    }
  }
}

async function __createManagedEmnapiContext(__beforeExitDestroy) {
  const __process =
    typeof process === 'object' && process !== null ? process : undefined
  const __finishAutoDestroyCapture =
    __captureEmnapiAutoDestroyListener(__process)
  let __emnapiContext
  try {
    __emnapiContext = __emnapiCreateContext({ autoDestroy: false })
    // emnapi <= 1.11 ignores autoDestroy. suppressDestroy() is the public
    // contract that keeps this context alive until our explicit cleanup runs.
    __emnapiContext.suppressDestroy()
  } finally {
    // Remove only the exact legacy callback captured above. suppressDestroy()
    // remains the safety net if listener removal is unavailable or fails.
    __finishAutoDestroyCapture?.()
  }
  let __disposed = false
  let __destroyPromise
  let __unregisterCleanup
  const __destroy = () => {
    if (__disposed) {
      return
    }
    if (__destroyPromise) {
      return __destroyPromise
    }
    const __result = __emnapiContext.destroy()
    if (__result && typeof __result.then === 'function') {
      const __promise = Promise.resolve(__result).then(
        (value) => {
          __disposed = true
          __destroyPromise = undefined
          __unregisterCleanup?.()
          return value
        },
        (error) => {
          __destroyPromise = undefined
          throw error
        },
      )
      __destroyPromise = __promise
      return __promise
    }
    __disposed = true
    __unregisterCleanup?.()
    return __result
  }
  try {
    __unregisterCleanup = __registerManagedEmnapiContext(
      __process,
      __beforeExitDestroy ?? __destroy,
    )
  } catch (error) {
    try {
      await __destroy()
    } catch (disposeError) {
      try {
        if (
          error &&
          (typeof error === 'object' || typeof error === 'function') &&
          error.cause === undefined
        ) {
          error.cause = disposeError
        }
      } catch {}
    }
    throw error
  }
  return {
    context: __emnapiContext,
    destroy: __destroy,
  }
}

async function __createInstance(__wasmInput, __beforeExitDestroy) {
  const __module = await __resolveModule(__wasmInput)
  const __emnapiModule = await __normalizeModuleForEmnapi(__module)
  const __wasi = new __WASI({
    version: 'preview1',
  })
  // The wasm module is linked with `--import-memory`, so a Memory must be
  // provided. It is allocated here in function scope (workerd bans global
  // scope allocation) and is not shared (no threads, no SharedArrayBuffer).
  // Allocate it before the emnapi context so a host memory-limit failure cannot
  // leak a context that never reaches instantiation.
  const __wasmMemory = new WebAssembly.Memory({
    initial: 16384,
    maximum: 65536,
  })
  const { context: __emnapiContext, destroy: __destroyEmnapiContext } =
    await __createManagedEmnapiContext(__beforeExitDestroy)
  try {
    __emnapiContext.feature.Buffer = Buffer
    const { napiModule: __napiModule } = await __emnapiInstantiateNapiModule(
      __emnapiModule,
      {
        context: __emnapiContext,
        asyncWorkPoolSize: 0,
        wasi: __wasi,
        overwriteImports(importObject) {
          importObject.env = {
            ...importObject.env,
            ...importObject.napi,
            ...importObject.emnapi,
            memory: __wasmMemory,
          }
          return importObject
        },
        beforeInit({ instance }) {
          for (const name of Object.keys(instance.exports)) {
            if (name.startsWith('__napi_register__')) {
              instance.exports[name]()
            }
          }
        },
      },
    )
    for (const name of unsupportedWasiFunctions) {
      if (__napiModule.exports[name] === undefined) {
        __napiModule.exports[name] = getDeferredWasiBindingExport(
          __napiModule.exports,
          name,
        )
      }
    }
    return {
      exports: __napiModule.exports,
      dispose() {
        return __destroyEmnapiContext()
      },
    }
  } catch (error) {
    try {
      await __destroyEmnapiContext()
    } catch (disposeError) {
      // Initialization is the primary failure. Preserve it even if cleanup
      // also fails, while retaining the cleanup error when the value is
      // extensible and has no existing cause.
      try {
        if (
          error &&
          (typeof error === 'object' || typeof error === 'function') &&
          error.cause === undefined
        ) {
          error.cause = disposeError
        }
      } catch {}
    }
    throw error
  }
}

/**
 * Create an independent instance. Call dispose() when the instance is no
 * longer needed so emnapi cleanup hooks run deterministically.
 */
const unsupportedWasiFunctions = new Set([
  'abandonDeferredClones',
  'armTokioBlockingTlsRetirementProbe',
  'armTokioWorkerTlsRetirementProbe',
  'assignClassInstanceAcrossDuplicateLoad',
  'assignClassInstanceFromLaterTurn',
  'assignClampedSliceAcrossDuplicateLoad',
  'assignTypedArraySliceAcrossDuplicateLoad',
  'cancelAsyncWorkLifecycle',
  'configureTokioThreadStopFileBarrier',
  'convertClampedSliceAcrossDuplicateLoad',
  'convertTypedArraySliceAcrossDuplicateLoad',
  'copyExternalTokenAlias',
  'createExternalPublicBorrowProbe',
  'createExternalRefProvenanceProbe',
  'createExternalTokenGcProbe',
  'createMutableTypedArrayForOwnershipTest',
  'createPanickingAsyncWork',
  'createQueuedAsyncWorkLifecycle',
  'createResolvePanickingAsyncWork',
  'createRunningAsyncWorkLifecycle',
  'deferredFinalizeCallbackCount',
  'disposeAsyncWorkLifecycle',
  'disposeThreadsafeFunctionForEnvOwnership',
  'externalTokenGcProbeFinalizeCount',
  'fetch',
  'inspectExternalRefAcrossDuplicateLoad',
  'inspectExternalTokenGcProbe',
  'mutableTypedArrayFinalizeCount',
  'panickingAsyncWorkFinallyCount',
  'prepareTsfnBlockingCallRegression',
  'prepareTsfnTeardownRegression',
  'referThreadsafeFunctionForEnvOwnership',
  'registerDeferredCleanupOrderProbe',
  'registerLateDeferredFinalizeCallback',
  'releaseAsyncWorkLifecycle',
  'resolvePanickingAsyncWorkFinallyCount',
  'restartTokioRuntimeAfterRetirement',
  'returnTypedArraySliceMutAcrossDuplicateLoad',
  'returnTypedArraySliceRefAcrossDuplicateLoad',
  'settleDeferredBeforeFinalizeRegistration',
  'settleDeferredClone',
  'stashBufferAcrossDuplicateLoad',
  'stashClassInstanceForLaterTurn',
  'stashErrorAcrossDuplicateLoad',
  'stashExternalRefAcrossDuplicateLoad',
  'stashExternalRefForTeardown',
  'stashThreadsafeFunctionForEnvOwnership',
  'stashTypedArrayAcrossDuplicateLoad',
  'stashTypedArraySlicesAcrossDuplicateLoad',
  'startDeferredTeardownRace',
  'startReferencedTsfnFinalizerLivenessWorker',
  'startWeakTsfnFinalizerLivenessWorker',
  'takeAdditionalBorrowedValueAcrossDuplicateLoad',
  'takeBorrowedValueAcrossDuplicateLoad',
  'takeBufferAcrossDuplicateLoad',
  'takeBufferSliceIntoBufferAcrossDuplicateLoad',
  'takeBufferSliceRefAcrossDuplicateLoad',
  'takeClassInstanceFromLaterTurn',
  'takeExternalRefAcrossDuplicateLoad',
  'takeReferenceValueAcrossDuplicateLoad',
  'takeTypedArrayAcrossDuplicateLoad',
  'throwErrorAcrossDuplicateLoad',
  'tokioRuntimeLifecycleValue',
  'unrefThreadsafeFunctionForEnvOwnership',
  'verifyReferenceValuesRejectNativeThread',
  'verifyThreadsafeFunctionOwnerEnv',
  'verifyTypedArraySlicesSameEnv',
  'waitForTokioRuntimeRetirement',
  'withAdditionalBorrowedValuesAcrossDuplicateLoad',
  'withBorrowedValuesAcrossDuplicateLoad',
  'withReferenceValuesAcrossDuplicateLoad',
])

function getDeferredWasiBindingExport(binding, name) {
  const value = binding[name]
  if (value !== undefined || !unsupportedWasiFunctions.has(name)) {
    return value
  }
  return function unsupportedWasiFunction() {
    const error = new Error(
      `The "${name}" export is not supported by this WASI binding`,
    )
    error.code = 'NAPI_RS_UNSUPPORTED_WASI_EXPORT'
    throw error
  }
}

export async function createInstance(__wasmInput) {
  return __createInstance(__wasmInput)
}

let __defaultModulePromise
let __defaultInstancePromise
let __defaultDisposePromise

/**
 * Instantiate a module-local singleton. Concurrent and repeated calls
 * with the same module share one instance and one Memory allocation.
 */
export function instantiate(__wasmInput) {
  if (__defaultDisposePromise) {
    const __disposePromise = __defaultDisposePromise
    const __modulePromise = __resolveModule(__wasmInput)
    // Observe rejected input immediately, but preserve lifecycle ordering and
    // error precedence by instantiating only after the active disposal.
    void __modulePromise.catch(() => {})
    return __disposePromise.then(() => instantiate(__modulePromise))
  }
  const __modulePromise = __resolveModule(__wasmInput)
  if (!__defaultInstancePromise) {
    __defaultModulePromise = __modulePromise
    const __instancePromise = __modulePromise.then((__module) =>
      __createInstance(__module, dispose),
    )
    __defaultInstancePromise = __instancePromise
    void __instancePromise.catch(() => {
      if (__defaultInstancePromise === __instancePromise) {
        __defaultInstancePromise = undefined
        __defaultModulePromise = undefined
      }
    })
    return __instancePromise.then((__instance) => __instance.exports)
  }
  const __defaultModulePromiseForCall = __defaultModulePromise
  const __defaultInstancePromiseForCall = __defaultInstancePromise
  return Promise.all([__defaultModulePromiseForCall, __modulePromise]).then(
    async ([__defaultModule, __module]) => {
      if (__defaultModule !== __module) {
        throw new Error(
          'instantiate() already owns a different WebAssembly.Module; call dispose() first or use createInstance() for independent instances.',
        )
      }
      return (await __defaultInstancePromiseForCall).exports
    },
  )
}

/**
 * Dispose the singleton created by instantiate(). A later call may create a
 * fresh instance, including from a different module.
 */
export async function dispose() {
  if (__defaultDisposePromise) {
    return __defaultDisposePromise
  }
  const __instancePromise = __defaultInstancePromise
  if (!__instancePromise) {
    return
  }
  const __disposePromise = (async () => {
    const __instance = await __instancePromise
    await __instance.dispose()
    if (__defaultInstancePromise === __instancePromise) {
      __defaultInstancePromise = undefined
      __defaultModulePromise = undefined
    }
  })()
  __defaultDisposePromise = __disposePromise
  try {
    await __disposePromise
  } finally {
    if (__defaultDisposePromise === __disposePromise) {
      __defaultDisposePromise = undefined
    }
  }
}
