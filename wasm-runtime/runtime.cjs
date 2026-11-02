const ownCore = require('@emnapi/core')
// Single-threaded (non-shared-memory) WASI builds link an emnapi archive
// without the C async-work and threadsafe-function implementations (they are
// unconditional `napi_generic_failure` stubs without threads), so the
// generated loaders provide the JavaScript implementations through these
// plugins instead. Raw `instantiateNapiModule(Sync)` callers instantiating a
// single-threaded napi-rs wasm must pass them too:
// `plugins: [emnapiAsyncWorkPlugin, emnapiTSFNPlugin]` — without them
// instantiation fails with a LinkError naming the missing import. Threaded
// (shared-memory) builds link the C implementations and need no plugins;
// this mirrors the upstream @emnapi/core v2 plugin split (v1 bundled these
// implementations in the core runtime). The plugins are bundled into this
// package so loading the runtime with @emnapi/core v1 does not resolve the
// v2-only `@emnapi/core/plugins` package export. v1 ignores the plugins
// option. The bundled plugins come from one v2 release and depend on private
// core context fields; `emnapi-plugins.js` maps the 2.0.0-alpha context
// (`napiModule`) to the beta name (`addonModule`). When the core that runs
// the module is v2, `instantiateNapiModule(Sync)` below passes that core's
// own `@emnapi/core/plugins` in their place (see `pluginsOf`).
const {
  emnapiAsyncWorkPlugin,
  emnapiTSFNPlugin,
} = require('./dist/emnapi-plugins.cjs')
const ownRuntime = require('@emnapi/runtime')
const { WASI } = require('@tybys/wasm-util')

const { createFsProxy, createOnMessage } = require('./dist/fs-proxy.cjs')

// One emnapi copy is a pair: an `@emnapi/core` and the `@emnapi/runtime` of
// the same version, resolved from the same place. A core must only run with
// a context from its own pair's runtime. The two generations pass different
// shapes between them (v1 `createEnv` takes six positional arguments, v2 a
// bridge object) and nothing checks it: a v1 core with a v2 context fails
// with `this.bridge.setLastError is not a function`. Different v2
// prereleases are not compatible with each other either.
//
// A generated `*-wasm32-wasi` package pins both packages as its own
// dependencies, and its loader creates the context from its own
// `@emnapi/runtime`. This package's peers resolve from wherever this package
// is installed, so under npm hoisting they can be a different copy (a
// binding pinning 2.0.0-beta.2 next to an `@emnapi/core@1.11.3` at the root,
// say). So the CommonJS exports pick the pair per call:
//
// - With `options.context`, the pair whose runtime created the context. The
//   runtime copy is found in `require.cache` (`context instanceof Context`),
//   and its core is resolved from the module that required that runtime
//   copy, which is the binding's loader. A runtime directory is never used to
//   resolve the core: under pnpm, resolution from inside
//   `.pnpm/@emnapi+runtime@x` falls through to `.pnpm/node_modules`, which
//   can hold any version.
// - Without a context (`getDefaultContext`, `createContext`,
//   `MessageHandler`, a child thread without a context), the pair of the
//   package that is calling: the CommonJS module that is still loading and
//   required this file, or, in a worker thread, the worker's entry file. The
//   package must declare `@emnapi/core` and `@emnapi/runtime` itself, as
//   generated packages do.
//
// Anything else uses this package's own peers, as before. All of it reads
// only `require.cache` and the file system, so it works on every engine that
// runs the CommonJS entry, not only on V8.
const ownPair = {
  core: ownCore,
  runtime: ownRuntime,
  require,
  plugins: undefined,
}
const knownPairs = [ownPair]

let builtinsCache
function builtins() {
  if (builtinsCache === undefined) {
    builtinsCache = null
    try {
      // Through `getBuiltinModule` so browser bundlers that pick this entry
      // do not try to bundle these modules.
      const load =
        typeof process === 'object' &&
        process !== null &&
        typeof process.getBuiltinModule === 'function'
          ? (id) => process.getBuiltinModule(id)
          : (id) => module.require(id)
      const nodeModule = load('node:module')
      const fs = load('node:fs')
      const path = load('node:path')
      if (
        nodeModule &&
        typeof nodeModule.createRequire === 'function' &&
        fs &&
        path
      ) {
        builtinsCache = {
          createRequire: nodeModule.createRequire,
          fs,
          path,
          url: load('node:url'),
          workerThreads: load('node:worker_threads'),
        }
      }
    } catch {}
  }
  return builtinsCache
}

