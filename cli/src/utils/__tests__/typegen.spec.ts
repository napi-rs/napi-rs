import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { fileURLToPath } from 'url'

import test from 'ava'
import typeScript from 'typescript'
import legacyTypeScript from 'typescript-legacy'

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

  t.true(
    dts.includes(
      'interface IteratorObject<T, TReturn = unknown, TNext = unknown>\n' +
        '    extends Iterator<T, TReturn, TNext>',
    ),
  )
  t.false(dts.includes('class PortableIterator extends Iterator'))
  t.true(
    dts.includes(
      '[Symbol.iterator](): this\n' +
        '  next(value?: Record<string, number>): IteratorResult<[number, number], [string, number]>\n' +
        '  return(value?: [string, number]): IteratorResult<[number, number], [string, number]>\n' +
        '  throw(exception?: unknown): IteratorResult<[number, number], [string, number]>',
    ),
  )
  t.true(
    dts.includes(
      'export interface PortableIterator extends IteratorObject<[number, number], [string, number], Record<string, number>> {}',
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

test('generated iterators compile on legacy TypeScript and expose current helpers', async (t) => {
  const { dts } = await processTypeDef(namespaceIteratorFixture, true)
  const legacyDiagnostics = await compileIteratorConsumer(
    legacyTypeScript as unknown as typeof typeScript,
    dts,
    ['lib.es2022.d.ts'],
    false,
  )
  t.deepEqual(legacyDiagnostics, [])

  const currentDiagnostics = await compileIteratorConsumer(
    typeScript,
    dts,
    ['lib.es2022.d.ts', 'lib.es2025.iterator.d.ts'],
    true,
  )
  t.deepEqual(currentDiagnostics, [])
})

test('should process type def with noConstEnum and runtimeStringEnum correctly', async (t) => {
  const { dts } = await processTypeDef(flagFixture, false, true)

  t.snapshot(dts)
})

test('runtimeStringEnum is a no-op when constEnum is set', async (t) => {
  const { dts } = await processTypeDef(flagFixture, true, true)

  t.snapshot(dts)
})

async function compileIteratorConsumer(
  compiler: typeof typeScript,
  declarations: string,
  lib: string[],
  expectHelpers: boolean,
): Promise<string[]> {
  const directory = await mkdtemp(join(tmpdir(), 'napi-rs-iterator-typegen-'))
  const declarationPath = join(directory, 'index.d.ts')
  const consumerPath = join(directory, 'consumer.ts')
  const helperAssertion = expectHelpers
    ? `
const values: Array<[number, number]> = iterator
  .drop(1)
  .map((value) => value)
  .toArray()
void values
`
    : ''

  try {
    await Promise.all([
      writeFile(declarationPath, declarations),
      writeFile(
        consumerPath,
        `
import { PortableIterator } from './index'

let iterator = new PortableIterator()
iterator = iterator[Symbol.iterator]()

class Child extends PortableIterator {
  childOnly(): void {}
}

let child = new Child()
child = child[Symbol.iterator]()
child.childOnly()
${helperAssertion}
`,
      ),
    ])

    const program = compiler.createProgram([declarationPath, consumerPath], {
      lib,
      module: compiler.ModuleKind.Node16,
      moduleResolution: compiler.ModuleResolutionKind.Node16,
      noEmit: true,
      skipLibCheck: false,
      strict: true,
      target: compiler.ScriptTarget.ES2022,
      types: [],
    })

    return compiler
      .getPreEmitDiagnostics(program)
      .map((diagnostic) =>
        compiler.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
      )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
