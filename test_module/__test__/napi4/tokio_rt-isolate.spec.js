const test = require('ava')
const { join } = require('path')

const napiVersion = require('../napi-version')

const filepath = join(__dirname, './example.txt')

process.env.NAPI_RS_TOKIO_CHANNEL_BUFFER_SIZE = '1'

const bindings = require('../../index.node')

test('should be able adjust queue size via process.env', async (t) => {
  if (napiVersion < 4) {
    t.is(bindings.testExecuteTokioReadfile, undefined)
    return
  }
  try {
    await Promise.all(
      Array.from({ length: 50 }).map((_) =>
        bindings.testExecuteTokioReadfile(filepath),
      ),
    )
    throw new TypeError('Unreachable')
  } catch (e) {
    t.is(e.message, 'QueueFull: Failed to run future: no available capacity')
  }
})