function cachedModules() {
  const cache = require.cache
  if (cache === null || typeof cache !== 'object') return []
  return Object.values(cache).filter(
    (entry) =>
      entry !== null &&
      typeof entry === 'object' &&
      typeof entry.filename === 'string',
  )
}

function realpath(b, file) {
  try {
    return b.fs.realpathSync(file)
  } catch {
    return file
  }
}

function isUnder(b, file, directory) {
  return file.startsWith(directory + b.path.sep)
}

// The nearest package.json that has a name, up to the enclosing
// `node_modules`.
const packages = new Map()
function packageOf(b, file) {
  let directory = b.path.dirname(file)
  const visited = []
  let found = null
  for (;;) {
    if (packages.has(directory)) {
      found = packages.get(directory)
      break
    }
    visited.push(directory)
    let manifest
    try {
      manifest = JSON.parse(
        b.fs.readFileSync(b.path.join(directory, 'package.json'), 'utf8'),
      )
    } catch {}
    if (
      manifest !== null &&
      typeof manifest === 'object' &&
      typeof manifest.name === 'string'
    ) {
      found = { directory, manifest }
      break
    }
    const parent = b.path.dirname(directory)
    if (parent === directory || b.path.basename(directory) === 'node_modules') {
      break
    }
    directory = parent
  }
  for (const each of visited) packages.set(each, found)
  return found
}

// Every package manager layout keeps the package in an `@emnapi/runtime`
// directory: npm and Yarn `node_modules/@emnapi/runtime`, pnpm
// `.pnpm/@emnapi+runtime@x/node_modules/@emnapi/runtime`, Yarn PnP
// `<zip>/node_modules/@emnapi/runtime`.
const EMNAPI_RUNTIME_PATH = /[\\/]@emnapi[\\/]runtime[\\/]/

function createdBy(context, runtime) {
  try {
    return (
      runtime !== null &&
      (typeof runtime === 'object' || typeof runtime === 'function') &&
      typeof runtime.Context === 'function' &&
      context instanceof runtime.Context
    )
  } catch {
    return false
  }
}

function generationOf(version) {
  const major = Number.parseInt(String(version), 10)
  return Number.isInteger(major) ? major : undefined
}

// v1 `Context#createEnv(filename, version, makeDynCall_vppp, makeDynCall_vp,
// abort, nodeBinding)`, v2 `createEnv(filename, version, bridge, nodeBinding)`.
function contextGeneration(context) {
  const createEnv = context !== null && context.createEnv
  if (typeof createEnv !== 'function') return undefined
  if (createEnv.length === 6) return 1
  if (createEnv.length === 4) return 2
  return undefined
}

function sameRuntime(a, b) {
  return a === b || (typeof a.Context === 'function' && a.Context === b.Context)
}

function internPair(candidate) {
  for (const pair of knownPairs) {
    if (
      pair.core === candidate.core &&
      sameRuntime(pair.runtime, candidate.runtime)
    ) {
      return pair
    }
  }
  const pair = { ...candidate, plugins: undefined }
  knownPairs.push(pair)
  return pair
}

// The pair that `anchor` resolves, when it is a usable one. `runtime`, when
// given, is the runtime copy the anchor must resolve to.
function resolvePair(b, anchor, runtime) {
  try {
    const anchorRequire = b.createRequire(anchor)
    const resolvedRuntime = anchorRequire('@emnapi/runtime')
    if (runtime !== undefined && !sameRuntime(resolvedRuntime, runtime)) {
      return undefined
    }
    const core = anchorRequire('@emnapi/core')
    if (
      typeof core.instantiateNapiModuleSync !== 'function' ||
      typeof core.instantiateNapiModule !== 'function' ||
      typeof core.MessageHandler !== 'function' ||
      typeof resolvedRuntime.createContext !== 'function' ||
      typeof resolvedRuntime.getDefaultContext !== 'function'
    ) {
      return undefined
    }
    return { core, runtime: resolvedRuntime, require: anchorRequire }
  } catch {
    return undefined
  }
}

