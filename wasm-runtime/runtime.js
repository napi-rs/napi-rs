export {
  instantiateNapiModuleSync,
  instantiateNapiModule,
  MessageHandler,
} from '@emnapi/core'
export { getDefaultContext } from '@emnapi/runtime'
export { WASI } from '@tybys/wasm-util'
export { createOnMessage, createFsProxy } from './fs-proxy.cjs'
