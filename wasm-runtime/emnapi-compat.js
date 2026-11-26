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

function getDescriptorInChain(target, key) {
  let current = target
  while (current != null) {
    const desc = Reflect.getOwnPropertyDescriptor(current, key)
    if (desc !== undefined) {
      return desc
    }
    current = Reflect.getPrototypeOf(current)
  }
  return undefined
}

function setPreservingOwnKind(target, key, value, overrides, pinned) {
  const ownDesc = Reflect.getOwnPropertyDescriptor(target, key)
  if (ownDesc !== undefined) {
    overrides[key] = {
      value,
      enumerable: Boolean(ownDesc.enumerable),
    }
  } else {
    const inheritedDesc = getDescriptorInChain(
      Reflect.getPrototypeOf(target),
      key,
    )
    pinned[key] = {
      value,
      enumerable:
        inheritedDesc !== undefined ? Boolean(inheritedDesc.enumerable) : false,
    }
  }
}

// Shallowly clones `target` into a real JS object (so callers can freely call
// `Object.freeze`, `Object.seal`, or `Object.defineProperty(..., { configurable: false })`
// without tripping Proxy invariants) while keeping both own AND inherited
// prototype accessors bound to `target` as receiver and preserving own-key
// enumeration.
function cloneWithProperties(target, overrides, pinned) {
  const ownDescriptors = Object.getOwnPropertyDescriptors(target)
  const seenProps = new Set(Reflect.ownKeys(ownDescriptors))

  for (const ownKey of seenProps) {
    const desc = ownDescriptors[ownKey]
    if (desc && ('get' in desc || 'set' in desc)) {
      ownDescriptors[ownKey] = {
        get:
          typeof desc.get === 'function'
            ? () => Reflect.get(target, ownKey, target)
            : undefined,
        set:
          typeof desc.set === 'function'
            ? (next) => {
                Reflect.set(target, ownKey, next, target)
              }
            : undefined,
        enumerable: desc.enumerable,
        configurable: true,
      }
    } else if (desc) {
      // Forward reads through `Reflect.get(target, ownKey, target)` so a
      // Proxy-backed table exposing an own placeholder key still supplies its
      // `get`-trap value (e.g. when spread into `env`), while local writes stay
      // on the clone without mutating `target`.
      ownDescriptors[ownKey] = {
        get: () => Reflect.get(target, ownKey, target),
        set: desc.writable
          ? function (next) {
              Object.defineProperty(this, ownKey, {
                value: next,
                writable: true,
                enumerable: desc.enumerable,
                configurable: true,
              })
            }
          : undefined,
        enumerable: desc.enumerable,
        configurable: true,
      }
    }
  }

  if (overrides != null) {
    for (const key of Reflect.ownKeys(overrides)) {
      const entry = overrides[key]
      ownDescriptors[key] = {
        value: entry.value,
        writable: true,
        enumerable: entry.enumerable !== false,
        configurable: true,
      }
      seenProps.add(key)
    }
  }

  const proto = Object.getPrototypeOf(target)
  const protoDescriptors = Object.create(null)
  let hasProtoOverrides = false

  if (pinned != null) {
    for (const key of Reflect.ownKeys(pinned)) {
      const entry = pinned[key]
      protoDescriptors[key] = {
        value: entry.value,
        writable: true,
        enumerable: Boolean(entry.enumerable),
        configurable: true,
      }
      seenProps.add(key)
      hasProtoOverrides = true
    }
  }

  if (proto !== null && proto !== Object.prototype) {
    for (
      let cur = proto;
      cur !== null && cur !== Object.prototype;
      cur = Object.getPrototypeOf(cur)
    ) {
      const curDescriptors = Object.getOwnPropertyDescriptors(cur)
      for (const key of Reflect.ownKeys(curDescriptors)) {
        if (seenProps.has(key)) {
          continue
        }
        seenProps.add(key)
        const desc = curDescriptors[key]
        if (
          desc &&
          (typeof desc.get === 'function' || typeof desc.set === 'function')
        ) {
          protoDescriptors[key] = {
            get:
              typeof desc.get === 'function'
                ? () => Reflect.get(target, key, target)
                : undefined,
            set:
              typeof desc.set === 'function'
                ? (next) => {
                    Reflect.set(target, key, next, target)
                  }
                : undefined,
            enumerable: desc.enumerable,
            configurable: true,
          }
          hasProtoOverrides = true
        }
      }
    }
  }

  // Inherit from `target` (rather than only `proto`) so read-through Proxy
  // `get` traps on `target` (e.g. a plugin's Proxy-backed `emnapi` table)
  // still resolve virtual properties while `clone` remains a real plain JS
  // object that supports `Object.freeze` and non-configurable definitions.
  const cloneProto = hasProtoOverrides
    ? Object.create(target, protoDescriptors)
    : target
  return Object.create(cloneProto, ownDescriptors)
}

