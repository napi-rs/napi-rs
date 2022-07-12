const { parentPort } = require('worker_threads')

const native = require('../index')

parentPort.postMessage(
  native.Animal.withKind(native.Kind.Cat).whoami() + native.DEFAULT_COST,
)
