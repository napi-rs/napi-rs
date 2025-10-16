import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { test } from 'node:test'
import assert from 'node:assert'

import { napiVersion } from '../napi-version'

// @ts-expect-error
import bindings from '../../index.node'

const __dirname = dirname(fileURLToPath(import.meta.url))

const filepath = join(__dirname, './example.txt')

test.serial('should execute future on tokio runtime', async (t) => {
  if (napiVersion < 4) {
    assert.strictEqual(bindings.testExecuteTokioReadfile, undefined)
    return
  }
  const fileContent = await bindings.testExecuteTokioReadfile(filepath)
  assert.ok(Buffer.isBuffer(fileContent))
  assert.deepStrictEqual(readFileSync(filepath), fileContent)
})

test.serial('should reject error from tokio future', async (t) => {
  if (napiVersion < 4) {
    assert.strictEqual(bindings.testTokioError, undefined)
    return
  }
  try {
    await bindings.testTokioError(filepath)
    throw new TypeError('Unreachable')
  } catch (e) {
    assert.strictEqual((e as Error).message, 'Error from tokio future')
  }
})

test.serial('should be able to execute future paralleled', async (t) => {
  if (napiVersion < 4) {
    assert.strictEqual(bindings.testExecuteTokioReadfile, undefined)
    return
  }
  const buffers = await Promise.all(
    Array.from({ length: 50 }).map((_) =>
      bindings.testExecuteTokioReadfile(filepath),
    ),
  )
  for (const fileContent of buffers) {
    assert.ok(Buffer.isBuffer(fileContent))
    assert.deepStrictEqual(readFileSync(filepath), fileContent)
  }
})
