import test from 'ava'

import { napiVersion } from '../napi-version'

const bindings = require('../../index.node')

test('should call callback with the first arguments as an Error', async (t) => {
  if (napiVersion < 4) {
    t.is(bindings.testTsfnError, undefined)
    return
  }
  await new Promise<void>((resolve, reject) => {
    bindings.testTsfnError((err: Error) => {
      try {
        t.is(err instanceof Error, true)
        t.is(err.message, 'invalid')
        resolve()
      } catch (err) {
        reject(err)
      }
    })
  })
})
