import test from 'ava'
import Sinon from 'sinon'

const bindings = require('../index.node')

function wait(delay: number) {
  return new Promise((resolve) => setTimeout(resolve, delay))
}

const delay = 100

test('should setTimeout', async (t) => {
  const handler = Sinon.spy()
  bindings.setTimeout(handler, delay)
  t.is(handler.callCount, 0)
  await wait(delay + 10)
  t.is(handler.callCount, 1)
})

test('should clearTimeout', async (t) => {
  const handler = Sinon.spy()
  const timer = setTimeout(() => handler(), delay)
  t.is(handler.callCount, 0)
  bindings.clearTimeout(timer)
  await wait(delay + 10)
  t.is(handler.callCount, 0)
})
