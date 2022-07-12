const bindings = require('../../index.node')

bindings.testThreadsafeFunction(() => {
  throw Error('Throw in thread safe function')
})
