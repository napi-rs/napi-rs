const {
  MessageHandler,
  instantiateNapiModuleSync,
  instantiateNapiModule,
} = require('@emnapi/core')
const { createContext, getDefaultContext } = require('@emnapi/runtime')
const { WASI } = require('@tybys/wasm-util')

const { createFsProxy, createOnMessage } = require('./dist/fs-proxy.cjs')

module.exports = {
  MessageHandler,
  createContext,
  instantiateNapiModule,
  instantiateNapiModuleSync,
  getDefaultContext,
  WASI,
  createFsProxy,
  createOnMessage,
}
