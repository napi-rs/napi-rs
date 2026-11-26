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
const { createPairedRuntime } = require('./dist/emnapi-pairing.cjs')
const {
  emnapiAsyncWorkPlugin,
  emnapiTSFNPlugin,
} = require('./dist/emnapi-plugins.cjs')
const ownRuntime = require('@emnapi/runtime')
const { WASI } = require('@tybys/wasm-util')

const { createFsProxy, createOnMessage } = require('./dist/fs-proxy.cjs')

let builtinsCache
function getBuiltins() {
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

const {
  MessageHandler,
  createContext,
  getDefaultContext,
  instantiateNapiModule,
  instantiateNapiModuleSync,
} = createPairedRuntime({
  ownCore,
  ownRuntime,
  ownRequire: require,
  ownModule: module,
  getBuiltins,
  emnapiAsyncWorkPlugin,
  emnapiTSFNPlugin,
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
