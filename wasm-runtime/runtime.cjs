const {
  MessageHandler,
  instantiateNapiModuleSync,
  instantiateNapiModule,
} = require('@emnapi/core')
// Single-threaded (non-shared-memory) WASI builds link an emnapi archive
// without the C async-work and threadsafe-function implementations (they are
// unconditional `napi_generic_failure` stubs without threads), so the
// generated loaders provide the JavaScript implementations through these
// plugins instead.
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
