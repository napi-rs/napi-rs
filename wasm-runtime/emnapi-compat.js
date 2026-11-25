// Fallback shim for `emnapi_create_arraybuffer_copy` when running a wasm addon
// built against newer napi-rs on an older `@emnapi/core` (< 2.0.0-beta.4,
// including 1.x and 2.0.0-beta.2/beta.3) that does not export it natively.
//
// When `@emnapi/core >= 2.0.0-beta.4` already provides
// `importObject.emnapi.emnapi_create_arraybuffer_copy`, this wrapper leaves it
// untouched. Otherwise it installs a shim implemented via
// `napi_create_arraybuffer` + `emnapi_sync_memory` before the caller's
// `overwriteImports` runs, so loaders that spread `...importObject.emnapi`
// into `importObject.env` pick it up automatically.

function canOverrideProperty(target, key) {
  const own = Object.getOwnPropertyDescriptor(target, key)
  if (own === undefined) {
    return true
  }
  return !(
    own.configurable === false &&
    ('value' in own ? own.writable === false : own.get === undefined)
  )
}

function createArrayBufferCopyShim(
  napiCreateArrayBuffer,
  emnapiSyncMemory,
  getInstance,
  getImportedMemory,
  getResolvedMemory,
) {
  return function emnapi_create_arraybuffer_copy(
    env,
    data,
    byteLength,
    result,
  ) {
    if (!env) {
      return 1 // napi_invalid_arg
    }
    data >>>= 0
    byteLength >>>= 0
    result >>>= 0
    if (!result) {
      return napiCreateArrayBuffer(env, 0, 0, 0)
    }
    if (byteLength === 0) {
      return napiCreateArrayBuffer(env, 0, 0, result)
    }
    if (!data) {
      return emnapiSyncMemory(env, 0, 0, 0, 0)
    }
    const instance = getInstance()
    const exports = instance && instance.exports
    const memory =
      getResolvedMemory() || (exports && exports.memory) || getImportedMemory()
    if (!memory || data + byteLength > memory.buffer.byteLength) {
      return 1 // napi_invalid_arg
    }
    const malloc = (exports && (exports.malloc || exports._malloc)) || undefined
    const free = (exports && (exports.free || exports._free)) || undefined
    if (typeof malloc !== 'function' || typeof free !== 'function') {
      return 9 // napi_generic_failure
    }
    const dataOutPtr = malloc(4) >>> 0
    if (!dataOutPtr) {
      return 9 // napi_generic_failure
    }
    try {
      const status = napiCreateArrayBuffer(env, byteLength, dataOutPtr, result)
      if (status !== 0) {
        return status
      }
      const dstPtr = new DataView(memory.buffer).getUint32(dataOutPtr, true)
      if (!dstPtr) {
        return 9 // napi_generic_failure
      }
      new Uint8Array(memory.buffer).copyWithin(dstPtr, data, data + byteLength)
      return emnapiSyncMemory(env, 0, result, 0, byteLength)
    } finally {
      free(dataOutPtr)
    }
  }
}

