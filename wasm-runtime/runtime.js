import * as emnapiCore from '@emnapi/core'
import * as emnapiRuntime from '@emnapi/runtime'

import {
  emnapiAsyncWorkPlugin,
  emnapiTSFNPlugin,
} from './dist/emnapi-plugins.js'

const { instantiateNapiModuleSync, instantiateNapiModule, MessageHandler } =
  emnapiCore
const { createContext, getDefaultContext } = emnapiRuntime

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
// v2-only `@emnapi/core/plugins` package export.
export {
  MessageHandler,
  createContext,
  emnapiAsyncWorkPlugin,
  emnapiTSFNPlugin,
  getDefaultContext,
  instantiateNapiModule,
  instantiateNapiModuleSync,
}
export * from '@tybys/wasm-util'
export { createOnMessage, createFsProxy } from './fs-proxy.js'
