export const createWasiBrowserBinding = (
  wasiFilename: string,
  initialMemory = 4000,
  maximumMemory = 65536,
  fs = false,
  asyncInit = false,
  buffer = false,
  errorEvent = false,
  threads = true,
) => {
  const fsImport = fs
    ? buffer
      ? `import { memfs, Buffer } from '@napi-rs/wasm-runtime/fs'`
      : `import { memfs } from '@napi-rs/wasm-runtime/fs'`
    : ''
  const bufferImport = buffer && !fs ? `import { Buffer } from 'buffer'` : ''
  const wasiCreation = fs
    ? `
export const { fs: __fs, vol: __volume } = memfs()

const __wasi = new __WASI({
  version: 'preview1',
  fs: __fs,
  preopens: {
    '/': '/',
  },
})`
    : `
const __wasi = new __WASI({
  version: 'preview1',
})`

  const workerFsHandler = fs
    ? `      worker.addEventListener('message', __wasmCreateOnMessageForFsProxy(__fs))\n`
    : ''

  const workerErrorHandler = errorEvent
    ? `      worker.addEventListener('message', (event) => {
        if (event.data && typeof event.data === 'object' && event.data.type === 'error') {
          const __CustomEvent = globalThis.CustomEvent
          if (
            typeof globalThis.dispatchEvent === 'function' &&
            typeof __CustomEvent === 'function'
          ) {
            globalThis.dispatchEvent(
              new __CustomEvent('napi-rs-worker-error', { detail: event.data }),
            )
          }
        }
      })
`
    : ''

  const emnapiInjectBuffer = buffer
    ? '  __emnapiContext.feature.Buffer = Buffer\n\n'
    : ''
  const emnapiInstantiateImport = asyncInit
    ? `instantiateNapiModule as __emnapiInstantiateNapiModule`
    : `instantiateNapiModuleSync as __emnapiInstantiateNapiModuleSync`
  const emnapiInstantiateCall = asyncInit
    ? `await __emnapiInstantiateNapiModule`
    : `__emnapiInstantiateNapiModuleSync`
  const workerRuntimeImport = threads
    ? `  createOnMessage as __wasmCreateOnMessageForFsProxy,\n`
    : ''
  const memoryName = threads ? '__sharedMemory' : '__wasmMemory'
  const asyncWorkPoolOption = `    asyncWorkPoolSize: ${threads ? 4 : 0},
`
  const workerOption = threads
    ? `    onCreateWorker() {
      const worker = new Worker(new URL('./wasi-worker-browser.mjs', import.meta.url), {
        type: 'module',
      })
${workerFsHandler}
${workerErrorHandler}
      return worker
    },
`
    : ''

  return `import {
${workerRuntimeImport}\
  ${emnapiInstantiateImport},
  WASI as __WASI,
} from '@napi-rs/wasm-runtime'
import { createContext as __emnapiCreateContext } from '@emnapi/runtime'
${fsImport}
${bufferImport}
${wasiCreation}

const __wasmUrl = new URL('./${wasiFilename}.wasm', import.meta.url).href
const __wasmResponse = await globalThis.fetch(__wasmUrl)
if (!__wasmResponse.ok) {
  throw new Error(
    'Failed to fetch WASI module ' + __wasmUrl + ': ' +
      __wasmResponse.status + ' ' +
      (__wasmResponse.statusText || 'Unknown Status'),
  )
}
const __wasmFile = await __wasmResponse.arrayBuffer()

const ${memoryName} = new WebAssembly.Memory({
  initial: ${initialMemory},
  maximum: ${maximumMemory},
${threads ? '  shared: true,\n' : ''}\
})

const __emnapiContext = __emnapiCreateContext()

function __createInitializationCleanupError(__error, __cleanupError) {
  let __message = 'WASI module initialization failed'
  try {
    if (__error && typeof __error.message === 'string') {
      __message = __error.message
    }
  } catch {}
  const __errors = [__error, __cleanupError]
  const __AggregateError = globalThis.AggregateError
  const __combinedError =
    typeof __AggregateError === 'function'
      ? new __AggregateError(__errors, __message)
      : new Error(__message)
  if (!('errors' in __combinedError)) {
    __combinedError.errors = __errors
  }
  __combinedError.cause = __error
  return __combinedError
}

let __napiInstance
let __wasiModule
let __napiModule

try {
${emnapiInjectBuffer}  ;({
    instance: __napiInstance,
    module: __wasiModule,
    napiModule: __napiModule,
  } = ${emnapiInstantiateCall}(__wasmFile, {
    context: __emnapiContext,
${asyncWorkPoolOption}\
    wasi: __wasi,
${workerOption}\
    overwriteImports(importObject) {
      importObject.env = {
        ...importObject.env,
        ...importObject.napi,
        ...importObject.emnapi,
        memory: ${memoryName},
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
  }))
} catch (__error) {
  try {
    await __emnapiContext.destroy()
  } catch (__cleanupError) {
    throw __createInitializationCleanupError(__error, __cleanupError)
  }
  throw __error
}
`
}

