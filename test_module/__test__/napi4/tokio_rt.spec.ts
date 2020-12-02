import { readFileSync } from 'fs'
import { join } from 'path'

import test from 'ava'

import { napiVersion } from '../napi-version'

const bindings = require('../../index.node')

const filepath = join(__dirname, './example.txt')

test.serial('should execute future on tokio runtime', async (t) => {
  if (napiVersion < 4) {
    t.is(bindings.testExecuteTokioReadfile, undefined)
    return
  }
  const fileContent = await bindings.testExecuteTokioReadfile(filepath)
  t.true(Buffer.isBuffer(fileContent))
  t.deepEqual(readFileSync(filepath), fileContent)
})

test.serial('should reject error from tokio future', async (t) => {
  if (napiVersion < 4) {
    t.is(bindings.testTokioError, undefined)
    return
  }
  try {
    await bindings.testTokioError(filepath)
    throw new TypeError('Unreachable')
  } catch (e) {
    t.is(e.message, 'Error from tokio future')
  }
})

test.serial('should be able to execute future paralleled', async (t) => {
  if (napiVersion < 4) {
    t.is(bindings.testExecuteTokioReadfile, undefined)
    return
  }
  const buffers = await Promise.all(
    Array.from({ length: 50 }).map((_) =>
      bindings.testExecuteTokioReadfile(filepath),
    ),
  )
  for (const fileContent of buffers) {
    t.true(Buffer.isBuffer(fileContent))
    t.deepEqual(readFileSync(filepath), fileContent)
  }
})

test.serial('should reject if task queue is full', async (t) => {
  if (napiVersion < 4) {
    t.is(bindings.testExecuteTokioReadfile, undefined)
    return
  }
  try {
    await Promise.all(
      Array.from({ length: 1000 * 1000 }).map((_) =>
        bindings.testExecuteTokioReadfile(filepath),
      ),
    )
    throw new TypeError('Unreachable')
  } catch (e) {
    t.snapshot({ code: e.code, message: e.message })
  }
})
