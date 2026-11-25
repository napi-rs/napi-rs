import runtime from './runtime.cjs'

export const {
  MessageHandler,
  createContext,
  createFsProxy,
  createOnMessage,
  emnapiAsyncWorkPlugin,
  emnapiTSFNPlugin,
  getDefaultContext,
  instantiateNapiModule,
  instantiateNapiModuleSync,
} = runtime
export * from '@tybys/wasm-util'
