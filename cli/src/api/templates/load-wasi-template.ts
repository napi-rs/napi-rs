const WASI_DISPOSE_SYMBOL = 'napi.rs.wasi.dispose'

const emnapiContextLifecycle = `
const __wasiDisposeSymbol = Symbol.for('${WASI_DISPOSE_SYMBOL}')
const __wasiWorkers = new Set()
let __napiInstance
let __emnapiContextDestroyed = false
let __emnapiContextDestroyPromise
let __emnapiWasmEnvCleanupPrepared = false
let __wasiDisposed = false
let __wasiDisposePromise
let __completeWasiDisposal = function() {}

function __isThenable(value) {
  return (
    value !== null &&
    (typeof value === 'object' || typeof value === 'function') &&
    typeof value.then === 'function'
  )
}

function __createCleanupError(errors, message) {
  if (errors.length === 1) {
    return errors[0]
  }
  if (typeof AggregateError === 'function') {
    return new AggregateError(errors, message)
  }
  const error = new Error(message)
  error.errors = errors
  return error
}

function __attachCleanupErrors(error, cleanupErrors) {
  if (cleanupErrors.length === 0) {
    return error
  }
  const cleanupError = __createCleanupError(
    cleanupErrors,
    'WASI binding cleanup failed',
  )
  try {
    if (
      error &&
      (typeof error === 'object' || typeof error === 'function')
    ) {
      if (error.cause === undefined) {
        error.cause = cleanupError
        if (error.cause === cleanupError) {
          return error
        }
      }
      if (Array.isArray(error.cleanupErrors)) {
        error.cleanupErrors.push(cleanupError)
        return error
      } else {
        const attachedCleanupErrors = [cleanupError]
        error.cleanupErrors = attachedCleanupErrors
        if (error.cleanupErrors === attachedCleanupErrors) {
          return error
        }
      }
    }
  } catch {}
  const aggregate = __createCleanupError(
    [error, cleanupError],
    'WASI binding initialization and cleanup failed',
  )
  try {
    aggregate.cause = error
  } catch {}
  return aggregate
}

function __prepareWasmEnvCleanup() {
  if (__emnapiWasmEnvCleanupPrepared) {
    return
  }
  const prepare = __napiInstance?.exports?.napi_prepare_wasm_env_cleanup
  if (typeof prepare === 'function') {
    prepare()
  }
  __emnapiWasmEnvCleanupPrepared = true
}

function __destroyEmnapiContext() {
  if (__emnapiContextDestroyed || __emnapiContext === undefined) {
    __emnapiContextDestroyed = true
    return
  }
  if (__emnapiContextDestroyPromise) {
    return __emnapiContextDestroyPromise
  }

  __prepareWasmEnvCleanup()
  const result = __emnapiContext.destroy()
  if (!__isThenable(result)) {
    __emnapiContextDestroyed = true
    return
  }

  const destroyPromise = Promise.resolve(result).then(
    (value) => {
      __emnapiContextDestroyed = true
      return value
    },
    (error) => {
      __emnapiContextDestroyPromise = undefined
      throw error
    },
  )
  __emnapiContextDestroyPromise = destroyPromise
  return destroyPromise
}

function __terminateWasiWorkers() {
  const cleanupErrors = []
  const pending = []

  for (const worker of __wasiWorkers) {
    let result
    try {
      result = worker.terminate()
    } catch (error) {
      cleanupErrors.push(error)
      continue
    }
    if (__isThenable(result)) {
      pending.push(
        Promise.resolve(result).then(
          () => {
            __wasiWorkers.delete(worker)
          },
          (error) => {
            cleanupErrors.push(error)
          },
        ),
      )
    } else {
      __wasiWorkers.delete(worker)
    }
  }

  const finish = () => {
    if (cleanupErrors.length > 0) {
      throw __createCleanupError(
        cleanupErrors,
        'Failed to terminate WASI workers',
      )
    }
  }
  return pending.length > 0 ? Promise.all(pending).then(finish) : finish()
}

function __finishWasiDisposal() {
  const workerResult = __terminateWasiWorkers()
  if (__isThenable(workerResult)) {
    return Promise.resolve(workerResult).then(__completeWasiDisposal)
  }
  return __completeWasiDisposal()
}

function __startWasiDisposal() {
  const destroyResult = __destroyEmnapiContext()
  if (__isThenable(destroyResult)) {
    return Promise.resolve(destroyResult).then(__finishWasiDisposal)
  }
  return __finishWasiDisposal()
}

/**
 * Disposes this generated WASI binding.
 *
 * Access this function with:
 * binding[Symbol.for('${WASI_DISPOSE_SYMBOL}')]()
 */
function __disposeWasiBinding() {
  if (__wasiDisposePromise) {
    return __wasiDisposePromise
  }
  if (__wasiDisposed) {
    return Promise.resolve()
  }

  let result
  try {
    result = __startWasiDisposal()
  } catch (error) {
    result = Promise.reject(error)
  }
  const disposePromise = Promise.resolve(result).then(
    (value) => {
      __wasiDisposed = true
      return value
    },
    (error) => {
      __wasiDisposePromise = undefined
      throw error
    },
  )
  __wasiDisposePromise = disposePromise
  return disposePromise
}

function __publishWasiDispose(exports) {
  Object.defineProperty(exports, __wasiDisposeSymbol, {
    configurable: false,
    enumerable: false,
    value: __disposeWasiBinding,
    writable: false,
  })
}

function __finishWasiInitializationRollback(error, cleanupErrors) {
  let workerResult
  try {
    workerResult = __terminateWasiWorkers()
  } catch (cleanupError) {
    cleanupErrors.push(cleanupError)
    return __attachCleanupErrors(error, cleanupErrors)
  }
  if (__isThenable(workerResult)) {
    return Promise.resolve(workerResult)
      .catch((cleanupError) => {
        cleanupErrors.push(cleanupError)
      })
      .then(() => __attachCleanupErrors(error, cleanupErrors))
  }
  return __attachCleanupErrors(error, cleanupErrors)
}

function __rollbackWasiInitialization(error) {
  const cleanupErrors = []
  let destroyResult
  try {
    destroyResult = __destroyEmnapiContext()
  } catch (cleanupError) {
    cleanupErrors.push(cleanupError)
    return __finishWasiInitializationRollback(error, cleanupErrors)
  }
  if (__isThenable(destroyResult)) {
    return Promise.resolve(destroyResult)
      .catch((cleanupError) => {
        cleanupErrors.push(cleanupError)
      })
      .then(() =>
        __finishWasiInitializationRollback(error, cleanupErrors),
      )
  }
  return __finishWasiInitializationRollback(error, cleanupErrors)
}
`