export const createWasiDeferredBrowserBinding = (
  wasiFilename: string,
  // 64 MiB leaves headroom for JS/runtime state under workerd's 128 MiB
  // isolate limit. The regular Node/browser loaders retain their historical
  // 4,000-page default.
  initialMemory = 1024,
  maximumMemory = 65536,
  buffer = false,
) => {
  const bufferImport = buffer ? `import { Buffer } from 'buffer'` : ''
  const emnapiInjectBuffer = buffer
    ? '    __emnapiContext.feature.Buffer = Buffer\n'
    : ''
  return `import {
  instantiateNapiModule as __emnapiInstantiateNapiModule,
  WASI as __WASI,
} from '@napi-rs/wasm-runtime'
import { createContext as __emnapiCreateContext } from '@emnapi/runtime'
${bufferImport}

/**
 * Deferred, workerd-safe instantiation: no top-level I/O, no compile-from-bytes.
 * Accepts ONLY a precompiled WebAssembly.Module, or a Promise resolving to one
 * (e.g. \`import mod from './${wasiFilename}.wasm'\` under a CompiledWasm
 * module rule / wrangler module import). Byte buffers, URLs and Response
 * objects are rejected: they require dynamic Wasm compilation, which
 * Cloudflare Workers disallows.
 */
async function __resolveModule(__wasmInput) {
  const __module = await __wasmInput
  // Brand check, not \`instanceof\`: \`WebAssembly.Module.imports\` throws unless
  // its argument is a genuine WebAssembly.Module, so prototype-spoofed byte
  // buffers are rejected while cross-realm Module instances are accepted.
  try {
    WebAssembly.Module.imports(__module)
  } catch {
    throw new TypeError(
      "instantiate() and createInstance() expect a precompiled WebAssembly.Module (or a Promise resolving to one), " +
        "e.g. import mod from './${wasiFilename}.wasm' under a CompiledWasm module rule / wrangler module import. " +
        "Byte buffers, URLs and Response objects require dynamic Wasm compilation, which Cloudflare Workers disallows.",
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
  // @emnapi/core currently performs realm-local \`instanceof\` checks after
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

function __attachCleanupError(__error, __cleanupError) {
  try {
    if (
      __error &&
      (typeof __error === 'object' || typeof __error === 'function') &&
      __error.cause === undefined
    ) {
      __error.cause = __cleanupError
    }
  } catch {}
}

function __createLifecycleReentryError(__operation) {
  const __error = new Error(
    __operation +
      '() cannot run while an emnapi Context.destroy() call is still active; await the original cleanup promise instead.',
  )
  __error.code = 'ERR_NAPI_WASI_LIFECYCLE_REENTRY'
  return __error
}

const __managedEmnapiContextDestroyers = new Set()
let __managedCleanupProcess
let __managedBeforeExitListener
let __managedDestroyPromise
let __managedDestroyersInFlight
let __managedBeforeExitRegistrationRetryCount = 0
let __managedBeforeExitRegistrationRetryScheduled = false
let __moduleLifecycleDestroyDepth = 0

function __removeManagedEmnapiCleanupListeners() {
  const __process = __managedCleanupProcess
  const __beforeExitListener = __managedBeforeExitListener
  __managedCleanupProcess = undefined
  __managedBeforeExitListener = undefined
  __managedBeforeExitRegistrationRetryCount = 0
  if (__process && __beforeExitListener) {
    try {
      __process.removeListener('beforeExit', __beforeExitListener)
    } catch {}
  }
}

function __scheduleManagedBeforeExitListenerRegistration() {
  if (
    !__managedCleanupProcess ||
    __managedBeforeExitListener ||
    __managedEmnapiContextDestroyers.size === 0 ||
    __managedBeforeExitRegistrationRetryScheduled ||
    __managedBeforeExitRegistrationRetryCount >= 3
  ) {
    return
  }
  __managedBeforeExitRegistrationRetryScheduled = true
  __managedBeforeExitRegistrationRetryCount++
  queueMicrotask(() => {
    __managedBeforeExitRegistrationRetryScheduled = false
    if (
      !__managedCleanupProcess ||
      __managedBeforeExitListener ||
      __managedEmnapiContextDestroyers.size === 0
    ) {
      return
    }
    try {
      __registerManagedBeforeExitListener()
    } catch {}
  })
}

function __registerManagedBeforeExitListener() {
  if (!__managedCleanupProcess || __managedBeforeExitListener) {
    return
  }
  try {
    __managedCleanupProcess.once(
      'beforeExit',
      __destroyManagedEmnapiContextsBeforeExit,
    )
  } catch (error) {
    __scheduleManagedBeforeExitListenerRegistration()
    throw error
  }
  __managedBeforeExitListener = __destroyManagedEmnapiContextsBeforeExit
  __managedBeforeExitRegistrationRetryCount = 0
}

function __settleManagedEmnapiContextDestroy(__promise) {
  if (__managedDestroyPromise === __promise) {
    __managedDestroyPromise = undefined
    __managedDestroyersInFlight = undefined
  }
  if (__managedEmnapiContextDestroyers.size === 0) {
    __removeManagedEmnapiCleanupListeners()
    return
  }
  try {
    __registerManagedBeforeExitListener()
  } catch {}
}

function __destroyManagedEmnapiContexts(__excludedDestroyers) {
  if (__managedDestroyPromise) {
    return __managedDestroyPromise
  }
  const __destroyers = Array.from(__managedEmnapiContextDestroyers).filter(
    (__destroy) => !__excludedDestroyers?.has(__destroy),
  )
  if (__destroyers.length === 0) {
    return Promise.resolve()
  }
  let __resolveDestroy
  let __rejectDestroy
  const __promise = new Promise((resolve, reject) => {
    __resolveDestroy = resolve
    __rejectDestroy = reject
  })
  __managedDestroyPromise = __promise
  __managedDestroyersInFlight = new Set(__destroyers)
  void Promise.all(
    __destroyers.map((__destroy) => {
      try {
        return Promise.resolve(__destroy()).then(
          () => ({ failed: false }),
          (error) => ({ failed: true, error }),
        )
      } catch (error) {
        return { failed: true, error }
      }
    }),
  ).then((__results) => {
    let __primaryError
    let __failed = false
    for (const __result of __results) {
      if (!__result.failed) {
        continue
      }
      if (!__failed) {
        __failed = true
        __primaryError = __result.error
      } else {
        __attachCleanupError(__primaryError, __result.error)
      }
    }
    if (__failed) {
      __rejectDestroy(__primaryError)
    } else {
      __resolveDestroy()
    }
  }, __rejectDestroy)
  void __promise.then(
    () => {
      __settleManagedEmnapiContextDestroy(__promise)
    },
    () => {
      __settleManagedEmnapiContextDestroy(__promise)
    },
  )
  return __promise
}

async function __drainManagedEmnapiContexts(__excludedDestroyers) {
  const __attemptedDestroyers = new Set(__excludedDestroyers)
  let __primaryError
  let __failed = false
  while (true) {
    let __promise = __managedDestroyPromise
    let __destroyers = __managedDestroyersInFlight
    if (!__promise) {
      __promise = __destroyManagedEmnapiContexts(__attemptedDestroyers)
      __destroyers = __managedDestroyersInFlight
      if (!__destroyers) {
        break
      }
    }
    for (const __destroy of __destroyers) {
      __attemptedDestroyers.add(__destroy)
    }
    try {
      await __promise
    } catch (error) {
      if (!__failed) {
        __failed = true
        __primaryError = error
      } else {
        __attachCleanupError(__primaryError, error)
      }
    }
  }
  if (__failed) {
    throw __primaryError
  }
}

function __destroyManagedEmnapiContextsBeforeExit() {
  // A once listener is consumed before Node invokes it, including when another
  // cleanup batch is still pending.
  __managedBeforeExitListener = undefined
  if (__managedDestroyPromise) {
    return
  }
  void __destroyManagedEmnapiContexts().catch((error) => {
    queueMicrotask(() => {
      throw error
    })
  })
}

function __registerManagedEmnapiContext(__process, __destroy) {
  __managedEmnapiContextDestroyers.add(__destroy)
  if (
    !__managedCleanupProcess &&
    __process &&
    typeof __process.once === 'function' &&
    typeof __process.removeListener === 'function'
  ) {
    __managedCleanupProcess = __process
  }
  let __registered = true
  return () => {
    if (!__registered) {
      return
    }
    __registered = false
    __managedEmnapiContextDestroyers.delete(__destroy)
    if (__managedEmnapiContextDestroyers.size === 0) {
      __removeManagedEmnapiCleanupListeners()
    }
  }
}

async function __createManagedEmnapiContext() {
  const __process =
    typeof process === 'object' && process !== null ? process : undefined
  const __finishAutoDestroyCapture =
    __captureEmnapiAutoDestroyListener(__process)
  let __emnapiContext
  let __contextInitializationError
  let __contextInitializationFailed = false
  try {
    __emnapiContext = __emnapiCreateContext({ autoDestroy: false })
    // emnapi <= 1.11 ignores autoDestroy. suppressDestroy() is the public
    // contract that keeps this context alive until our explicit cleanup runs.
    __emnapiContext.suppressDestroy()
  } catch (error) {
    __contextInitializationError = error
    __contextInitializationFailed = true
  } finally {
    // Remove only the exact legacy callback captured above. suppressDestroy()
    // remains the safety net if listener removal is unavailable or fails.
    __finishAutoDestroyCapture?.()
  }
  if (__emnapiContext === undefined) {
    throw __contextInitializationError
  }
  let __disposed = false
  let __destroying = false
  let __destroyPromise
  let __cleanupRegistered = false
  let __unregisterCleanup
  const __destroy = (__blocksModuleLifecycle = false) => {
    if (__disposed) {
      return
    }
    if (__destroying) {
      throw __createLifecycleReentryError('dispose')
    }
    if (__destroyPromise) {
      return __destroyPromise
    }
    __destroying = true
    let __result
    const __finishDestroyInvocation = () => {
      __destroying = false
    }
    const __finishModuleLifecycleDestroy = () => {
      if (__blocksModuleLifecycle) {
        __blocksModuleLifecycle = false
        __moduleLifecycleDestroyDepth--
      }
    }
    if (__blocksModuleLifecycle) {
      __moduleLifecycleDestroyDepth++
    }
    try {
      __result = __emnapiContext.destroy()
    } catch (error) {
      __finishDestroyInvocation()
      __finishModuleLifecycleDestroy()
      throw error
    }
    let __then
    try {
      if (
        __result !== null &&
        (typeof __result === 'object' || typeof __result === 'function')
      ) {
        __then = __result.then
      }
    } catch (error) {
      __finishDestroyInvocation()
      __finishModuleLifecycleDestroy()
      throw error
    }
    if (typeof __then === 'function') {
      let __resolveResult
      let __rejectResult
      const __resultPromise = new Promise((resolve, reject) => {
        __resolveResult = resolve
        __rejectResult = reject
      })
      const __promise = __resultPromise.then(
        (value) => {
          __finishDestroyInvocation()
          __finishModuleLifecycleDestroy()
          __disposed = true
          __destroyPromise = undefined
          __unregisterCleanup?.()
          return value
        },
        (error) => {
          __finishDestroyInvocation()
          __finishModuleLifecycleDestroy()
          __destroyPromise = undefined
          throw error
        },
      )
      __destroyPromise = __promise
      try {
        Reflect.apply(__then, __result, [__resolveResult, __rejectResult])
      } catch (error) {
        __rejectResult(error)
      }
      return __promise
    }
    __finishDestroyInvocation()
    __finishModuleLifecycleDestroy()
    __disposed = true
    __unregisterCleanup?.()
  }
  const __destroyForModuleLifecycle = () => __destroy(true)
  const __registerCleanup = (
    __beforeExitDestroy = __destroyForModuleLifecycle,
  ) => {
    if (__cleanupRegistered || __disposed) {
      return
    }
    __unregisterCleanup = __registerManagedEmnapiContext(
      __process,
      __beforeExitDestroy,
    )
    __cleanupRegistered = true
    __registerManagedBeforeExitListener()
  }
  if (__contextInitializationFailed) {
    let __registrationError
    let __registrationFailed = false
    try {
      __registerCleanup()
    } catch (error) {
      __attachCleanupError(__contextInitializationError, error)
      __registrationError = error
      __registrationFailed = true
    }
    try {
      await __destroyForModuleLifecycle()
    } catch (error) {
      __attachCleanupError(
        __registrationFailed
          ? __registrationError
          : __contextInitializationError,
        error,
      )
      try {
        __registerManagedBeforeExitListener()
      } catch {}
    }
    throw __contextInitializationError
  }
  return {
    context: __emnapiContext,
    destroy: __destroy,
    destroyForModuleLifecycle: __destroyForModuleLifecycle,
    registerCleanup: __registerCleanup,
  }
}

async function __createInstance(
  __wasmInput,
  __beforeExitDestroy,
  __onManagedDestroyer,
) {
  const __module = await __resolveModule(__wasmInput)
  const __emnapiModule = await __normalizeModuleForEmnapi(__module)
  const __wasi = new __WASI({
    version: 'preview1',
  })
  // The wasm module is linked with \`--import-memory\`, so a Memory must be
  // provided. It is allocated here in function scope (workerd bans global
  // scope allocation) and is not shared (no threads, no SharedArrayBuffer).
  // Allocate it before the emnapi context so a host memory-limit failure cannot
  // leak a context that never reaches instantiation.
  const __wasmMemory = new WebAssembly.Memory({
    initial: ${initialMemory},
    maximum: ${maximumMemory},
  })
  let __lifecycleState = 'pending'
  let __destroyEmnapiContext
  let __destroyOwnedContext
  let __destroyManagedOwnedContext
  const __destroyBeforeExit = __beforeExitDestroy
    ? async () => {
        if (__lifecycleState === 'failed') {
          await __destroyManagedOwnedContext()
          return
        }
        __lifecycleState = 'disposal'
        try {
          await __beforeExitDestroy()
        } catch (error) {
          if (__lifecycleState !== 'failed') {
            throw error
          }
          // The singleton's initialization rejection is already observable
          // through instantiate() and dispose(). Managed beforeExit cleanup
          // owns only context destruction, including retrying a failed rollback.
          await __destroyManagedOwnedContext()
        }
      }
    : undefined
  const {
    context: __emnapiContext,
    destroy,
    destroyForModuleLifecycle,
    registerCleanup: __registerCleanup,
  } = await __createManagedEmnapiContext()
  __destroyEmnapiContext = destroy
  __destroyOwnedContext = () => __destroyEmnapiContext()
  __destroyManagedOwnedContext = destroyForModuleLifecycle
  try {
    if (__destroyBeforeExit) {
      __onManagedDestroyer(__destroyBeforeExit)
      await __registerCleanup(__destroyBeforeExit)
    }
${emnapiInjectBuffer}\
    const { napiModule: __napiModule } = await __emnapiInstantiateNapiModule(__emnapiModule, {
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
    })
    if (__lifecycleState === 'pending') {
      __lifecycleState = 'succeeded'
    }
    return {
      exports: __napiModule.exports,
      async dispose() {
        if (__lifecycleState !== 'failed') {
          __lifecycleState = 'disposal'
        }
        return __beforeExitDestroy
          ? __destroyManagedOwnedContext()
          : __destroyOwnedContext()
      },
    }
  } catch (error) {
    __lifecycleState = 'failed'
    let __registrationError
    let __registrationFailed = false
    if (!__beforeExitDestroy) {
      try {
        // Independent instances are caller-owned while pending and after
        // success. Register only failed rollback so cleanup remains retryable.
        await __registerCleanup()
      } catch (registrationError) {
        __attachCleanupError(error, registrationError)
        __registrationError = registrationError
        __registrationFailed = true
      }
    }
    try {
      await __destroyManagedOwnedContext()
    } catch (disposeError) {
      // Initialization is the primary failure. Preserve it even if cleanup
      // also fails, while retaining the cleanup error when the value is
      // extensible and has no existing cause.
      __attachCleanupError(
        __registrationFailed ? __registrationError : error,
        disposeError,
      )
      try {
        __registerManagedBeforeExitListener()
      } catch {}
    }
    throw error
  }
}

/**
 * Create an independent instance. Call dispose() when the instance is no
 * longer needed so emnapi cleanup hooks run deterministically.
 */
export async function createInstance(__wasmInput) {
  return __createInstance(__wasmInput)
}

let __defaultModulePromise
let __defaultInstancePromise
let __defaultDisposePromise
let __defaultDisposalStarted = false
const __defaultManagedDestroyers = new WeakMap()
let __moduleDisposePromise

/**
 * Instantiate a module-local singleton. Concurrent and repeated calls
 * with the same module share one instance and one Memory allocation.
 */
export function instantiate(__wasmInput) {
  const __modulePromise = __resolveModule(__wasmInput)
  if (__moduleLifecycleDestroyDepth !== 0) {
    void __modulePromise.catch(() => {})
    return Promise.reject(__createLifecycleReentryError('instantiate'))
  }
  if (__moduleDisposePromise) {
    void __modulePromise.catch(() => {})
    return __moduleDisposePromise.then(() => instantiate(__modulePromise))
  }
  if (__defaultDisposalStarted) {
    // Observe rejected input immediately, but preserve lifecycle ordering and
    // error precedence by instantiating only after disposal succeeds. A failed
    // disposal retains the old instance only so its cleanup can be retried.
    void __modulePromise.catch(() => {})
    const __disposePromise = __defaultDisposePromise ?? dispose()
    return __disposePromise.then(() => instantiate(__modulePromise))
  }
  if (!__defaultInstancePromise) {
    __defaultModulePromise = __modulePromise
    const __instancePromise = __modulePromise.then((__module) =>
      __createInstance(
        __module,
        __disposeDefaultInstance,
        (__managedDestroyer) => {
          __defaultManagedDestroyers.set(
            __instancePromise,
            __managedDestroyer,
          )
        },
      ),
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

async function __disposeDefaultInstance(__onDestroy) {
  if (__defaultDisposePromise) {
    return __defaultDisposePromise
  }
  const __instancePromise = __defaultInstancePromise
  if (!__instancePromise) {
    __defaultDisposalStarted = false
    return
  }
  __defaultDisposalStarted = true
  const __disposePromise = (async () => {
    let __instance
    try {
      __instance = await __instancePromise
    } catch (error) {
      const __managedDestroyer =
        __defaultManagedDestroyers.get(__instancePromise)
      if (__managedDestroyer) {
        __onDestroy?.(__managedDestroyer)
      }
      __defaultManagedDestroyers.delete(__instancePromise)
      throw error
    }
    const __managedDestroyer =
      __defaultManagedDestroyers.get(__instancePromise)
    if (__managedDestroyer) {
      __onDestroy?.(__managedDestroyer)
    }
    await __instance.dispose()
    if (__defaultInstancePromise === __instancePromise) {
      __defaultInstancePromise = undefined
      __defaultModulePromise = undefined
      __defaultDisposalStarted = false
    }
    __defaultManagedDestroyers.delete(__instancePromise)
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

async function __dispose() {
  let __defaultDisposeError
  let __defaultDisposeFailed = false
  let __attemptedDefaultDestroyer
  try {
    await __disposeDefaultInstance((__destroyer) => {
      __attemptedDefaultDestroyer = __destroyer
    })
  } catch (error) {
    __defaultDisposeError = error
    __defaultDisposeFailed = true
  }
  const __excludedDestroyers = new Set()
  if (__defaultDisposeFailed && __attemptedDefaultDestroyer) {
    __excludedDestroyers.add(__attemptedDefaultDestroyer)
  }
  try {
    await __drainManagedEmnapiContexts(__excludedDestroyers)
  } catch (error) {
    if (!__defaultDisposeFailed) {
      throw error
    }
    if (error !== __defaultDisposeError) {
      __attachCleanupError(__defaultDisposeError, error)
    }
  }
  if (__defaultDisposeFailed) {
    throw __defaultDisposeError
  }
}

/**
 * Dispose the singleton created by instantiate(). A later call may create a
 * fresh instance, including from a different module. This also retries cleanup
 * retained after a failed initialization rollback.
 */
export function dispose() {
  if (__moduleLifecycleDestroyDepth !== 0) {
    return Promise.reject(__createLifecycleReentryError('dispose'))
  }
  if (__moduleDisposePromise) {
    return __moduleDisposePromise
  }
  let __resolveDispose
  let __rejectDispose
  const __promise = new Promise((resolve, reject) => {
    __resolveDispose = resolve
    __rejectDispose = reject
  })
  __moduleDisposePromise = __promise
  void __dispose().then(__resolveDispose, __rejectDispose)
  void __promise.then(
    () => {
      if (__moduleDisposePromise === __promise) {
        __moduleDisposePromise = undefined
      }
    },
    () => {
      if (__moduleDisposePromise === __promise) {
        __moduleDisposePromise = undefined
      }
    },
  )
  return __promise
}
`
}

