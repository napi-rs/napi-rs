export {
  instantiateNapiModuleSync,
  instantiateNapiModule,
  MessageHandler,
} from '@emnapi/core'
// Single-threaded (non-shared-memory) WASI builds link an emnapi archive
// without the C async-work and threadsafe-function implementations (they are
// unconditional `napi_generic_failure` stubs without threads), so the
// generated loaders provide the JavaScript implementations through these
// plugins instead.
export {
  asyncWork as emnapiAsyncWorkPlugin,
  tsfn as emnapiTSFNPlugin,
} from '@emnapi/core/plugins'
export { createContext, getDefaultContext } from '@emnapi/runtime'
export * from '@tybys/wasm-util'
export { createOnMessage, createFsProxy } from './fs-proxy.js'
