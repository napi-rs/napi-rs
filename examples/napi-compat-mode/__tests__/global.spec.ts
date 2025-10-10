import { test } from 'node:test'
import assert from 'node:assert'
import Sinon from 'sinon'

// @ts-expect-error
import bindings from '../index.node'

function wait(delay: number) {
  return new Promise((resolve) => setTimeout(resolve, delay))
}

const delay = 100

test('should setTimeout', async () => {
  const handler = Sinon.spy()
  bindings.setTimeout(handler, delay)
  assert.strictEqual(handler.callCount, 0)
  await wait(delay + 10)
  assert.strictEqual(handler.callCount, 1)
})

test('should clearTimeout', async () => {
  const handler = Sinon.spy()
  const timer = setTimeout(() => handler(), delay)
  assert.strictEqual(handler.callCount, 0)
  bindings.clearTimeout(timer)
  await wait(delay + 10)
  assert.strictEqual(handler.callCount, 0)
})