// The pair whose runtime created `context`, or undefined when no runtime copy
// in `require.cache` did, or its core cannot be found.
function pairOfContext(context) {
  for (const pair of knownPairs) {
    // This package's own peers can themselves be two different versions
    // (npm checks only the peer ranges), so only a matched pair is final.
    if (
      createdBy(context, pair.runtime) &&
      pair.core.version === pair.runtime.version
    ) {
      return pair
    }
  }
  const b = builtins()
  if (b === null) return undefined
  const modules = cachedModules()
  for (const runtimeModule of modules) {
    // Check the path first: reading `exports.Context` of an unrelated module
    // can run its getters or proxy traps.
    if (!EMNAPI_RUNTIME_PATH.test(runtimeModule.filename)) continue
    if (!createdBy(context, runtimeModule.exports)) continue
    const runtimePackage = packageOf(b, runtimeModule.filename)
    if (
      runtimePackage === null ||
      runtimePackage.manifest.name !== '@emnapi/runtime'
    ) {
      continue
    }
    const runtimeDirectory = runtimePackage.directory
    const runtimeVersion = runtimePackage.manifest.version
    const runtime = runtimeModule.exports
    // The modules outside the runtime package that required it.
    for (const parent of modules) {
      if (
        !Array.isArray(parent.children) ||
        isUnder(b, parent.filename, runtimeDirectory) ||
        !parent.children.some(
          (child) =>
            child !== null &&
            typeof child === 'object' &&
            typeof child.filename === 'string' &&
            isUnder(b, child.filename, runtimeDirectory),
        )
      ) {
        continue
      }
      const candidate = resolvePair(b, parent.filename, runtime)
      // Only the exact version: different 2.0.0 prereleases are not
      // compatible with each other, and a mismatch can fail without an error.
      if (
        candidate !== undefined &&
        candidate.core.version === runtimeVersion
      ) {
        return internPair(candidate)
      }
    }
    // npm's nested layout: the core of the same version next to the runtime
    // (`<binding>/node_modules/@emnapi/{core,runtime}`). Only that exact
    // directory, never a resolution from inside the runtime package.
    const coreDirectory = b.path.join(b.path.dirname(runtimeDirectory), 'core')
    try {
      const manifest = JSON.parse(
        b.fs.readFileSync(b.path.join(coreDirectory, 'package.json'), 'utf8'),
      )
      if (
        manifest.name === '@emnapi/core' &&
        manifest.version === runtimeVersion
      ) {
        const anchor = b.path.join(coreDirectory, 'package.json')
        const coreRequire = b.createRequire(anchor)
        if (
          isUnder(
            b,
            realpath(b, coreRequire.resolve('@emnapi/core')),
            realpath(b, coreDirectory),
          )
        ) {
          const core = coreRequire('@emnapi/core')
          if (typeof core.instantiateNapiModuleSync === 'function') {
            return internPair({ core, runtime, require: coreRequire })
          }
        }
      }
    } catch {}
  }
  return undefined
}

function declaresOwnEmnapi(manifest) {
  const dependencies = manifest.dependencies
  return Boolean(
    dependencies !== null &&
    typeof dependencies === 'object' &&
    dependencies['@emnapi/core'] &&
    dependencies['@emnapi/runtime'],
  )
}

// The pair of the package that is calling, for calls without a context.
function pairOfCaller() {
  const b = builtins()
  if (b === null) return ownPair
  // A CommonJS loader calls these while it is still being evaluated, so it is
  // a module that required this file and has not finished loading.
  const files = []
  for (const entry of cachedModules()) {
    if (
      entry !== module &&
      entry.loaded === false &&
      Array.isArray(entry.children) &&
      entry.children.includes(module)
    ) {
      files.push(entry.filename)
    }
  }
  // A generated worker is an ES module that loads this file through
  // `createRequire`, which leaves no trace in `require.cache`. A worker
  // thread's entry file is its `process.argv[1]`.
  if (
    files.length === 0 &&
    b.workerThreads &&
    b.workerThreads.isMainThread === false &&
    typeof process.argv[1] === 'string'
  ) {
    let entry = process.argv[1]
    if (entry.startsWith('file:') && b.url) {
      try {
        entry = b.url.fileURLToPath(entry)
      } catch {}
    }
    files.push(entry)
  }
  let found
  for (const file of files) {
    if (!b.path.isAbsolute(file)) continue
    const filename = realpath(b, file)
    const callerPackage = packageOf(b, filename)
    if (callerPackage === null || !declaresOwnEmnapi(callerPackage.manifest)) {
      continue
    }
    const candidate = resolvePair(b, filename)
    if (
      candidate === undefined ||
      candidate.core.version !== candidate.runtime.version
    ) {
      continue
    }
    if (found === undefined) {
      found = candidate
    } else if (
      found.core !== candidate.core ||
      !sameRuntime(found.runtime, candidate.runtime)
    ) {
      // Two loading packages with different copies: no single caller.
      return ownPair
    }
  }
  return found === undefined ? ownPair : internPair(found)
}