export const createWasiBrowserBinding = (
  wasiFilename: string,
  initialMemory = 4000,
  maximumMemory = 65536,
  fs = false,
  asyncInit = false,
  buffer = false,
  errorEvent = false,
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

  return `import {
  createContext as __emnapiCreateContext,
  createOnMessage as __wasmCreateOnMessageForFsProxy,
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
    'Failed to fetch WASI module ' +
      __wasmUrl +
      ': ' +
      __wasmResponse.status +
      ' ' +
      (__wasmResponse.statusText || 'Unknown Status'),
  )
}
const __wasmFile = await __wasmResponse.arrayBuffer()

const __sharedMemory = new WebAssembly.Memory({
  initial: ${initialMemory},
  maximum: ${maximumMemory},
  shared: true,
})

let __emnapiContext
${emnapiContextLifecycle}
let __wasiModule
let __napiModule

try {
  __emnapiContext = __emnapiCreateContext({ autoDestroy: false })
  __emnapiContext.suppressDestroy()
  ${emnapiInjectBuffer}
  ;({
    instance: __napiInstance,
    module: __wasiModule,
    napiModule: __napiModule,
  } = ${emnapiInstantiateCall}(__wasmFile, {
    context: __emnapiContext,
    asyncWorkPoolSize: 4,
    wasi: __wasi,
    onCreateWorker() {
      const worker = new Worker(new URL('./wasi-worker-browser.mjs', import.meta.url), {
        type: 'module',
      })
      __wasiWorkers.add(worker)
${workerFsHandler}
${workerErrorHandler}
      return worker
    },
    overwriteImports(importObject) {
      importObject.env = {
        ...importObject.env,
        ...importObject.napi,
        ...importObject.emnapi,
        memory: __sharedMemory,
      }
      return importObject
    },
    beforeInit({ instance }) {
      __napiInstance = instance
      for (const name of Object.keys(instance.exports)) {
        if (name.startsWith('__napi_register__')) {
          instance.exports[name]()
        }
      }
    },
  }))
  __publishWasiDispose(__napiModule.exports)
} catch (error) {
  throw await __rollbackWasiInitialization(error)
}
`
}

