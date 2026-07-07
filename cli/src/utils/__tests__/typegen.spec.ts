import { join } from 'path'
import { fileURLToPath } from 'url'

import test from 'ava'

import { correctStringIdent, processTypeDef } from '../typegen.js'

test('should ident string correctly', (t) => {
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
  t.snapshot(correctStringIdent(input, 0), 'original ident is 0')
  t.snapshot(correctStringIdent(input, 2), 'original ident is 2')
})

test('should process type def correctly', async (t) => {
  const { dts } = await processTypeDef(
    join(
      fileURLToPath(import.meta.url),
      '../',
      '__fixtures__',
      'napi_type_def',
    ),
    true,
  )

  t.snapshot(dts)
})

test('should process type def with noConstEnum correctly', async (t) => {
  const { dts } = await processTypeDef(
    join(
      fileURLToPath(import.meta.url),
      '../',
      '__fixtures__',
      'napi_type_def',
    ),
    false,
  )

  t.snapshot(dts)
})

// The next two tests use a minimal fixture (one numeric + one string
// enum) to keep snapshots small and focused on the flag's behavior.
const flagFixture = join(
  fileURLToPath(import.meta.url),
  '../',
  '__fixtures__',
  'runtime_string_enum_flag',
)

const namespaceIteratorFixture = join(
  fileURLToPath(import.meta.url),
  '../',
  '__fixtures__',
  'namespace_iterator',
)

test('keeps same-named namespace classes isolated and iterators portable', async (t) => {
  const { dts } = await processTypeDef(namespaceIteratorFixture, true)

  t.false(dts.includes('extends Iterator'))
  t.true(
    dts.includes(
      '[Symbol.iterator](): Iterator<[number, number], [string, number], Record<string, number>>\n' +
        '  next(value?: Record<string, number>): IteratorResult<[number, number], [string, number]>\n' +
        '  return(value?: [string, number]): IteratorResult<[number, number], [string, number]>\n' +
        '  throw(exception?: unknown): IteratorResult<[number, number], [string, number]>',
    ),
  )
  t.true(dts.includes('class DerivedClass extends BaseClass'))
  t.is(dts.match(/alphaMethod/g)?.length, 1)
  t.is(dts.match(/betaMethod/g)?.length, 1)
  t.regex(
    dts,
    /namespace alpha \{\n  export class SharedClass \{\n    alphaMethod\(\): void\n  \}/,
  )
  t.regex(
    dts,
    /namespace beta \{\n  export class SharedClass \{\n    betaMethod\(\): void\n  \}/,
  )
})

test('should process type def with noConstEnum and runtimeStringEnum correctly', async (t) => {
  const { dts } = await processTypeDef(flagFixture, false, true)

  t.snapshot(dts)
})

test('runtimeStringEnum is a no-op when constEnum is set', async (t) => {
  const { dts } = await processTypeDef(flagFixture, true, true)

  t.snapshot(dts)
})