// The plugins of the core that runs the module. v1 has none (it implements
// async work and TSFN itself and ignores the option). A v2 core whose own
// plugins cannot be loaded keeps the bundled ones.
function pluginsOf(pair) {
  if (pair.plugins === undefined) {
    pair.plugins = null
    if ((generationOf(pair.core.version) ?? 0) >= 2) {
      try {
        const b = builtins()
        if (b !== null) {
          // Only the plugins of this very core package.
          const corePackage = packageOf(
            b,
            realpath(b, pair.require.resolve('@emnapi/core')),
          )
          const pluginsPackage = packageOf(
            b,
            realpath(b, pair.require.resolve('@emnapi/core/plugins')),
          )
          if (
            corePackage === null ||
            pluginsPackage === null ||
            corePackage.directory !== pluginsPackage.directory
          ) {
            return null
          }
        }
        const plugins = pair.require('@emnapi/core/plugins')
        if (
          typeof plugins.asyncWork === 'function' &&
          typeof plugins.tsfn === 'function'
        ) {
          pair.plugins = plugins
        }
      } catch {}
    }
  }
  return pair.plugins
}

// The caller's options with only `plugins` replaced. emnapi reads these
// options by property access, so a proxy keeps every other property as it was:
// own, inherited, non-enumerable and accessor properties alike. A copy would
// drop all but the own enumerable ones. Getters run on the original object.
function withPlugins(options, plugins) {
  const own = Object.getOwnPropertyDescriptor(options, 'plugins')
  if (
    own !== undefined &&
    own.configurable === false &&
    ('value' in own ? own.writable === false : own.get === undefined)
  ) {
    // A proxy may not report another value for this property.
    return options
  }
  return new Proxy(options, {
    get(target, key) {
      return key === 'plugins' ? plugins : Reflect.get(target, key)
    },
  })
}

function prepare(options) {
  const context = options != null ? options.context : undefined
  let pair
  if (context !== null && typeof context === 'object') {
    pair = pairOfContext(context) ?? ownPair
  } else {
    pair = pairOfCaller()
  }

  const coreGeneration = generationOf(pair.core.version)
  const ctxGeneration =
    context !== null && typeof context === 'object'
      ? contextGeneration(context)
      : undefined
  if (
    coreGeneration !== undefined &&
    ctxGeneration !== undefined &&
    coreGeneration !== ctxGeneration
  ) {
    throw new TypeError(
      `@napi-rs/wasm-runtime: the emnapi context was created by @emnapi/runtime v${ctxGeneration}, ` +
        `but @emnapi/core ${pair.core.version} would load the module. ` +
        `@emnapi/core and @emnapi/runtime must be the same copy; ` +
        `this usually means a package manager installed this package's @emnapi/core peer ` +
        `separately from the binding's own emnapi dependencies.`,
    )
  }

  if (options != null && Array.isArray(options.plugins)) {
    const own = pluginsOf(pair)
    if (own !== null) {
      let changed = false
      const plugins = options.plugins.map((plugin) => {
        if (plugin === emnapiAsyncWorkPlugin) {
          changed = true
          return own.asyncWork
        }
        if (plugin === emnapiTSFNPlugin) {
          changed = true
          return own.tsfn
        }
        return plugin
      })
      if (changed) {
        options = withPlugins(options, plugins)
      }
    }
  }
  return { core: pair.core, options }
}

function instantiateNapiModuleSync(wasmInput, options) {
  const prepared = prepare(options)
  return prepared.core.instantiateNapiModuleSync(wasmInput, prepared.options)
}

function instantiateNapiModule(wasmInput, options) {
  let prepared
  try {
    prepared = prepare(options)
  } catch (error) {
    return Promise.reject(error)
  }
  return prepared.core.instantiateNapiModule(wasmInput, prepared.options)
}

function createContext(...args) {
  return pairOfCaller().runtime.createContext(...args)
}

function getDefaultContext(...args) {
  return pairOfCaller().runtime.getDefaultContext(...args)
}

// A worker builds its MessageHandler before it instantiates, so the handler
// comes from the caller's pair too. Statics, the prototype and subclasses
// stay this package's peer class.
const MessageHandler = new Proxy(ownCore.MessageHandler, {
  construct(target, args, newTarget) {
    if (newTarget !== MessageHandler) {
      return Reflect.construct(target, args, newTarget)
    }
    const Handler = pairOfCaller().core.MessageHandler
    return Reflect.construct(Handler, args, Handler)
  },
})

module.exports = {
  MessageHandler,
  createContext,
  emnapiAsyncWorkPlugin,
  emnapiTSFNPlugin,
  instantiateNapiModule,
  instantiateNapiModuleSync,
  getDefaultContext,
  WASI,
  createFsProxy,
  createOnMessage,
}
