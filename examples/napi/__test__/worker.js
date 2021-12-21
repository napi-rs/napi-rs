const { parentPort } = require('worker_threads')

const native = require('../index')

parentPort.postMessage(native.DEFAULT_COST)
