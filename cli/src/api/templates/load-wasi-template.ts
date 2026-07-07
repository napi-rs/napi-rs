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
    ? `    worker.addEventListener('message', __wasmCreateOnMessageForFsProxy(__fs))\n`
    : ''

  const workerErrorHandler = errorEvent
    ? `    worker.addEventListener('message', (event) => {
      if (event.data && typeof event.data === 'object' && event.data.type === 'error') {
        window.dispatchEvent(new CustomEvent('napi-rs-worker-error', { detail: event.data }))
      }
    })
`
    : ''

  const emnapiInjectBuffer = buffer
    ? '__emnapiContext.feature.Buffer = Buffer'
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
  const asyncWorkPoolOption = `  asyncWorkPoolSize: ${threads ? 4 : 0},
`
  const workerOption = threads
    ? `  onCreateWorker() {
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
  createContext as __emnapiCreateContext,
${workerRuntimeImport}\
  ${emnapiInstantiateImport},
  WASI as __WASI,
} from '@napi-rs/wasm-runtime'
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

const __emnapiContext = __emnapiCreateContext()
${emnapiInjectBuffer}

const ${memoryName} = new WebAssembly.Memory({
  initial: ${initialMemory},
  maximum: ${maximumMemory},
${threads ? '  shared: true,\n' : ''}\
})

const {
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
})
`
}

export const createWasiDeferredBrowserBinding = (
  wasiFilename: string,
  // 64 MiB leaves headroom for JS/runtime state under workerd's 128 MiB
  // isolate limit. The regular Node/browser loaders retain their historical
  // 4,000-page default.
  initialMemory = 1024,
  maximumMemory = 65536,
) => {
  return `import {
  instantiateNapiModule as __emnapiInstantiateNapiModule,
  WASI as __WASI,
} from '@napi-rs/wasm-runtime'
import { createContext as __emnapiCreateContext } from '@emnapi/runtime'

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

function __getBeforeExitListeners(__process) {
  if (!__process) {
    return
  }
  const __getListeners =
    typeof __process.rawListeners === 'function'
      ? __process.rawListeners
      : typeof __process.listeners === 'function'
        ? __process.listeners
        : undefined
  if (!__getListeners) {
    return
  }
  try {
    return __getListeners.call(__process, 'beforeExit')
  } catch {}
}

function __removeAddedBeforeExitListeners(__process, __beforeListeners) {
  if (!__process || !__beforeListeners) {
    return
  }
  const __afterListeners = __getBeforeExitListeners(__process)
  if (!__afterListeners) {
    return
  }
  const __remainingBeforeListeners = new Map()
  for (const __listener of __beforeListeners) {
    __remainingBeforeListeners.set(
      __listener,
      (__remainingBeforeListeners.get(__listener) || 0) + 1,
    )
  }
  for (const __listener of __afterListeners) {
    const __remaining = __remainingBeforeListeners.get(__listener) || 0
    if (__remaining > 0) {
      __remainingBeforeListeners.set(__listener, __remaining - 1)
      continue
    }
    try {
      __process.removeListener('beforeExit', __listener)
    } catch {}
  }
}

const __managedEmnapiContextDestroyers = new Set()
let __managedBeforeExitProcess
let __managedBeforeExitListener

function __destroyManagedEmnapiContexts() {
  __managedBeforeExitProcess = undefined
  __managedBeforeExitListener = undefined
  let __firstError
  for (const __destroy of [...__managedEmnapiContextDestroyers]) {
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
  if (!__managedBeforeExitListener) {
    try {
      __process.once('beforeExit', __destroyManagedEmnapiContexts)
      __managedBeforeExitProcess = __process
      __managedBeforeExitListener = __destroyManagedEmnapiContexts
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
      __managedBeforeExitListener &&
      __managedBeforeExitProcess
    ) {
      try {
        __managedBeforeExitProcess.removeListener(
          'beforeExit',
          __managedBeforeExitListener,
        )
      } catch {}
      __managedBeforeExitProcess = undefined
      __managedBeforeExitListener = undefined
    }
  }
}

function __createManagedEmnapiContext() {
  const __process =
    typeof process === 'object' && process !== null ? process : undefined
  const __beforeExitListeners = __getBeforeExitListeners(__process)
  let __emnapiContext
  try {
    __emnapiContext = __emnapiCreateContext({ autoDestroy: false })
  } catch (error) {
    __removeAddedBeforeExitListeners(__process, __beforeExitListeners)
    throw error
  }
  // emnapi <= 1.11 ignores autoDestroy and installs an anonymous listener.
  // Remove only listeners added synchronously by this context construction;
  // newer runtimes add none when autoDestroy is false.
  __removeAddedBeforeExitListeners(__process, __beforeExitListeners)
  let __disposed = false
  let __unregisterBeforeExit
  const __destroy = () => {
    if (__disposed) {
      return
    }
    __disposed = true
    __unregisterBeforeExit?.()
    return __emnapiContext.destroy()
  }
  try {
    __unregisterBeforeExit = __registerManagedEmnapiContext(
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
    try {
      const __instance = await __instancePromise
      __instance.dispose()
    } finally {
      // Cleanup failure can leave emnapi partially stopped. Never expose that
      // instance again or retry cleanup against the poisoned context.
      if (__defaultInstancePromise === __instancePromise) {
        __defaultInstancePromise = undefined
        __defaultModulePromise = undefined
      }
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
    const worker = new Worker(__nodePath.join(__dirname, 'wasi-worker.mjs'), {
      env: process.env,
    })
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
  createContext: __emnapiCreateContext,
  instantiateNapiModuleSync: __emnapiInstantiateNapiModuleSync,
} = require('@napi-rs/wasm-runtime')

const __rootDir = __nodePath.parse(process.cwd()).root

const __wasi = new __nodeWASI({
  version: 'preview1',
  env: process.env,
  preopens: {
    [__rootDir]: __rootDir,
  }
})

const __emnapiContext = __emnapiCreateContext()

const ${memoryName} = new WebAssembly.Memory({
  initial: ${initialMemory},
  maximum: ${maximumMemory},
${threads ? '  shared: true,\n' : ''}\
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

const { instance: __napiInstance, module: __wasiModule, napiModule: __napiModule } = __emnapiInstantiateNapiModuleSync(__nodeFs.readFileSync(__wasmFilePath), {
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
})
`
}
