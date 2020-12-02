import { join } from 'path'

import test from 'ava'

import { napiVersion } from '../napi-version'

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
    t.snapshot({ code: e.code, message: e.message })
  }
})
