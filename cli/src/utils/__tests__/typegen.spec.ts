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
  // Snapshot: correctStringIdent(input, 0, 'original ident is 0')
  // Snapshot: correctStringIdent(input, 2, 'original ident is 2')
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

  // Snapshot: dts
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
