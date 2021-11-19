import fs from 'fs'
import path from 'path'

import test from 'ava'

import { napiVersion } from '../napi-version'

const bindings = require('../../index.node')

const filepath = path.resolve(__dirname, './example.txt')

test('should read a file and return its a buffer', async (t) => {
  if (napiVersion < 4) {
    t.is(bindings.testTokioReadfile, undefined)
    return
  }
  await new Promise<void>((resolve, reject) => {
    bindings.testTokioReadfile(filepath, (err: Error | null, value: Buffer) => {
      try {
        t.is(err, null)
        t.is(Buffer.isBuffer(value), true)
        t.is(value.toString(), fs.readFileSync(filepath, 'utf8'))
        resolve()
      } catch (err) {
        reject(err)
      }
    })
  })
})
