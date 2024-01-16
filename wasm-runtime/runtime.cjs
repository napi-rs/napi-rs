const { MessageHandler, instantiateNapiModuleSync } = require('@emnapi/core')
const { getDefaultContext } = require('@emnapi/runtime')
const { WASI } = require('@tybys/wasm-util')

module.exports = {
  MessageHandler,
  instantiateNapiModuleSync,
  getDefaultContext,
  WASI,
}
