const { MessageHandler, instantiateNapiModuleSync, instantiateNapiModule } = require('@emnapi/core')
const { getDefaultContext } = require('@emnapi/runtime')
const { WASI } = require('@tybys/wasm-util')

module.exports = {
  MessageHandler,
  instantiateNapiModule,
  instantiateNapiModuleSync,
  getDefaultContext,
  WASI,
}
