import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { fileURLToPath } from 'url'

import test from 'ava'
import typeScript from 'typescript'
import legacyTypeScript from 'typescript-legacy'

import {
  correctStringIdent,
  processTypeDef,
  processTypeDefs,
} from '../typegen.js'

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

const reservedGlobalThisFixture = join(
  fileURLToPath(import.meta.url),
  '../',
  '__fixtures__',
  'reserved_global_this',
)

const reservedGlobalThisNamespaceFixture = join(
  fileURLToPath(import.meta.url),
  '../',
  '__fixtures__',
  'reserved_global_this_namespace',
)

const reservedNamespacedGlobalThisFixture = join(
  fileURLToPath(import.meta.url),
  '../',
  '__fixtures__',
  'reserved_namespaced_global_this',
)

test('keeps same-named namespace classes isolated and iterators portable', async (t) => {
  const { dts } = await processTypeDef(namespaceIteratorFixture, true)

  t.true(
    dts.includes(
      'interface IteratorObject<T, TReturn = unknown, TNext = unknown>\n' +
        '    extends globalThis.Iterator<T, TReturn, TNext>',
    ),
  )
  t.false(dts.includes('class PortableIterator extends Iterator'))
  t.true(
    dts.includes(
      '[globalThis.Symbol.iterator](): this\n' +
        '  next(...[value]: [] | [Record<string, number>]): globalThis.IteratorResult<[number, number], ([string, number]) | undefined>\n' +
        '  return(...[value]: [] | [[string, number]]): globalThis.IteratorResult<[number, number], ([string, number]) | undefined>\n' +
        '  throw(exception?: unknown): globalThis.IteratorResult<[number, number], ([string, number]) | undefined>',
    ),
  )
  t.true(
    dts.includes(
      "export interface PortableIterator extends globalThis.Omit<globalThis.IteratorObject<[number, number], ([string, number]) | undefined, Record<string, number>>, 'next' | 'return' | 'throw'> {}",
    ),
  )
  t.true(
    dts.includes(
      'globalThis.IteratorResult<number, (() => number) | undefined>',
    ),
  )
  t.false(
    dts.includes('globalThis.IteratorResult<number, () => number | undefined>'),
  )
  t.true(dts.includes('export declare class __NapiRsAsyncGenerator'))
  t.false(dts.includes('type __NapiRsAsyncGenerator<'))
  t.true(
    dts.includes(
      'interface __NapiRsAsyncGenerator_1<TOwner, T, TReturn, TNext>',
    ),
  )
  t.false(dts.includes('extends globalThis.AsyncGenerator<'))
  t.false(dts.includes('Symbol.asyncDispose'))
  t.false(dts.includes('export interface __NapiRsAsyncGenerator_1'))
  t.true(
    dts.includes(
      '[globalThis.Symbol.asyncIterator](): globalThis.__NapiRsAsyncGenerator_1<PortableAsyncIterator, [number, number], [string, number], Record<string, number>>',
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

test('rejects the unqualifiable globalThis export name', async (t) => {
  await t.throwsAsync(processTypeDef(reservedGlobalThisFixture, true), {
    message: /export name `globalThis` is reserved/,
  })
})

test('rejects globalThis as a namespace export name', async (t) => {
  await t.throwsAsync(
    processTypeDef(reservedGlobalThisNamespaceFixture, true),
    {
      message: /export name `globalThis` is reserved/,
    },
  )
})

test('rejects globalThis declarations inside namespaces', async (t) => {
  await t.throwsAsync(
    processTypeDef(reservedNamespacedGlobalThisFixture, true),
    {
      message: /export name `globalThis` is reserved/,
    },
  )
})

test('allocates one async generator helper after combining declaration fragments', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'napi-rs-typegen-fragments-'))
  const asyncIteratorPath = join(directory, 'async-iterator')
  const collisionPath = join(directory, 'collision')

  try {
    await Promise.all([
      writeFile(
        asyncIteratorPath,
        [
          '{"kind":"struct","name":"FragmentAsyncIterator","def":"constructor()","original_name":"FragmentAsyncIterator"}',
          '{"kind":"impl","name":"FragmentAsyncIterator","def":"[Symbol.asyncIterator](): AsyncGenerator<number, string, void>"}',
        ].join('\n'),
      ),
      writeFile(
        collisionPath,
        '{"kind":"struct","name":"__NapiRsAsyncGenerator","def":"constructor()","original_name":"__NapiRsAsyncGenerator"}',
      ),
    ])

    const { dts } = await processTypeDefs(
      [asyncIteratorPath, collisionPath],
      true,
    )

    t.is(dts.match(/declare global \{/g)?.length, 1)
    t.true(
      dts.includes(
        'interface __NapiRsAsyncGenerator_1<TOwner, T, TReturn, TNext>',
      ),
    )
    t.true(
      dts.includes(
        '[globalThis.Symbol.asyncIterator](): globalThis.__NapiRsAsyncGenerator_1<FragmentAsyncIterator, number, string, void>',
      ),
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
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
    [
      'lib.es2022.d.ts',
      'lib.es2025.iterator.d.ts',
      'lib.esnext.disposable.d.ts',
    ],
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
// @ts-expect-error napi-rs async iterators do not implement async disposal.
asyncIterator[Symbol.asyncDispose]()
`
    : ''

  try {
    await Promise.all([
      writeFile(declarationPath, declarations),
      writeFile(
        consumerPath,
        `
import { PortableAsyncIterator, PortableIterator } from './index'

let iterator = new PortableIterator()
iterator = iterator[Symbol.iterator]()
iterator.next()
iterator.next({ first: 1 })
iterator.return()
iterator.return(['complete', 1])
// @ts-expect-error omission is supported, but explicit undefined is not a next value.
iterator.next(undefined)
// @ts-expect-error omission is supported, but explicit undefined is not the return tuple.
iterator.return(undefined)
const standardIterator: Iterator<
  [number, number],
  [string, number] | undefined,
  Record<string, number>
> = iterator
void standardIterator

class Child extends PortableIterator {
  childOnly(): void {}
}

let child = new Child()
child = child[Symbol.iterator]()
child.childOnly()

const asyncIterator = new PortableAsyncIterator()[Symbol.asyncIterator]()
export const inferredAsyncIterator = asyncIterator[Symbol.asyncIterator]()
asyncIterator.next()
asyncIterator.next({ first: 1 })
asyncIterator.return()
asyncIterator.return(['complete', 1])
// @ts-expect-error omission is supported, but explicit undefined is not a next value.
asyncIterator.next(undefined)
// @ts-expect-error omission is supported, but explicit undefined is not the return tuple.
asyncIterator.return(undefined)
// @ts-expect-error napi-rs converts return values before entering the Rust hook.
asyncIterator.return(Promise.resolve(['complete', 1]))
inferredAsyncIterator.return(['complete', 1])
// @ts-expect-error recursive async iteration keeps the direct return contract.
inferredAsyncIterator.return(undefined)
// @ts-expect-error recursive async iteration keeps the direct return contract.
inferredAsyncIterator.return(Promise.resolve(['complete', 1]))
const standardAsyncIterator: AsyncIterator<
  [number, number],
  [string, number] | undefined,
  Record<string, number>
> = asyncIterator
void standardAsyncIterator
async function consumeAsyncIterator() {
  for await (const value of asyncIterator) {
    const pair: [number, number] = value
    void pair
  }
}
void consumeAsyncIterator
${helperAssertion}
`,
      ),
    ])

    const compilerOptions: typeScript.CompilerOptions = {
      lib,
      module: compiler.ModuleKind.Node16,
      moduleResolution: compiler.ModuleResolutionKind.Node16,
      skipLibCheck: false,
      strict: true,
      target: compiler.ScriptTarget.ES2022,
      types: [],
    }
    const program = compiler.createProgram([declarationPath, consumerPath], {
      ...compilerOptions,
      noEmit: true,
    })

    const diagnostics = compiler
      .getPreEmitDiagnostics(program)
      .map((diagnostic) =>
        compiler.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
      )
    if (diagnostics.length > 0) {
      return diagnostics
    }

    const emittedDirectory = join(directory, 'emitted')
    const emitProgram = compiler.createProgram(
      [declarationPath, consumerPath],
      {
        ...compilerOptions,
        declaration: true,
        emitDeclarationOnly: true,
        outDir: emittedDirectory,
      },
    )
    const emitResult = emitProgram.emit()
    diagnostics.push(
      ...compiler
        .getPreEmitDiagnostics(emitProgram)
        .concat(emitResult.diagnostics)
        .map((diagnostic) =>
          compiler.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
        ),
    )
    if (diagnostics.length > 0) {
      return diagnostics
    }

    const emittedDeclarationPath = join(emittedDirectory, 'index.d.ts')
    const downstreamPath = join(emittedDirectory, 'downstream.ts')
    await Promise.all([
      writeFile(emittedDeclarationPath, declarations),
      writeFile(
        downstreamPath,
        `
import { inferredAsyncIterator } from './consumer'

inferredAsyncIterator.return(['complete', 1])
// @ts-expect-error declaration emit must retain the direct return contract.
inferredAsyncIterator.return(undefined)
// @ts-expect-error declaration emit must retain the direct return contract.
inferredAsyncIterator.return(Promise.resolve(['complete', 1]))
`,
      ),
    ])
    const downstreamProgram = compiler.createProgram(
      [
        emittedDeclarationPath,
        join(emittedDirectory, 'consumer.d.ts'),
        downstreamPath,
      ],
      {
        ...compilerOptions,
        noEmit: true,
      },
    )
    return compiler
      .getPreEmitDiagnostics(downstreamProgram)
      .map((diagnostic) =>
        compiler.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
      )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