export function prepareInstantiateOptions(options, overridePlugins) {
  let wasmInstance
  let importedMemory
  let resolvedMemory
  const getInstance = () => wasmInstance
  const getImportedMemory = () => importedMemory
  const getResolvedMemory = () => resolvedMemory

  const captureResult = (result) => {
    if (wasmInstance === undefined && result && result.instance) {
      wasmInstance = result.instance
    }
  }

  const wrapGetMemory = (userGetMemory, receiver) =>
    function getMemory() {
      const memory = Reflect.apply(userGetMemory, receiver, arguments)
      if (resolvedMemory === undefined && memory !== undefined) {
        resolvedMemory = memory
      }
      return memory
    }

  const wrapOverwriteImports = (userOverwriteImports, receiver) =>
    function overwriteImports(importObject) {
      let fallbackFn
      let inputImportObject = importObject
      if (
        importObject != null &&
        typeof importObject === 'object' &&
        importObject.emnapi != null &&
        typeof importObject.emnapi === 'object' &&
        typeof importObject.emnapi.emnapi_create_arraybuffer_copy !==
          'function' &&
        importObject.napi != null &&
        typeof importObject.napi === 'object' &&
        typeof importObject.napi.napi_create_arraybuffer === 'function' &&
        typeof importObject.emnapi.emnapi_sync_memory === 'function'
      ) {
        fallbackFn = createArrayBufferCopyShim(
          importObject.napi.napi_create_arraybuffer,
          importObject.emnapi.emnapi_sync_memory,
          getInstance,
          getImportedMemory,
          getResolvedMemory,
        )
        if (Object.isExtensible(importObject.emnapi)) {
          importObject.emnapi.emnapi_create_arraybuffer_copy = fallbackFn
        } else {
          inputImportObject = Object.assign(
            Object.create(Object.getPrototypeOf(importObject)),
            importObject,
            {
              emnapi: Object.assign(
                Object.create(Object.getPrototypeOf(importObject.emnapi)),
                importObject.emnapi,
                { emnapi_create_arraybuffer_copy: fallbackFn },
              ),
            },
          )
        }
      }

      const returned =
        typeof userOverwriteImports === 'function'
          ? Reflect.apply(userOverwriteImports, receiver, [inputImportObject])
          : undefined
      const finalImportObject =
        typeof returned === 'object' && returned !== null
          ? returned
          : inputImportObject

      let outputImportObject =
        typeof userOverwriteImports === 'function'
          ? returned
          : finalImportObject

      if (finalImportObject != null && typeof finalImportObject === 'object') {
        const env = finalImportObject.env
        if (env != null && typeof env === 'object') {
          if (env.memory !== undefined) {
            importedMemory = env.memory
          }
          if (
            fallbackFn !== undefined &&
            typeof env.emnapi_create_arraybuffer_copy !== 'function' &&
            (typeof env.emnapi_sync_memory === 'function' ||
              typeof env.napi_create_arraybuffer === 'function')
          ) {
            // Never mutate a caller-owned or frozen `env` / `importObject` in
            // place; return a shallow clone with the fallback installed.
            const nextEnv = Object.assign(
              Object.create(Object.getPrototypeOf(env)),
              env,
              { emnapi_create_arraybuffer_copy: fallbackFn },
            )
            outputImportObject = Object.assign(
              Object.create(Object.getPrototypeOf(finalImportObject)),
              finalImportObject,
              { env: nextEnv },
            )
          }
        }
      }
      if (
        importedMemory === undefined &&
        inputImportObject != null &&
        typeof inputImportObject === 'object' &&
        inputImportObject.env != null &&
        typeof inputImportObject.env === 'object'
      ) {
        importedMemory = inputImportObject.env.memory
      }

      return outputImportObject
    }

  const wrapBeforeInit = (userBeforeInit, receiver) =>
    function beforeInit(info) {
      if (info && info.instance) {
        wasmInstance = info.instance
      }
      if (typeof userBeforeInit === 'function') {
        return Reflect.apply(userBeforeInit, receiver, arguments)
      }
    }

  if (options == null || typeof options !== 'object') {
    const wrappedOptions =
      options === undefined
        ? {
            overwriteImports: wrapOverwriteImports(undefined, undefined),
            beforeInit: wrapBeforeInit(undefined, undefined),
          }
        : options
    return { options: wrappedOptions, captureResult }
  }

  const canOverridePlugins =
    overridePlugins !== undefined && canOverrideProperty(options, 'plugins')
  const canOverrideOverwriteImports = canOverrideProperty(
    options,
    'overwriteImports',
  )
  const canOverrideBeforeInit = canOverrideProperty(options, 'beforeInit')
  const canOverrideGetMemory = canOverrideProperty(options, 'getMemory')

  if (
    !canOverridePlugins &&
    !canOverrideOverwriteImports &&
    !canOverrideBeforeInit &&
    !canOverrideGetMemory
  ) {
    return { options, captureResult }
  }

  const wrappedOptions = new Proxy(options, {
    get(target, key) {
      if (key === 'plugins' && canOverridePlugins) {
        return overridePlugins
      }
      if (key === 'overwriteImports' && canOverrideOverwriteImports) {
        const original = Reflect.get(target, key)
        if (original != null && typeof original !== 'function') {
          return original
        }
        return wrapOverwriteImports(original, target)
      }
      if (key === 'beforeInit' && canOverrideBeforeInit) {
        const original = Reflect.get(target, key)
        if (original != null && typeof original !== 'function') {
          return original
        }
        return wrapBeforeInit(original, target)
      }
      if (key === 'getMemory' && canOverrideGetMemory) {
        const original = Reflect.get(target, key)
        if (typeof original !== 'function') {
          return original
        }
        return wrapGetMemory(original, target)
      }
      return Reflect.get(target, key)
    },
  })

  return { options: wrappedOptions, captureResult }
}
