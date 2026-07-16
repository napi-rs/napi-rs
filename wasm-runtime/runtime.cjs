const {
  MessageHandler,
  instantiateNapiModuleSync,
  instantiateNapiModule,
} = require('@emnapi/core')
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
// implementations in the core runtime).
const {
  asyncWork: emnapiAsyncWorkPlugin,
  tsfn: emnapiTSFNPlugin,
} = require('@emnapi/core/plugins')
const { createContext, getDefaultContext } = require('@emnapi/runtime')
const { WASI } = require('@tybys/wasm-util')

const { createFsProxy, createOnMessage } = require('./dist/fs-proxy.cjs')

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