export const createWasiDeferredBrowserBindingTypeDef = (
  packageName: string,
) => `export type WasiBinding = typeof import('${packageName}')

export type WasiModuleInput =
  | WebAssembly.Module
  | PromiseLike<WebAssembly.Module>

export interface WasiInstance {
  readonly exports: WasiBinding
  dispose(): Promise<void>
}

export function instantiate(wasmInput: WasiModuleInput): Promise<WasiBinding>
export function createInstance(wasmInput: WasiModuleInput): Promise<WasiInstance>
/** Dispose the singleton and retry retained failed-initialization cleanup. */
export function dispose(): Promise<void>
`

export const createWasiBinding = (
  wasmFileName: string,
  packageName: string,
  initialMemory = 4000,
  maximumMemory = 65536,
  threads = true,
  // `platformArchABI` of the flavor this loader belongs to; the fallback
  // package (`<packageName>-<platformArchABI>`) must ship the same flavor's
  // wasm artifact.
  platformArchABI = 'wasm32-wasi',
  packageWasmFileName = wasmFileName,
) => {
  const workerImports = threads
    ? `const { Worker } = require('node:worker_threads')
`
    : ''
  const workerExecArgv = threads
    ? `
function __getWorkerExecArgv() {
  const __workerExecArgv = []
  for (let __index = 0; __index < process.execArgv.length; __index += 1) {
    const __arg = process.execArgv[__index]
    if (
      __arg === '--input-type' ||
      __arg === '--eval' ||
      __arg === '-e' ||
      __arg === '--print' ||
      __arg === '-p'
    ) {
      __index += 1
      continue
    }
    if (
      __arg.startsWith('--input-type=') ||
      __arg.startsWith('--eval=') ||
      __arg.startsWith('--print=')
    ) {
      continue
    }
    __workerExecArgv.push(__arg)
  }
  return __workerExecArgv
}

function __createWasiWorker(filename) {
  try {
    return new Worker(filename, {
      env: process.env,
      execArgv: __getWorkerExecArgv(),
    })
  } catch (error) {
    if (!error || error.code !== 'ERR_WORKER_INVALID_EXEC_ARGV') {
      throw error
    }
  }
  return new Worker(filename, {
    env: process.env,
    execArgv: [],
  })
}
`
    : ''
  const workerTracking = threads
    ? `
const __wasiInitializationWorkers = new Set()

function __terminateWasiInitializationWorkers(__error) {
  for (const __worker of __wasiInitializationWorkers) {
    __wasiInitializationWorkers.delete(__worker)
    try {
      const __termination = __worker.terminate()
      if (__termination && typeof __termination.then === 'function') {
        void Promise.resolve(__termination).catch((__cleanupError) => {
          __attachCleanupError(__error, __cleanupError)
        })
      }
    } catch (__cleanupError) {
      __attachCleanupError(__error, __cleanupError)
    }
  }
}
`
    : '\n'
  const workerRuntimeImport = threads
    ? `  createOnMessage: __wasmCreateOnMessageForFsProxy,\n`
    : ''
  const memoryName = threads ? '__sharedMemory' : '__wasmMemory'
  const asyncWorkOptions = threads
    ? `  asyncWorkPoolSize: (function() {
    const threadsSizeFromEnv = Number(process.env.NAPI_RS_ASYNC_WORK_POOL_SIZE ?? process.env.UV_THREADPOOL_SIZE)
    // NaN > 0 is false
    if (threadsSizeFromEnv > 0) {
      return threadsSizeFromEnv
    } else {
      return 4
    }
  })(),
  reuseWorker: true,
`
    : `  asyncWorkPoolSize: 0,
`
  const workerOption = threads
    ? `  onCreateWorker() {
    const worker = __createWasiWorker(__nodePath.join(__dirname, 'wasi-worker.mjs'))
    __wasiInitializationWorkers.add(worker)
    worker.onmessage = ({ data }) => {
      __wasmCreateOnMessageForFsProxy(__nodeFs)(data)
    }

    // The main thread of Node.js waits for all the active handles before exiting.
    // But Rust threads are never waited without \`thread::join\`.
    // So here we hack the code of Node.js to prevent the workers from being referenced (active).
    // According to https://github.com/nodejs/node/blob/19e0d472728c79d418b74bddff588bea70a403d0/lib/internal/worker.js#L415,
    // a worker is consist of two handles: kPublicPort and kHandle.
    {
      const kPublicPort = Object.getOwnPropertySymbols(worker).find(s =>
        s.toString().includes("kPublicPort")
      );
      if (kPublicPort) {
        worker[kPublicPort].ref = () => {};
      }

      const kHandle = Object.getOwnPropertySymbols(worker).find(s =>
        s.toString().includes("kHandle")
      );
      if (kHandle) {
        worker[kHandle].ref = () => {};
      }

      worker.unref();
    }
    return worker
  },
`
    : ''

  return `/* eslint-disable */
/* prettier-ignore */

/* auto-generated by NAPI-RS */

const __nodeFs = require('node:fs')
const __nodePath = require('node:path')
const { WASI: __nodeWASI } = require('node:wasi')
${workerImports}\

const {
${workerRuntimeImport}\
  instantiateNapiModuleSync: __emnapiInstantiateNapiModuleSync,
} = require('@napi-rs/wasm-runtime')
const { createContext: __emnapiCreateContext } = require('@emnapi/runtime')
${workerExecArgv}\
${workerTracking}\

const __rootDir = __nodePath.parse(process.cwd()).root

const __wasi = new __nodeWASI({
  version: 'preview1',
  env: process.env,
  preopens: {
    [__rootDir]: __rootDir,
  }
})

function __captureEmnapiAutoDestroyListener() {
  if (
    typeof process.prependListener !== 'function' ||
    typeof process.removeListener !== 'function'
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
    process.prependListener('newListener', __captureListener)
  } catch {
    return
  }
  return () => {
    try {
      process.removeListener('newListener', __captureListener)
    } catch {}
    if (__autoDestroyListener !== undefined) {
      try {
        process.removeListener('beforeExit', __autoDestroyListener)
      } catch {}
    }
  }
}

const __finishAutoDestroyCapture = __captureEmnapiAutoDestroyListener()
let __emnapiContext
let __emnapiContextDestroyed = false
let __emnapiContextDestroying = false
let __emnapiContextDestroyPromise
let __emnapiContextRegisteredForBeforeExit = false
let __emnapiContextRegisteredForExit = false
let __emnapiContextBeforeExitRegistrationRetryCount = 0
let __emnapiContextBeforeExitRegistrationRetryScheduled = false
let __contextInitializationError
let __contextInitializationFailed = false
try {
  __emnapiContext = __emnapiCreateContext({ autoDestroy: false })
  // emnapi <= 1.11 ignores autoDestroy. suppressDestroy() is the public
  // contract that keeps this context alive until our explicit cleanup runs.
  __emnapiContext.suppressDestroy()
} catch (error) {
  __contextInitializationError = error
  __contextInitializationFailed = true
} finally {
  // Remove only the exact legacy callback captured above. suppressDestroy()
  // remains the safety net if listener removal is unavailable or fails.
  __finishAutoDestroyCapture?.()
}

function __destroyEmnapiContext() {
  if (__emnapiContextDestroyed) {
    return
  }
  if (__emnapiContextDestroyPromise) {
    return __emnapiContextDestroyPromise
  }
  if (__emnapiContextDestroying) {
    return
  }
  __emnapiContextDestroying = true
  let __result
  try {
    __result = __emnapiContext.destroy()
  } catch (error) {
    __emnapiContextDestroying = false
    throw error
  }
  let __then
  try {
    if (
      __result !== null &&
      (typeof __result === 'object' || typeof __result === 'function')
    ) {
      __then = __result.then
    }
  } catch (error) {
    __emnapiContextDestroying = false
    throw error
  }
  if (typeof __then === 'function') {
    let __resolveResult
    let __rejectResult
    const __resultPromise = new Promise((resolve, reject) => {
      __resolveResult = resolve
      __rejectResult = reject
    })
    const __promise = __resultPromise.then(
      (value) => {
        __emnapiContextDestroying = false
        __emnapiContextDestroyed = true
        __emnapiContextDestroyPromise = undefined
        return value
      },
      (error) => {
        __emnapiContextDestroying = false
        __emnapiContextDestroyPromise = undefined
        throw error
      },
    )
    __emnapiContextDestroyPromise = __promise
    try {
      Reflect.apply(__then, __result, [__resolveResult, __rejectResult])
    } catch (error) {
      __rejectResult(error)
    }
    return __promise
  }
  __emnapiContextDestroying = false
  __emnapiContextDestroyed = true
}

function __removeEmnapiContextBeforeExitListener() {
  if (__emnapiContextRegisteredForBeforeExit) {
    process.removeListener('beforeExit', __destroyEmnapiContextBeforeExit)
    __emnapiContextRegisteredForBeforeExit = false
  }
}

function __removeEmnapiContextAtExitListener() {
  if (__emnapiContextRegisteredForExit) {
    process.removeListener('exit', __destroyEmnapiContextAtExit)
    __emnapiContextRegisteredForExit = false
  }
}

function __removeEmnapiContextCleanupListeners() {
  const __errors = []
  try {
    __removeEmnapiContextBeforeExitListener()
  } catch (__error) {
    __errors.push(__error)
  }
  try {
    __removeEmnapiContextAtExitListener()
  } catch (__error) {
    __errors.push(__error)
  }
  if (__errors.length === 0) {
    __emnapiContextBeforeExitRegistrationRetryCount = 0
    return
  }
  if (__errors.length === 1) {
    throw __errors[0]
  }
  throw new AggregateError(
    __errors,
    'emnapi context cleanup listener removal failed',
  )
}

function __scheduleEmnapiContextBeforeExitRegistration() {
  if (
    __emnapiContextDestroyed ||
    __emnapiContextRegisteredForBeforeExit ||
    __emnapiContextBeforeExitRegistrationRetryScheduled ||
    __emnapiContextBeforeExitRegistrationRetryCount >= 3
  ) {
    return
  }
  __emnapiContextBeforeExitRegistrationRetryScheduled = true
  __emnapiContextBeforeExitRegistrationRetryCount++
  queueMicrotask(() => {
    __emnapiContextBeforeExitRegistrationRetryScheduled = false
    if (
      __emnapiContextDestroyed ||
      __emnapiContextRegisteredForBeforeExit
    ) {
      return
    }
    try {
      __registerEmnapiContextBeforeExit()
    } catch {}
  })
}

function __registerEmnapiContextBeforeExit() {
  if (!__emnapiContextRegisteredForBeforeExit) {
    try {
      process.once('beforeExit', __destroyEmnapiContextBeforeExit)
    } catch (error) {
      __scheduleEmnapiContextBeforeExitRegistration()
      throw error
    }
    __emnapiContextRegisteredForBeforeExit = true
    __emnapiContextBeforeExitRegistrationRetryCount = 0
  }
}

function __registerEmnapiContextAtExit() {
  if (!__emnapiContextRegisteredForExit) {
    process.once('exit', __destroyEmnapiContextAtExit)
    __emnapiContextRegisteredForExit = true
  }
}

function __retainEmnapiContextCleanupListener() {
  if (
    __emnapiContextDestroyed ||
    __emnapiContextRegisteredForBeforeExit ||
    __emnapiContextRegisteredForExit
  ) {
    return
  }
  __registerEmnapiContextBeforeExit()
}

function __handoffEmnapiContextCleanupToExit() {
  const __exitWasRegistered = __emnapiContextRegisteredForExit
  __registerEmnapiContextAtExit()
  try {
    __removeEmnapiContextBeforeExitListener()
  } catch (__error) {
    if (!__exitWasRegistered) {
      try {
        __removeEmnapiContextAtExitListener()
      } catch (__rollbackError) {
        throw new AggregateError(
          [__error, __rollbackError],
          'emnapi context cleanup listener handoff failed',
          { cause: __error },
        )
      }
    }
    throw __error
  }
}

function __destroyEmnapiContextBeforeExit() {
  __emnapiContextRegisteredForBeforeExit = false
  let __result
  try {
    __result = __destroyEmnapiContext()
  } catch (error) {
    try {
      __registerEmnapiContextBeforeExit()
    } catch {}
    queueMicrotask(() => {
      throw error
    })
    return
  }
  if (__result) {
    void __result.then(
      () => {
        __removeEmnapiContextCleanupListeners()
      },
      (error) => {
        try {
          __registerEmnapiContextBeforeExit()
        } catch {}
        queueMicrotask(() => {
          throw error
        })
      },
    )
  } else {
    __removeEmnapiContextCleanupListeners()
  }
}

function __destroyEmnapiContextAtExit() {
  __emnapiContextRegisteredForExit = false
  try {
    const __result = __destroyEmnapiContext()
    if (__result) {
      void __result.catch(() => {})
    }
  } catch {}
}

function __attachCleanupError(__error, __cleanupError) {
  try {
    if (
      __error &&
      (typeof __error === 'object' || typeof __error === 'function')
    ) {
      if (__error.cause === undefined) {
        __error.cause = __cleanupError
        return __error.cause === __cleanupError
      }
      return __error.cause === __cleanupError
    }
  } catch {}
  return false
}

function __preserveCleanupError(__error, __cleanupError) {
  if (!__attachCleanupError(__error, __cleanupError)) {
    queueMicrotask(() => {
      throw __cleanupError
    })
  }
}

if (__contextInitializationFailed) {
  let __registrationError
  let __registrationFailed = false
  if (__emnapiContext !== undefined) {
    try {
      __registerEmnapiContextBeforeExit()
    } catch (error) {
      __preserveCleanupError(__contextInitializationError, error)
      __registrationError = error
      __registrationFailed = true
    }
    let __cleanupResult
    let __cleanupFailed = false
    try {
      __cleanupResult = __destroyEmnapiContext()
    } catch (error) {
      __cleanupFailed = true
      __preserveCleanupError(
        __registrationFailed
          ? __registrationError
          : __contextInitializationError,
        error,
      )
      try {
        __retainEmnapiContextCleanupListener()
      } catch (__listenerError) {
        __preserveCleanupError(
          __contextInitializationError,
          __listenerError,
        )
      }
    }
    if (__cleanupResult) {
      void __cleanupResult.then(
        () => {
          try {
            __removeEmnapiContextCleanupListeners()
          } catch (__cleanupError) {
            __preserveCleanupError(
              __contextInitializationError,
              __cleanupError,
            )
          }
        },
        (error) => {
          __preserveCleanupError(
            __registrationFailed
              ? __registrationError
              : __contextInitializationError,
            error,
          )
          try {
            __retainEmnapiContextCleanupListener()
          } catch (__listenerError) {
            __preserveCleanupError(
              __contextInitializationError,
              __listenerError,
            )
          }
        },
      )
    } else if (!__cleanupFailed) {
      try {
        __removeEmnapiContextCleanupListeners()
      } catch (__cleanupError) {
        __preserveCleanupError(
          __contextInitializationError,
          __cleanupError,
        )
      }
    }
  }
  throw __contextInitializationError
}

let ${memoryName}
let __napiInstance
let __wasiModule
let __napiModule

try {
  __registerEmnapiContextBeforeExit()

  ${memoryName} = new WebAssembly.Memory({
    initial: ${initialMemory},
    maximum: ${maximumMemory},
${threads ? '    shared: true,\n' : ''}\
  })

  let __wasmFilePath = __nodePath.join(__dirname, '${wasmFileName}.wasm')
  const __wasmDebugFilePath = __nodePath.join(__dirname, '${wasmFileName}.debug.wasm')

  if (__nodeFs.existsSync(__wasmDebugFilePath)) {
    __wasmFilePath = __wasmDebugFilePath
  } else if (!__nodeFs.existsSync(__wasmFilePath)) {
    const __wasiPackageEntry = require.resolve('${packageName}-${platformArchABI}')
    const __packagedWasmFilePath = __nodePath.join(
    __nodePath.dirname(__wasiPackageEntry),
    '${packageWasmFileName}.wasm',
    )
    if (!__nodeFs.existsSync(__packagedWasmFilePath)) {
      throw new Error(
        '${packageName}-${platformArchABI} is installed but is missing ${packageWasmFileName}.wasm.',
      )
    }
    __wasmFilePath = __packagedWasmFilePath
  }

  ;({
    instance: __napiInstance,
    module: __wasiModule,
    napiModule: __napiModule,
  } = __emnapiInstantiateNapiModuleSync(__nodeFs.readFileSync(__wasmFilePath), {
    context: __emnapiContext,
${asyncWorkOptions}\
    wasi: __wasi,
${workerOption}\
    overwriteImports(importObject) {
      importObject.env = {
        ...importObject.env,
        ...importObject.napi,
        ...importObject.emnapi,
        memory: ${memoryName},
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
  }))
  // CommonJS can retain these eager exports in its module cache across any
  // number of beforeExit work-resumption cycles. Node provides no terminal
  // beforeExit signal, so a successfully initialized context must remain live
  // until exit. Context.destroy() is synchronous in emnapi's public contract,
  // so terminal cleanup hooks still get a best-effort invocation. A
  // nonconforming thenable cannot be awaited from exit, but is marked handled.
  __handoffEmnapiContextCleanupToExit()
${threads ? '  __wasiInitializationWorkers.clear()\n' : ''}\
} catch (__error) {
${threads ? '  __terminateWasiInitializationWorkers(__error)\n' : ''}\
  let __cleanupResult
  let __cleanupFailed = false
  try {
    __cleanupResult = __destroyEmnapiContext()
  } catch (__cleanupError) {
    __cleanupFailed = true
    __preserveCleanupError(__error, __cleanupError)
    try {
      __retainEmnapiContextCleanupListener()
    } catch (__listenerError) {
      __preserveCleanupError(__error, __listenerError)
    }
  }
  if (__cleanupResult) {
    void __cleanupResult.then(
      () => {
        try {
          __removeEmnapiContextCleanupListeners()
        } catch (__cleanupError) {
          __preserveCleanupError(__error, __cleanupError)
        }
      },
      (__cleanupError) => {
        __preserveCleanupError(__error, __cleanupError)
        try {
          __retainEmnapiContextCleanupListener()
        } catch (__listenerError) {
          __preserveCleanupError(__error, __listenerError)
        }
      },
    )
  } else if (!__cleanupFailed) {
    try {
      __removeEmnapiContextCleanupListeners()
    } catch (__cleanupError) {
      __preserveCleanupError(__error, __cleanupError)
    }
  }
  throw __error
}
`
}