// Lightweight shadow-target read-through overlay for post-hook `finalEnv` /
// `finalImportObject` returned exclusively to `@emnapi/core` and
// `WebAssembly.instantiate`. Unlike `cloneWithProperties`, this preserves
// Proxy-backed `env` / `importObject` `get` traps while overriding only the
// specific fallback/memory slots without mutating `target`.
function createOverlayProxy(target, overrides, pinned) {
  const ownOverrides = Object.create(null)
  if (overrides != null) {
    for (const key of Reflect.ownKeys(overrides)) {
      const entry = overrides[key]
      ownOverrides[key] = {
        value: entry.value,
        writable: true,
        enumerable: entry.enumerable !== false,
        configurable: true,
      }
    }
  }
  const pinnedValues = Object.create(null)
  if (pinned != null) {
    for (const key of Reflect.ownKeys(pinned)) {
      pinnedValues[key] = pinned[key].value
    }
  }

  return new Proxy(
    {},
    {
      get(_shadow, key) {
        if (Object.prototype.hasOwnProperty.call(ownOverrides, key)) {
          return ownOverrides[key].value
        }
        if (Object.prototype.hasOwnProperty.call(pinnedValues, key)) {
          return pinnedValues[key]
        }
        return Reflect.get(target, key, target)
      },
      has(_shadow, key) {
        if (
          Object.prototype.hasOwnProperty.call(ownOverrides, key) ||
          Object.prototype.hasOwnProperty.call(pinnedValues, key)
        ) {
          return true
        }
        return Reflect.has(target, key)
      },
      ownKeys() {
        const keys = Reflect.ownKeys(target)
        const seen = new Set(keys)
        for (const key of Reflect.ownKeys(ownOverrides)) {
          if (!seen.has(key)) {
            seen.add(key)
            keys.push(key)
          }
        }
        return keys
      },
      getOwnPropertyDescriptor(_shadow, key) {
        if (Object.prototype.hasOwnProperty.call(ownOverrides, key)) {
          return { ...ownOverrides[key] }
        }
        const desc = Reflect.getOwnPropertyDescriptor(target, key)
        if (desc === undefined) {
          return undefined
        }
        if ('get' in desc || 'set' in desc) {
          return {
            get:
              typeof desc.get === 'function'
                ? () => Reflect.apply(desc.get, target, [])
                : undefined,
            set:
              typeof desc.set === 'function'
                ? (next) => Reflect.apply(desc.set, target, [next])
                : undefined,
            enumerable: desc.enumerable,
            configurable: true,
          }
        }
        return { ...desc, configurable: true }
      },
      getPrototypeOf() {
        return Reflect.getPrototypeOf(target)
      },
      set(_shadow, key, value) {
        if (Object.prototype.hasOwnProperty.call(ownOverrides, key)) {
          ownOverrides[key].value = value
          return true
        }
        if (Object.prototype.hasOwnProperty.call(pinnedValues, key)) {
          pinnedValues[key] = value
          return true
        }
        return Reflect.set(target, key, value, target)
      },
    },
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
      if (importObject != null && typeof importObject === 'object') {
        const emnapi = Reflect.get(importObject, 'emnapi', importObject)
        const napi = Reflect.get(importObject, 'napi', importObject)
        if (
          emnapi != null &&
          typeof emnapi === 'object' &&
          typeof Reflect.get(
            emnapi,
            'emnapi_create_arraybuffer_copy',
            emnapi,
          ) !== 'function' &&
          napi != null &&
          typeof napi === 'object'
        ) {
          const napiCreateArrayBuffer = Reflect.get(
            napi,
            'napi_create_arraybuffer',
            napi,
          )
          const emnapiSyncMemory = Reflect.get(
            emnapi,
            'emnapi_sync_memory',
            emnapi,
          )
          if (
            typeof napiCreateArrayBuffer === 'function' &&
            typeof emnapiSyncMemory === 'function'
          ) {
            fallbackFn = createArrayBufferCopyShim(
              napiCreateArrayBuffer,
              emnapiSyncMemory,
              getInstance,
              getImportedMemory,
              getResolvedMemory,
            )
            // Always install the instance-bound shim on an instantiation-local
            // clone so a reused or sealed/inherited-readonly `importObject.emnapi`
            // table is never mutated across loads or blocked by prototype slots.
            const nextEmnapi = cloneWithProperties(emnapi, {
              emnapi_create_arraybuffer_copy: {
                value: fallbackFn,
                enumerable: true,
              },
            })
            const importOverrides = Object.create(null)
            const importPinned = Object.create(null)
            setPreservingOwnKind(
              importObject,
              'emnapi',
              nextEmnapi,
              importOverrides,
              importPinned,
            )
            inputImportObject = cloneWithProperties(
              importObject,
              importOverrides,
              importPinned,
            )
          }
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
        typeof userOverwriteImports === 'function' &&
        inputImportObject === importObject
          ? returned
          : finalImportObject

      if (fallbackFn !== undefined) {
        let finalEnv
        if (
          finalImportObject != null &&
          typeof finalImportObject === 'object'
        ) {
          finalEnv = Reflect.get(finalImportObject, 'env', finalImportObject)
          if (finalEnv != null && typeof finalEnv === 'object') {
            const existingCopy = Reflect.get(
              finalEnv,
              'emnapi_create_arraybuffer_copy',
              finalEnv,
            )
            const needsEnvFallback =
              typeof existingCopy !== 'function' &&
              (typeof Reflect.get(finalEnv, 'emnapi_sync_memory', finalEnv) ===
                'function' ||
                typeof Reflect.get(
                  finalEnv,
                  'napi_create_arraybuffer',
                  finalEnv,
                ) === 'function')
            const envMemory = Reflect.get(finalEnv, 'memory', finalEnv)
            if (envMemory !== undefined) {
              importedMemory = envMemory
            }
            if (envMemory !== undefined || needsEnvFallback) {
              // Pin resolved `env.memory` from the single read above so
              // WebAssembly instantiation, `@emnapi/core`, and our shim
              // (including any caller wrapper delegating to it) observe the
              // exact same memory without invoking a getter twice, while
              // leaving unresolved `undefined` memory placeholders live and
              // keeping any Proxy `get` traps on `finalEnv` / `finalImportObject`
              // intact without mutating caller-owned objects in place.
              const envOverrides = Object.create(null)
              const envPinned = Object.create(null)
              if (envMemory !== undefined) {
                setPreservingOwnKind(
                  finalEnv,
                  'memory',
                  envMemory,
                  envOverrides,
                  envPinned,
                )
              }
              if (needsEnvFallback) {
                envOverrides.emnapi_create_arraybuffer_copy = {
                  value: fallbackFn,
                  enumerable: true,
                }
              }
              const nextEnv = createOverlayProxy(
                finalEnv,
                envOverrides,
                envPinned,
              )
              const outOverrides = Object.create(null)
              const outPinned = Object.create(null)
              setPreservingOwnKind(
                finalImportObject,
                'env',
                nextEnv,
                outOverrides,
                outPinned,
              )
              outputImportObject = createOverlayProxy(
                finalImportObject,
                outOverrides,
                outPinned,
              )
            }
          }
        }
        if (
          importedMemory === undefined &&
          inputImportObject != null &&
          typeof inputImportObject === 'object' &&
          inputImportObject !== finalImportObject
        ) {
          const inputEnv = Reflect.get(
            inputImportObject,
            'env',
            inputImportObject,
          )
          if (
            inputEnv != null &&
            typeof inputEnv === 'object' &&
            inputEnv !== finalEnv
          ) {
            const inputMemory = Reflect.get(inputEnv, 'memory', inputEnv)
            if (inputMemory !== undefined) {
              importedMemory = inputMemory
            }
          }
        }
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

  const getIntercepted = (key) => {
    if (key === 'plugins' && overridePlugins !== undefined) {
      return overridePlugins
    }
    if (key === 'overwriteImports') {
      const original = Reflect.get(options, key, options)
      if (original != null && typeof original !== 'function') {
        return original
      }
      return wrapOverwriteImports(original, options)
    }
    if (key === 'beforeInit') {
      const original = Reflect.get(options, key, options)
      if (original != null && typeof original !== 'function') {
        return original
      }
      return wrapBeforeInit(original, options)
    }
    if (key === 'getMemory') {
      const original = Reflect.get(options, key, options)
      if (typeof original !== 'function') {
        return original
      }
      return wrapGetMemory(original, options)
    }
    return Reflect.get(options, key, options)
  }

  // Always use an extensible shadow target so frozen options, non-configurable
  // hooks, or getters that freeze `this` during instantiation never trip Proxy
  // invariants, while forwarding `this` binding, private-field getters,
  // non-enumerable properties, and prototype lookups to `options`.
  const wrappedOptions = new Proxy(
    {},
    {
      get(_target, key) {
        return getIntercepted(key)
      },
      has(_target, key) {
        return Reflect.has(options, key)
      },
      ownKeys() {
        return Reflect.ownKeys(options)
      },
      getOwnPropertyDescriptor(_target, key) {
        const desc = Reflect.getOwnPropertyDescriptor(options, key)
        if (desc === undefined) {
          return undefined
        }
        if (key === 'plugins' && overridePlugins !== undefined) {
          return {
            value: overridePlugins,
            writable: true,
            enumerable: desc.enumerable,
            configurable: true,
          }
        }
        if (
          key === 'overwriteImports' ||
          key === 'beforeInit' ||
          key === 'getMemory'
        ) {
          if ('get' in desc || 'set' in desc) {
            return {
              get() {
                return getIntercepted(key)
              },
              set:
                typeof desc.set === 'function'
                  ? (value) => Reflect.set(options, key, value, options)
                  : undefined,
              enumerable: desc.enumerable,
              configurable: true,
            }
          }
          return {
            value: getIntercepted(key),
            writable: true,
            enumerable: desc.enumerable,
            configurable: true,
          }
        }
        return { ...desc, configurable: true }
      },
      getPrototypeOf() {
        return Reflect.getPrototypeOf(options)
      },
      set(_target, key, value) {
        return Reflect.set(options, key, value, options)
      },
    },
  )

  return { options: wrappedOptions, captureResult }
}
