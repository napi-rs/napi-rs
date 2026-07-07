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
    __emnapiContext.destroy()
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

const __managedEmnapiContextDestroyers = new Set()
let __managedExitProcess
let __managedExitListener

function __destroyManagedEmnapiContexts() {
  __managedExitProcess = undefined
  __managedExitListener = undefined
  let __firstError
  const __destroyers = Array.from(__managedEmnapiContextDestroyers)
  for (const __destroy of __destroyers) {
    try {
      __destroy()
    } catch (error) {
      __firstError ??= error
    }
  }
  if (__firstError) {
    throw __firstError
  }
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
  if (!__managedExitListener) {
    try {
      __process.once('exit', __destroyManagedEmnapiContexts)
      __managedExitProcess = __process
      __managedExitListener = __destroyManagedEmnapiContexts
    } catch (error) {
      __managedEmnapiContextDestroyers.delete(__destroy)
      throw error
    }
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
      __managedExitListener &&
      __managedExitProcess
    ) {
      try {
        __managedExitProcess.removeListener('exit', __managedExitListener)
      } catch {}
      __managedExitProcess = undefined
      __managedExitListener = undefined
    }
  }
}

function __createManagedEmnapiContext() {
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
  let __unregisterExit
  const __destroy = () => {
    if (__disposed) {
      return
    }
    const __result = __emnapiContext.destroy()
    __disposed = true
    __unregisterExit?.()
    return __result
  }
  try {
    __unregisterExit = __registerManagedEmnapiContext(
      __process,
      __destroy,
    )
  } catch (error) {
    __disposed = true
    try {
      __emnapiContext.destroy()
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

/**
 * Create an independent instance. Call dispose() when the instance is no
 * longer needed so emnapi cleanup hooks run deterministically.
 */
export async function createInstance(__wasmInput) {
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
  const {
    context: __emnapiContext,
    destroy: __destroyEmnapiContext,
  } = __createManagedEmnapiContext()
  try {
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
    return {
      exports: __napiModule.exports,
      dispose() {
        __destroyEmnapiContext()
      },
    }
  } catch (error) {
    try {
      __destroyEmnapiContext()
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
      createInstance(__module),
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
    __instance.dispose()
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
  dispose(): void
}

export function instantiate(wasmInput: WasiModuleInput): Promise<WasiBinding>
export function createInstance(wasmInput: WasiModuleInput): Promise<WasiInstance>
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
${workerExecArgv}

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
let __emnapiContextDestroyed = false

function __destroyEmnapiContext() {
  if (__emnapiContextDestroyed) {
    return
  }
  const __result = __emnapiContext.destroy()
  __emnapiContextDestroyed = true
  return __result
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

let ${memoryName}
let __napiInstance
let __wasiModule
let __napiModule
let __emnapiContextRegisteredForExit = false

try {
  process.once('exit', __destroyEmnapiContext)
  __emnapiContextRegisteredForExit = true

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
} catch (__error) {
  try {
    __destroyEmnapiContext()
  } catch (__cleanupError) {
    __attachCleanupError(__error, __cleanupError)
    throw __error
  }
  if (__emnapiContextRegisteredForExit) {
    try {
      process.removeListener('exit', __destroyEmnapiContext)
    } catch {}
  }
  throw __error
}
`
}