export const createWasiBinding = (
  wasmFileName: string,
  packageName: string,
  initialMemory = 4000,
  maximumMemory = 65536,
) => `/* eslint-disable */
/* prettier-ignore */

/* auto-generated by NAPI-RS */

const __nodeFs = require('node:fs')
const __nodePath = require('node:path')
const { WASI: __nodeWASI } = require('node:wasi')
const { Worker } = require('node:worker_threads')

const {
  createContext: __emnapiCreateContext,
  createOnMessage: __wasmCreateOnMessageForFsProxy,
  instantiateNapiModuleSync: __emnapiInstantiateNapiModuleSync,
} = require('@napi-rs/wasm-runtime')

function __getWasiWorkerExecArgv() {
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

function __isInvalidWasiWorkerExecArgv(errorMessage, argument) {
  const __equalsIndex = argument.indexOf('=')
  const __argumentName =
    __equalsIndex === -1 ? argument : argument.slice(0, __equalsIndex)
  return (
    errorMessage.includes(': ' + __argumentName + ',') ||
    errorMessage.includes(': ' + __argumentName + '=') ||
    errorMessage.endsWith(': ' + __argumentName) ||
    errorMessage.includes(', ' + __argumentName + ',') ||
    errorMessage.includes(', ' + __argumentName + '=') ||
    errorMessage.endsWith(', ' + __argumentName)
  )
}

function __removeInvalidWasiWorkerExecArgv(execArgv, error) {
  if (typeof error.message !== 'string') {
    return
  }
  const __workerExecArgv = []
  let __removed = false
  for (let __index = 0; __index < execArgv.length; __index += 1) {
    const __arg = execArgv[__index]
    if (
      __arg.startsWith('-') &&
      __isInvalidWasiWorkerExecArgv(error.message, __arg)
    ) {
      __removed = true
      if (
        !__arg.includes('=') &&
        __index + 1 < execArgv.length &&
        !execArgv[__index + 1].startsWith('-')
      ) {
        __index += 1
      }
      continue
    }
    __workerExecArgv.push(__arg)
  }
  return __removed ? __workerExecArgv : undefined
}

function __createWasiWorker(filename) {
  let __workerExecArgv = __getWasiWorkerExecArgv()
  while (true) {
    try {
      return new Worker(filename, {
        env: process.env,
        execArgv: __workerExecArgv,
      })
    } catch (error) {
      if (!error || error.code !== 'ERR_WORKER_INVALID_EXEC_ARGV') {
        throw error
      }
      const __nextWorkerExecArgv =
        __removeInvalidWasiWorkerExecArgv(__workerExecArgv, error)
      if (!__nextWorkerExecArgv) {
        throw error
      }
      __workerExecArgv = __nextWorkerExecArgv
    }
  }
}

function __captureEmnapiAutoDestroyListener() {
  if (
    typeof process.prependListener !== 'function' ||
    typeof process.removeListener !== 'function'
  ) {
    return function() {}
  }
  let __autoDestroyListener
  const __captureListener = (event, listener) => {
    if (event === 'beforeExit' && __autoDestroyListener === undefined) {
      __autoDestroyListener = listener
    }
  }
  try {
    process.prependListener('newListener', __captureListener)
  } catch {
    return function() {}
  }
  return function() {
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

const __rootDir = __nodePath.parse(process.cwd()).root

const __wasi = new __nodeWASI({
  version: 'preview1',
  env: process.env,
  preopens: {
    [__rootDir]: __rootDir,
  }
})

const __sharedMemory = new WebAssembly.Memory({
  initial: ${initialMemory},
  maximum: ${maximumMemory},
  shared: true,
})

let __wasmFilePath = __nodePath.join(__dirname, '${wasmFileName}.wasm')
const __wasmDebugFilePath = __nodePath.join(__dirname, '${wasmFileName}.debug.wasm')

if (__nodeFs.existsSync(__wasmDebugFilePath)) {
  __wasmFilePath = __wasmDebugFilePath
} else if (!__nodeFs.existsSync(__wasmFilePath)) {
  try {
    __wasmFilePath = require.resolve('${packageName}-wasm32-wasi/${wasmFileName}.wasm')
  } catch {
    throw new Error('Cannot find ${wasmFileName}.wasm file, and ${packageName}-wasm32-wasi package is not installed.')
  }
}

const __wasmFile = __nodeFs.readFileSync(__wasmFilePath)
let __emnapiContext
${emnapiContextLifecycle}
let __wasiModule
let __napiModule
let __wasiExitListenerRegistered = false

function __removeWasiExitListener() {
  if (
    __wasiExitListenerRegistered &&
    typeof process.removeListener === 'function'
  ) {
    process.removeListener('exit', __disposeWasiBindingAtExit)
  }
  __wasiExitListenerRegistered = false
}

function __disposeWasiBindingAtExit() {
  __wasiExitListenerRegistered = false
  try {
    const result = __disposeWasiBinding()
    if (__isThenable(result)) {
      void Promise.resolve(result).catch(() => {})
    }
  } catch {}
}

function __registerWasiExitListener() {
  if (
    !__wasiExitListenerRegistered &&
    typeof process.once === 'function'
  ) {
    process.once('exit', __disposeWasiBindingAtExit)
    __wasiExitListenerRegistered = true
  }
}

__completeWasiDisposal = __removeWasiExitListener

try {
  const __finishAutoDestroyCapture = __captureEmnapiAutoDestroyListener()
  try {
    __emnapiContext = __emnapiCreateContext({ autoDestroy: false })
    __emnapiContext.suppressDestroy()
  } finally {
    __finishAutoDestroyCapture()
  }

  ;({
    instance: __napiInstance,
    module: __wasiModule,
    napiModule: __napiModule,
  } = __emnapiInstantiateNapiModuleSync(__wasmFile, {
    context: __emnapiContext,
    asyncWorkPoolSize: (function() {
      const threadsSizeFromEnv = Number(process.env.NAPI_RS_ASYNC_WORK_POOL_SIZE ?? process.env.UV_THREADPOOL_SIZE)
      // NaN > 0 is false
      if (threadsSizeFromEnv > 0) {
        return threadsSizeFromEnv
      } else {
        return 4
      }
    })(),
    reuseWorker: true,
    wasi: __wasi,
    onCreateWorker() {
      const worker = __createWasiWorker(__nodePath.join(__dirname, 'wasi-worker.mjs'))
      __wasiWorkers.add(worker)
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
    overwriteImports(importObject) {
      importObject.env = {
        ...importObject.env,
        ...importObject.napi,
        ...importObject.emnapi,
        memory: __sharedMemory,
      }
      return importObject
    },
    beforeInit({ instance }) {
      __napiInstance = instance
      for (const name of Object.keys(instance.exports)) {
        if (name.startsWith('__napi_register__')) {
          instance.exports[name]()
        }
      }
    },
  }))
  __publishWasiDispose(__napiModule.exports)
  __registerWasiExitListener()
} catch (error) {
  let rollbackResult
  try {
    rollbackResult = __rollbackWasiInitialization(error)
  } catch (cleanupError) {
    throw __attachCleanupErrors(error, [cleanupError])
  }
  if (__isThenable(rollbackResult)) {
    void Promise.resolve(rollbackResult).catch((cleanupError) => {
      __attachCleanupErrors(error, [cleanupError])
    })
    throw error
  }
  throw rollbackResult
}
`
