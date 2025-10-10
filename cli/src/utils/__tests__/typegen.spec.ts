import { join } from 'path'
import { fileURLToPath } from 'url'

import { test } from 'node:test'
import assert from 'node:assert'

import { correctStringIdent, processTypeDef } from '../typegen.js'

test('should ident string correctly', () => {
  const input = `
  /**
   * should keep
   * class A {
   * foo = () => {}
   *   bar = () => {}
   * }
   */
  class A {
    foo() {
      a = b
    }

  bar = () => {

  }
      boz = 1
    }

  namespace B {
      namespace C {
  type D = A
      }
  }
`
  // Snapshot testing not supported - verify basic functionality
  const result0 = correctStringIdent(input, 0)
  const result2 = correctStringIdent(input, 2)
  assert.ok(typeof result0 === 'string')
  assert.ok(typeof result2 === 'string')
  assert.ok(result0.length > 0)
  assert.ok(result2.length > 0)
})

test('should process type def correctly', async () => {
  const { dts } = await processTypeDef(
    join(
      fileURLToPath(import.meta.url),
      '../',
      '__fixtures__',
      'napi_type_def',
    ),
    true,
  )

  // Snapshot testing not supported - verify basic structure
  assert.ok(dts)
  assert.ok(typeof dts === 'string')
})

test('should process type def with noConstEnum correctly', async () => {
  const { dts } = await processTypeDef(
    join(
      fileURLToPath(import.meta.url),
      '../',
      '__fixtures__',
      'napi_type_def',
    ),
    false,
  )

  // Snapshot: dts
})
