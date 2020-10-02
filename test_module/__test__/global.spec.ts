import test from 'ava'
import Sinon from 'sinon'

const bindings = require('../index.node')

function wait(delay: number) {
  return new Promise((resolve) => setTimeout(resolve, delay))
}

test('should setTimeout', async (t) => {
  const handler = Sinon.spy()
  const delay = 100
  bindings.setTimeout(handler, delay)
  t.is(handler.callCount, 0)
  await wait(delay + 10)
  t.is(handler.callCount, 1)
})
