// @ts-expect-error
import bindings from '../../index.node'

bindings.testThreadsafeFunction(() => {
  throw Error('Throw in thread safe function')
})
